"""
Sistema de Monitoreo Bioacústico para Granjas Porcinas
Versión: 0.6 (Data Collector)
Edge Device: Raspberry Pi / Mac Dev

Cambios v0.6:
- INTEGRACIÓN DE GRABADORA:
  Ahora, cuando se detecta una alarma, el sistema graba 3 segundos de audio
  y los guarda en la carpeta 'grabaciones/' como archivo .wav.
  Esto servirá para crear el Dataset de entrenamiento para la IA.
"""

import pyaudio
import numpy as np
import time
import threading
import logging
import wave
import os
from datetime import datetime

# --- CONFIGURACIÓN ---
RATE = 48000              
CHUNK = 1024              
CHANNELS = 1              
FORMAT = pyaudio.paInt16  

RMS_THRESHOLD = 300       
GAIN = 5.0
ZCR_THRESHOLD = 80        

# Configuración de Grabación
RECORD_SECONDS = 3        # Cuánto tiempo grabar tras la alerta
OUTPUT_DIR = "grabaciones" # Carpeta donde se guardarán los audios

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger("AXIS.Edge")

# Aseguramos que exista la carpeta de grabaciones
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

class AudioEar:
    def __init__(self):
        self.p = pyaudio.PyAudio() 
        self.stream = None
        self.is_listening = False
        self.audio_queue = []
        self.lock = threading.Lock()
        self.thread = None
        
        # Variables para grabación
        self.is_recording = False
        self.recording_frames = []

    def list_devices(self):
        print("\n--- DISPOSITIVOS DETECTADOS ---")
        info = self.p.get_host_api_info_by_index(0)
        numdevices = info.get('deviceCount')
        for i in range(0, numdevices):
            dev = self.p.get_device_info_by_host_api_device_index(0, i)
            if dev.get('maxInputChannels') > 0:
                print(f"ID {i}: {dev.get('name')}")
        print("-------------------------------\n")
        
    def _capture_loop(self):
        while self.is_listening:
            try:
                data = self.stream.read(CHUNK, exception_on_overflow=False)
                
                with self.lock:
                    # 1. Para el análisis en tiempo real (solo guardamos el último)
                    self.audio_queue.append(data)
                    if len(self.audio_queue) > 1: self.audio_queue.pop(0)
                    
                    # 2. Para la grabación (si está activa, acumulamos todo)
                    if self.is_recording:
                        self.recording_frames.append(data)
                        
            except Exception:
                pass
    
    def start(self):
        try:
            self.stream = self.p.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                input_device_index=2, # <--- IPHONE ID
                frames_per_buffer=CHUNK
            )
            self.is_listening = True
            self.thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.thread.start()
        except Exception as e:
            print(f"Error Mic: {e}")
            raise
    
    def start_recording(self):
        """Activa la bandera de grabación"""
        with self.lock:
            self.recording_frames = [] # Limpiar buffer anterior
            self.is_recording = True
            
    def stop_and_save_recording(self, filename):
        """Detiene la grabación y guarda el archivo WAV"""
        with self.lock:
            self.is_recording = False
            frames_to_save = self.recording_frames[:] # Copia de seguridad
            
        # Guardar archivo WAV
        filepath = os.path.join(OUTPUT_DIR, filename)
        wf = wave.open(filepath, 'wb')
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(self.p.get_sample_size(FORMAT))
        wf.setframerate(RATE)
        wf.writeframes(b''.join(frames_to_save))
        wf.close()
        return filepath

    def get_latest_chunk(self):
        with self.lock:
            if self.audio_queue: return self.audio_queue[-1]
            return None
    
    def stop(self):
        self.is_listening = False
        if self.thread: self.thread.join(timeout=1.0)
        if self.stream: 
            self.stream.stop_stream()
            self.stream.close()
        if self.p: self.p.terminate()

class Brain:
    def __init__(self):
        self.rms_threshold = RMS_THRESHOLD
        self.zcr_threshold = ZCR_THRESHOLD
        self.last_trigger = 0
    
    def analyze_audio(self, audio_data):
        if not audio_data: return 0.0, 0.0
        try:
            audio_array = np.frombuffer(audio_data, dtype=np.int16).astype(np.float64)
            if len(audio_array) == 0: return 0.0, 0.0
            
            mean_sq = np.mean(audio_array**2)
            if mean_sq <= 0 or np.isnan(mean_sq): rms = 0.0
            else: rms = np.sqrt(mean_sq) * GAIN
            
            zero_crossings = np.nonzero(np.diff(audio_array > 0))[0]
            zcr = len(zero_crossings)
            
            return rms, zcr
            
        except Exception:
            return 0.0, 0.0
    
    def should_trigger(self, rms, zcr):
        now = time.time()
        is_loud = rms > self.rms_threshold
        is_high_pitch = zcr > self.zcr_threshold
        
        # Quitamos el cooldown aquí porque lo manejaremos en el monitor principal
        # para que coincida con la grabación
        if is_loud and is_high_pitch:
            return True
        return False

class BioacousticMonitor:
    def __init__(self):
        self.ear = AudioEar()
        self.brain = Brain()
        self.running = False
        self.is_processing_alert = False # Evita disparos múltiples mientras graba
    
    def start(self):
        self.ear.list_devices()
        try:
            self.ear.start()
            self.running = True
            print(f"MODO RECOLECCIÓN DE DATOS ACTIVO")
            print(f"Las alertas se guardarán en la carpeta: ./{OUTPUT_DIR}/")
            print("Intenta toser (Falso Positivo) y Silbar (Verdadero Positivo)...\n")
            
            while self.running:
                # Si estamos grabando, no analizamos, solo esperamos
                if self.is_processing_alert:
                    time.sleep(0.1)
                    continue

                chunk = self.ear.get_latest_chunk()
                if chunk:
                    rms, zcr = self.brain.analyze_audio(chunk)
                    
                    vol_bar = "█" * min(int(rms / 20), 20)
                    frq_bar = "▒" * min(int(zcr / 5), 20)
                    
                    status = "..."
                    if rms > RMS_THRESHOLD and zcr > ZCR_THRESHOLD: status = "!!! DETECTADO !!!"
                    
                    print(f"\rVol:{int(rms):04d} |{vol_bar:<20}| Frq:{int(zcr):03d} |{frq_bar:<20}| {status}", end='', flush=True)
                    
                    if self.brain.should_trigger(rms, zcr):
                        self.handle_alert(rms, zcr)
                
                time.sleep(0.05)
                
        except KeyboardInterrupt:
            print("\nApagando...")
        finally:
            self.ear.stop()

    def handle_alert(self, rms, zcr):
        self.is_processing_alert = True
        print(f"\n\n >>> ALERTA DETECTADA (Agudo: {int(zcr)}) - GRABANDO 3s... <<<")
        
        # 1. Iniciar Grabación
        self.ear.start_recording()
        
        # 2. Esperar el tiempo de grabación
        # Usamos un bucle con sleep pequeño para mantener la app viva
        for _ in range(RECORD_SECONDS * 10):
            time.sleep(0.1)
            print(".", end='', flush=True)
            
        # 3. Guardar Archivo
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"alerta_{timestamp}_rms{int(rms)}_zcr{int(zcr)}.wav"
        path = self.ear.stop_and_save_recording(filename)
        
        print(f"\n [OK] Guardado en: {path}")
        print(" Reanudando escucha...\n")
        
        time.sleep(1) # Pequeña pausa extra
        self.is_processing_alert = False

if __name__ == "__main__":
    BioacousticMonitor().start()