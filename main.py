"""
Sistema de Monitoreo Bioacústico para Granjas Porcinas
Versión: 0.7 (Refactorización Profesional)
Edge Device: Raspberry Pi / Mac Dev

Cambios v0.7:
- Refactorización completa con Type Hints (PEP 484)
- Arquitectura modular con separación de responsabilidades
- Clase Brain abstracta lista para integración de ML
- Manejo robusto de errores con reconexión automática
- Optimización de uso de CPU
- Código listo para producción
"""

import os
import time
import wave
import threading
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Tuple, List
from collections import deque

import pyaudio
import numpy as np
import numpy.typing as npt
from dotenv import load_dotenv
from supabase import create_client, Client


# ========== CARGAR VARIABLES DE ENTORNO ==========

# Cargar configuración desde .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DEVICE_ID = os.getenv("DEVICE_ID", "mac-dev-01")


# ========== CONFIGURACIÓN ==========

@dataclass(frozen=True)
class AudioConfig:
    """Configuración de captura de audio."""
    sample_rate: int = 48000
    chunk_size: int = 1024
    channels: int = 1
    format: int = pyaudio.paInt16
    device_index: Optional[int] = None  # None = auto-detect
    prefer_iphone: bool = True  # Buscar iPhone primero


@dataclass(frozen=True)
class AnalysisConfig:
    """Configuración de análisis de audio."""
    rms_threshold: float = 300.0
    zcr_threshold: int = 80
    gain: float = 5.0
    cooldown_seconds: float = 5.0  # Tiempo mínimo entre alertas


@dataclass(frozen=True)
class RecordingConfig:
    """Configuración de grabación."""
    duration_seconds: int = 3
    output_directory: str = "grabaciones"


# ========== CONFIGURACIÓN DE LOGGING ==========

def setup_logger(name: str = "AXIS.Edge") -> logging.Logger:
    """Configura el sistema de logging."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%H:%M:%S'
    )
    return logging.getLogger(name)


logger = setup_logger()


# ========== INICIALIZACIÓN DE SUPABASE ==========

def initialize_supabase() -> Optional[Client]:
    """
    Inicializa el cliente de Supabase.
    
    Returns:
        Cliente de Supabase o None si no está configurado
    """
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            client = create_client(SUPABASE_URL, SUPABASE_KEY)
            logger.info("✓ Cliente de Supabase inicializado correctamente")
            return client
        except Exception as e:
            logger.error(f"Error inicializando Supabase: {e}")
            return None
    else:
        logger.warning("⚠ Supabase no configurado (falta SUPABASE_URL o SUPABASE_KEY en .env)")
        return None


# ========== CAPA DE ABSTRACCIÓN: ANÁLISIS DE AUDIO ==========

class AudioAnalyzer(ABC):
    """
    Interfaz abstracta para analizadores de audio.
    Permite reemplazar fácilmente el análisis simple por un modelo de ML.
    """
    
    @abstractmethod
    def analyze(self, audio_data: bytes) -> Tuple[float, float]:
        """
        Analiza un fragmento de audio y retorna métricas.
        
        Args:
            audio_data: Datos de audio en formato raw bytes
            
        Returns:
            Tuple con (métrica_volumen, métrica_frecuencia)
        """
        pass
    
    @abstractmethod
    def should_trigger_alert(self, volume_metric: float, frequency_metric: float) -> bool:
        """
        Determina si se debe disparar una alerta.
        
        Args:
            volume_metric: Métrica de volumen del análisis
            frequency_metric: Métrica de frecuencia del análisis
            
        Returns:
            True si se debe disparar alerta, False en caso contrario
        """
        pass


class SimpleAudioAnalyzer(AudioAnalyzer):
    """
    Analizador de audio basado en RMS y Zero-Crossing Rate.
    Implementación simple que será reemplazada por ML en el futuro.
    """
    
    def __init__(self, config: AnalysisConfig):
        """
        Inicializa el analizador.
        
        Args:
            config: Configuración de análisis
        """
        self.config = config
        self._last_alert_time: float = 0.0
    
    def analyze(self, audio_data: bytes) -> Tuple[float, float]:
        """
        Calcula RMS (volumen) y ZCR (frecuencia) del audio.
        
        Args:
            audio_data: Datos de audio en formato raw bytes
            
        Returns:
            Tuple con (rms, zero_crossing_rate)
        """
        if not audio_data:
            return 0.0, 0.0
        
        try:
            # Convertir bytes a array numpy
            audio_array: npt.NDArray[np.float64] = np.frombuffer(
                audio_data, 
                dtype=np.int16
            ).astype(np.float64)
            
            if len(audio_array) == 0:
                return 0.0, 0.0
            
            # Calcular RMS (Root Mean Square) - medida de volumen
            mean_squared = np.mean(audio_array ** 2)
            rms = 0.0 if mean_squared <= 0 or np.isnan(mean_squared) else \
                  np.sqrt(mean_squared) * self.config.gain
            
            # Calcular Zero Crossing Rate - medida de frecuencia
            zero_crossings = np.nonzero(np.diff(audio_array > 0))[0]
            zcr = len(zero_crossings)
            
            return float(rms), float(zcr)
            
        except Exception as e:
            logger.error(f"Error en análisis de audio: {e}")
            return 0.0, 0.0
    
    def should_trigger_alert(self, volume_metric: float, frequency_metric: float) -> bool:
        """
        Determina si el sonido es lo suficientemente fuerte y agudo.
        
        Args:
            volume_metric: Valor RMS del audio
            frequency_metric: Valor ZCR del audio
            
        Returns:
            True si cumple condiciones de alerta
        """
        current_time = time.time()
        
        # Verificar cooldown para evitar alertas repetidas
        if current_time - self._last_alert_time < self.config.cooldown_seconds:
            return False
        
        # Verificar umbrales
        is_loud = volume_metric > self.config.rms_threshold
        is_high_pitch = frequency_metric > self.config.zcr_threshold
        
        if is_loud and is_high_pitch:
            self._last_alert_time = current_time
            return True
        
        return False


# ========== CAPA DE CAPTURA: MICRÓFONO ==========

class MicrophoneCapture:
    """
    Gestiona la captura de audio desde el micrófono.
    Maneja reconexión automática en caso de fallos.
    """
    
    def __init__(self, config: AudioConfig):
        """
        Inicializa el sistema de captura de audio.
        
        Args:
            config: Configuración de audio
        """
        self.config = config
        self._audio_interface: Optional[pyaudio.PyAudio] = None
        self._stream: Optional[pyaudio.Stream] = None
        self._is_capturing: bool = False
        self._capture_thread: Optional[threading.Thread] = None
        
        # Device index resuelto (puede ser diferente al config si se auto-detecta)
        self._resolved_device_index: Optional[int] = config.device_index
        
        # Buffer circular para audio en tiempo real (solo último chunk)
        self._realtime_buffer: deque = deque(maxlen=1)
        
        # Buffer de grabación (acumula frames cuando está grabando)
        self._recording_frames: List[bytes] = []
        self._is_recording: bool = False
        
        # Lock para thread-safety
        self._lock = threading.Lock()
        
        # Control de reconexión
        self._max_reconnect_attempts: int = 5
        self._reconnect_delay: float = 2.0
    
    def _find_device_by_name(self, search_terms: List[str]) -> Optional[int]:
        """
        Busca un dispositivo de audio por términos de búsqueda en el nombre.
        
        Args:
            search_terms: Lista de términos a buscar (ej: ["iPhone", "iPad"])
            
        Returns:
            Índice del dispositivo encontrado o None
        """
        if not self._audio_interface:
            self._audio_interface = pyaudio.PyAudio()
        
        try:
            host_api_info = self._audio_interface.get_host_api_info_by_index(0)
            num_devices = host_api_info.get('deviceCount', 0)
            
            for i in range(num_devices):
                device_info = self._audio_interface.get_device_info_by_host_api_device_index(0, i)
                if device_info.get('maxInputChannels', 0) > 0:
                    device_name = device_info.get('name', '').lower()
                    for term in search_terms:
                        if term.lower() in device_name:
                            logger.info(f"✓ Dispositivo encontrado: '{device_info.get('name')}' (ID: {i})")
                            return i
        except Exception as e:
            logger.error(f"Error buscando dispositivo: {e}")
        
        return None
    
    def list_available_devices(self) -> None:
        """Lista todos los dispositivos de entrada de audio disponibles."""
        logger.info("=== DISPOSITIVOS DE AUDIO DISPONIBLES ===")
        
        if not self._audio_interface:
            self._audio_interface = pyaudio.PyAudio()
        
        try:
            host_api_info = self._audio_interface.get_host_api_info_by_index(0)
            num_devices = host_api_info.get('deviceCount', 0)
            
            for i in range(num_devices):
                device_info = self._audio_interface.get_device_info_by_host_api_device_index(0, i)
                if device_info.get('maxInputChannels', 0) > 0:
                    device_name = device_info.get('name')
                    # Marcar el dispositivo seleccionado
                    marker = " [SELECCIONADO]" if i == self._resolved_device_index else ""
                    logger.info(f"  ID {i}: {device_name}{marker}")
        except Exception as e:
            logger.error(f"Error listando dispositivos: {e}")
        
        logger.info("=========================================")
    
    def start(self) -> None:
        """
        Inicia la captura de audio con reintentos automáticos.
        Auto-detecta el micrófono del iPhone si está disponible.
        
        Raises:
            RuntimeError: Si no se puede iniciar después de todos los reintentos
        """
        # Auto-detectar dispositivo si no está especificado
        if self._resolved_device_index is None:
            logger.info("Auto-detectando dispositivo de audio...")
            
            # Si prefiere iPhone, buscarlo primero
            if self.config.prefer_iphone:
                device_id = self._find_device_by_name(["iPhone", "iPad"])
                if device_id is not None:
                    self._resolved_device_index = device_id
                    logger.info(f"→ Usando micrófono del iPhone/iPad (ID: {device_id})")
                else:
                    logger.warning("⚠ iPhone/iPad no encontrado, usando micrófono por defecto del Mac")
                    # device_index = None usará el default
            else:
                logger.info("→ Usando micrófono por defecto del sistema")
        
        # Intentar iniciar con reintentos
        for attempt in range(1, self._max_reconnect_attempts + 1):
            try:
                self._initialize_audio_stream()
                self._is_capturing = True
                self._capture_thread = threading.Thread(
                    target=self._capture_loop,
                    daemon=True,
                    name="AudioCaptureThread"
                )
                self._capture_thread.start()
                logger.info("✓ Captura de audio iniciada correctamente")
                return
                
            except Exception as e:
                logger.error(f"Intento {attempt}/{self._max_reconnect_attempts} falló: {e}")
                
                if attempt < self._max_reconnect_attempts:
                    logger.info(f"Reintentando en {self._reconnect_delay}s...")
                    time.sleep(self._reconnect_delay)
                else:
                    raise RuntimeError(
                        f"No se pudo iniciar la captura después de {self._max_reconnect_attempts} intentos"
                    )
    
    def _initialize_audio_stream(self) -> None:
        """Inicializa PyAudio y abre el stream de audio."""
        if not self._audio_interface:
            self._audio_interface = pyaudio.PyAudio()
        
        self._stream = self._audio_interface.open(
            format=self.config.format,
            channels=self.config.channels,
            rate=self.config.sample_rate,
            input=True,
            input_device_index=self._resolved_device_index,
            frames_per_buffer=self.config.chunk_size
        )
    
    def _capture_loop(self) -> None:
        """Loop principal de captura (ejecutado en thread separado)."""
        consecutive_errors = 0
        max_consecutive_errors = 10
        
        while self._is_capturing:
            try:
                # Leer chunk de audio
                audio_data = self._stream.read(
                    self.config.chunk_size,
                    exception_on_overflow=False
                )
                
                with self._lock:
                    # Actualizar buffer en tiempo real
                    self._realtime_buffer.append(audio_data)
                    
                    # Si está grabando, acumular frames
                    if self._is_recording:
                        self._recording_frames.append(audio_data)
                
                # Reset contador de errores
                consecutive_errors = 0
                
            except Exception as e:
                consecutive_errors += 1
                logger.warning(f"Error en captura (#{consecutive_errors}): {e}")
                
                if consecutive_errors >= max_consecutive_errors:
                    logger.error("Demasiados errores consecutivos. Intentando reconectar...")
                    self._attempt_reconnection()
                    consecutive_errors = 0
                
                time.sleep(0.1)  # Evitar busy loop en caso de error
    
    def _attempt_reconnection(self) -> None:
        """Intenta reconectar el stream de audio."""
        try:
            logger.info("Cerrando stream actual...")
            if self._stream:
                self._stream.stop_stream()
                self._stream.close()
            
            logger.info("Reinicializando audio...")
            time.sleep(1.0)
            self._initialize_audio_stream()
            logger.info("Reconexión exitosa")
            
        except Exception as e:
            logger.error(f"Fallo en reconexión: {e}")
    
    def get_latest_audio_chunk(self) -> Optional[bytes]:
        """
        Obtiene el último chunk de audio capturado.
        
        Returns:
            Datos de audio o None si no hay disponibles
        """
        with self._lock:
            if self._realtime_buffer:
                return self._realtime_buffer[0]
            return None
    
    def start_recording(self) -> None:
        """Inicia la grabación de audio."""
        with self._lock:
            self._recording_frames = []
            self._is_recording = True
        logger.debug("Grabación iniciada")
    
    def stop_recording_and_save(self, filepath: str) -> str:
        """
        Detiene la grabación y guarda el archivo WAV.
        
        Args:
            filepath: Ruta donde guardar el archivo
            
        Returns:
            Ruta del archivo guardado
        """
        with self._lock:
            self._is_recording = False
            frames_to_save = self._recording_frames.copy()
        
        # Guardar archivo WAV
        try:
            with wave.open(filepath, 'wb') as wav_file:
                wav_file.setnchannels(self.config.channels)
                wav_file.setsampwidth(
                    self._audio_interface.get_sample_size(self.config.format)
                )
                wav_file.setframerate(self.config.sample_rate)
                wav_file.writeframes(b''.join(frames_to_save))
            
            logger.info(f"Audio guardado: {filepath}")
            return filepath
            
        except Exception as e:
            logger.error(f"Error guardando audio: {e}")
            raise
    
    def stop(self) -> None:
        """Detiene la captura de audio y libera recursos."""
        logger.info("Deteniendo captura de audio...")
        self._is_capturing = False
        
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=2.0)
        
        if self._stream:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception as e:
                logger.warning(f"Error cerrando stream: {e}")
        
        if self._audio_interface:
            try:
                self._audio_interface.terminate()
            except Exception as e:
                logger.warning(f"Error terminando PyAudio: {e}")
        
        logger.info("Captura de audio detenida")


# ========== CAPA DE COORDINACIÓN: MONITOR PRINCIPAL ==========

class BioacousticMonitor:
    """
    Monitor principal que coordina captura, análisis y grabación.
    """
    
    def __init__(
        self,
        audio_config: AudioConfig,
        analysis_config: AnalysisConfig,
        recording_config: RecordingConfig,
        analyzer: Optional[AudioAnalyzer] = None,
        supabase_client: Optional[Client] = None
    ):
        """
        Inicializa el monitor bioacústico.
        
        Args:
            audio_config: Configuración de captura de audio
            analysis_config: Configuración de análisis
            recording_config: Configuración de grabación
            analyzer: Analizador de audio (si None, usa SimpleAudioAnalyzer)
            supabase_client: Cliente de Supabase para logging en la nube
        """
        self.audio_config = audio_config
        self.analysis_config = analysis_config
        self.recording_config = recording_config
        
        # Componentes
        self.microphone = MicrophoneCapture(audio_config)
        self.analyzer = analyzer or SimpleAudioAnalyzer(analysis_config)
        self.supabase = supabase_client
        
        # Estado
        self._is_running: bool = False
        self._is_processing_alert: bool = False
        
        # Crear directorio de grabaciones
        os.makedirs(recording_config.output_directory, exist_ok=True)
    
    def start(self) -> None:
        """Inicia el sistema de monitoreo."""
        logger.info("=" * 50)
        logger.info("Sistema de Monitoreo Bioacústico v0.7")
        logger.info("=" * 50)
        
        # Listar dispositivos disponibles
        self.microphone.list_available_devices()
        
        try:
            # Iniciar captura
            self.microphone.start()
            self._is_running = True
            
            logger.info("Modo recolección de datos activo")
            logger.info(f"Directorio de grabaciones: ./{self.recording_config.output_directory}/")
            logger.info("Presiona Ctrl+C para detener\n")
            
            # Loop principal de monitoreo
            self._monitoring_loop()
            
        except KeyboardInterrupt:
            logger.info("\nInterrupción recibida. Apagando sistema...")
        except Exception as e:
            logger.error(f"Error crítico: {e}", exc_info=True)
        finally:
            self._shutdown()
    
    def _monitoring_loop(self) -> None:
        """Loop principal de monitoreo y análisis."""
        while self._is_running:
            try:
                # Si estamos procesando una alerta, esperamos
                if self._is_processing_alert:
                    time.sleep(0.1)
                    continue
                
                # Obtener último chunk de audio
                audio_chunk = self.microphone.get_latest_audio_chunk()
                
                if audio_chunk:
                    # Analizar audio
                    volume, frequency = self.analyzer.analyze(audio_chunk)
                    
                    # Visualización en consola
                    self._display_metrics(volume, frequency)
                    
                    # Verificar si debe disparar alerta
                    if self.analyzer.should_trigger_alert(volume, frequency):
                        self._handle_alert(volume, frequency)
                
                # Control de CPU - evitar busy loop
                time.sleep(0.05)
                
            except Exception as e:
                logger.error(f"Error en loop de monitoreo: {e}")
                time.sleep(0.5)  # Pausa en caso de error
    
    def _display_metrics(self, volume: float, frequency: float) -> None:
        """
        Muestra métricas en consola.
        
        Args:
            volume: Métrica de volumen
            frequency: Métrica de frecuencia
        """
        # Barras visuales
        vol_bar = "█" * min(int(volume / 20), 20)
        freq_bar = "▒" * min(int(frequency / 5), 20)
        
        # Estado
        status = "..."
        if (volume > self.analysis_config.rms_threshold and 
            frequency > self.analysis_config.zcr_threshold):
            status = "!!! DETECTADO !!!"
        
        print(
            f"\rVol:{int(volume):04d} |{vol_bar:<20}| "
            f"Frq:{int(frequency):03d} |{freq_bar:<20}| {status}",
            end='',
            flush=True
        )
    
    def _upload_audio_to_storage(self, local_filepath: str, timestamp: str) -> Optional[str]:
        """
        Sube el archivo de audio a Supabase Storage.
        
        Args:
            local_filepath: Ruta local del archivo
            timestamp: Timestamp para el nombre del archivo
            
        Returns:
            URL pública del archivo o None si falla
        """
        if not self.supabase:
            return None
        
        try:
            # Construir ruta en el bucket: device_id/timestamp.wav
            storage_path = f"{DEVICE_ID}/{timestamp}.wav"
            
            # Leer el archivo
            with open(local_filepath, 'rb') as audio_file:
                audio_data = audio_file.read()
            
            # Subir a Supabase Storage
            logger.info(f"📤 Subiendo audio a Storage: {storage_path}")
            
            self.supabase.storage.from_("alerts").upload(
                path=storage_path,
                file=audio_data,
                file_options={"content-type": "audio/wav"}
            )
            
            # Obtener URL pública
            public_url = self.supabase.storage.from_("alerts").get_public_url(storage_path)
            
            logger.info("✓ Audio subido exitosamente")
            logger.info(f"  URL: {public_url[:60]}...")
            
            return public_url
            
        except Exception as e:
            logger.error(f"✗ Error subiendo audio a Storage: {e}")
            return None
    
    def _send_alert_to_supabase_async(
        self, 
        volume: float, 
        frequency: float, 
        local_filepath: str,
        timestamp: str
    ) -> None:
        """
        Sube el audio a Storage y envía los datos de la alerta a Supabase.
        Se ejecuta en un thread separado para no bloquear la captura.
        
        Args:
            volume: Métrica de volumen
            frequency: Métrica de frecuencia
            local_filepath: Ruta local del archivo de audio guardado
            timestamp: Timestamp del evento
        """
        if not self.supabase:
            logger.warning("⚠ Supabase no configurado, solo se guardó localmente")
            return
        
        try:
            # 1. Subir archivo a Storage
            audio_url = self._upload_audio_to_storage(local_filepath, timestamp)
            
            # 2. Calcular confidence como porcentaje normalizado del RMS
            confidence = min(volume / 1000.0, 1.0)  # Normalizar a 0-1
            
            # 3. Preparar datos del evento
            event_data = {
                "created_at": datetime.now().isoformat(),
                "device_id": DEVICE_ID,
                "alert_type": "noise_threshold",
                "confidence": float(confidence),
                "metadata": {
                    "rms": float(volume),
                    "zcr": float(frequency),
                    "audio_file_local": local_filepath,
                    "audio_url": audio_url if audio_url else None,
                    "storage_path": f"{DEVICE_ID}/{timestamp}.wav" if audio_url else None
                }
            }
            
            # 4. Insertar evento en la base de datos
            response = self.supabase.table("events").insert(event_data).execute()
            
            event_id = response.data[0].get('id', 'N/A') if response.data else 'N/A'
            logger.info(f"✓ Evento registrado en base de datos (ID: {event_id})")
            
            if audio_url:
                logger.info("✓ Sistema completo: Audio en nube + Registro en BD")
            else:
                logger.warning("⚠ Audio no subido, pero evento registrado (solo archivo local)")
            
        except Exception as e:
            logger.error(f"✗ Error en proceso de Supabase: {e}")
            logger.info(f"  → Archivo local conservado: {local_filepath}")
    
    def _handle_alert(self, volume: float, frequency: float) -> None:
        """
        Maneja una alerta: graba audio y registra el evento.
        
        Args:
            volume: Métrica de volumen que disparó la alerta
            frequency: Métrica de frecuencia que disparó la alerta
        """
        self._is_processing_alert = True
        
        logger.info(f"\n>>> ALERTA DETECTADA (Vol:{int(volume)}, Freq:{int(frequency)})")
        logger.info(f"Grabando {self.recording_config.duration_seconds} segundos...")
        
        try:
            # Iniciar grabación
            self.microphone.start_recording()
            
            # Esperar duración de grabación con feedback visual
            for _ in range(self.recording_config.duration_seconds * 10):
                time.sleep(0.1)
                print(".", end='', flush=True)
            
            # Generar nombre de archivo con timestamp
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            filename = f"alerta_{timestamp}_vol{int(volume)}_freq{int(frequency)}.wav"
            filepath = os.path.join(
                self.recording_config.output_directory,
                filename
            )
            
            # Guardar grabación localmente
            saved_path = self.microphone.stop_recording_and_save(filepath)
            logger.info(f"\n[OK] Archivo guardado localmente: {saved_path}")
            
            # Subir a Supabase de forma asíncrona (Storage + Database)
            # Esto NO bloquea el monitoreo, se ejecuta en paralelo
            if self.supabase:
                upload_thread = threading.Thread(
                    target=self._send_alert_to_supabase_async,
                    args=(volume, frequency, saved_path, timestamp),
                    daemon=True,
                    name="SupabaseUploadThread"
                )
                upload_thread.start()
                logger.info("🔄 Subida a Supabase en segundo plano...")
            else:
                logger.info("ℹ️  Supabase no configurado - solo guardado local")
            
        except Exception as e:
            logger.error(f"Error manejando alerta: {e}")
        finally:
            logger.info("Reanudando monitoreo...\n")
            time.sleep(0.5)  # Pausa breve antes de reanudar
            self._is_processing_alert = False
    
    def _shutdown(self) -> None:
        """Apaga el sistema de forma ordenada."""
        logger.info("Iniciando apagado del sistema...")
        self._is_running = False
        self.microphone.stop()
        logger.info("Sistema detenido correctamente")


# ========== PUNTO DE ENTRADA ==========

def main() -> None:
    """Punto de entrada principal de la aplicación."""
    # Configuraciones
    audio_cfg = AudioConfig()
    analysis_cfg = AnalysisConfig()
    recording_cfg = RecordingConfig()
    
    # Inicializar Supabase
    supabase_client = initialize_supabase()
    
    # Crear y ejecutar monitor
    monitor = BioacousticMonitor(
        audio_config=audio_cfg,
        analysis_config=analysis_cfg,
        recording_config=recording_cfg,
        supabase_client=supabase_client
    )
    
    monitor.start()


if __name__ == "__main__":
    main()
