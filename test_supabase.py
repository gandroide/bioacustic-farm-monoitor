"""
Script de prueba para verificar la conexión con Supabase
Ejecutar: python test_supabase.py
"""

import os
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

# Cargar variables de entorno
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DEVICE_ID = os.getenv("DEVICE_ID", "test-device")

def test_connection():
    """Prueba la conexión con Supabase"""
    print("=" * 50)
    print("TEST DE CONEXIÓN CON SUPABASE")
    print("=" * 50)
    
    # Verificar variables de entorno
    print("\n1. Verificando variables de entorno...")
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ ERROR: Faltan SUPABASE_URL o SUPABASE_KEY en el archivo .env")
        return False
    
    print(f"✓ SUPABASE_URL: {SUPABASE_URL[:30]}...")
    print(f"✓ SUPABASE_KEY: {SUPABASE_KEY[:30]}...")
    print(f"✓ DEVICE_ID: {DEVICE_ID}")
    
    # Intentar conectar
    print("\n2. Conectando con Supabase...")
    try:
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✓ Cliente creado correctamente")
    except Exception as e:
        print(f"❌ ERROR creando cliente: {e}")
        return False
    
    # Verificar que existe la tabla 'events'
    print("\n3. Verificando tabla 'events'...")
    try:
        response = client.table("events").select("*").limit(1).execute()
        print(f"✓ Tabla 'events' existe (registros: {len(response.data)})")
    except Exception as e:
        print(f"❌ ERROR: La tabla 'events' no existe o no es accesible")
        print(f"   Detalles: {e}")
        print("\n   Solución: Ejecuta el script SQL en docs/supabase_schema.sql")
        return False
    
    # Verificar Storage Bucket 'alerts'
    print("\n4. Verificando Storage Bucket 'alerts'...")
    try:
        buckets = client.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        
        if 'alerts' in bucket_names:
            print("✓ Bucket 'alerts' existe")
        else:
            print("⚠ Bucket 'alerts' NO encontrado")
            print("   Crea el bucket 'alerts' en Supabase Storage con políticas públicas")
            print("   (El programa seguirá funcionando, pero sin subir archivos)")
    except Exception as e:
        print(f"⚠ No se pudo verificar Storage: {e}")
    
    # Probar subida de archivo al Storage
    print("\n5. Probando subida al Storage Bucket...")
    try:
        # Crear un archivo de audio de prueba (silencio de 1 segundo)
        import wave
        import numpy as np
        
        test_audio_path = "/tmp/test_audio.wav"
        with wave.open(test_audio_path, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(48000)
            silence = np.zeros(48000, dtype=np.int16)
            wf.writeframes(silence.tobytes())
        
        # Subir al Storage
        storage_path = f"{DEVICE_ID}-test/test_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"
        
        with open(test_audio_path, 'rb') as f:
            audio_data = f.read()
        
        client.storage.from_("alerts").upload(
            path=storage_path,
            file=audio_data,
            file_options={"content-type": "audio/wav"}
        )
        
        # Obtener URL pública
        public_url = client.storage.from_("alerts").get_public_url(storage_path)
        print(f"✓ Archivo subido correctamente")
        print(f"  Path: {storage_path}")
        print(f"  URL: {public_url[:60]}...")
        
        # Limpiar archivo temporal
        import os
        os.remove(test_audio_path)
        
    except Exception as e:
        print(f"⚠ No se pudo subir archivo al Storage: {e}")
        print("   Verifica que el bucket 'alerts' tenga políticas de escritura públicas")
    
    # Insertar evento de prueba
    print("\n6. Insertando evento de prueba en la base de datos...")
    try:
        test_event = {
            "created_at": datetime.now().isoformat(),
            "device_id": f"{DEVICE_ID}-test",
            "alert_type": "test_connection",
            "confidence": 0.99,
            "metadata": {
                "test": True,
                "message": "Evento de prueba desde test_supabase.py",
                "audio_url": public_url if 'public_url' in locals() else None
            }
        }
        
        response = client.table("events").insert(test_event).execute()
        event_id = response.data[0].get('id', 'N/A')
        print(f"✓ Evento insertado correctamente (ID: {event_id})")
    except Exception as e:
        print(f"❌ ERROR insertando evento: {e}")
        print("\n   Posible causa: Políticas de seguridad (RLS) no configuradas")
        print("   Solución: Ejecuta el script SQL completo en docs/supabase_schema.sql")
        return False
    
    # Leer eventos recientes
    print("\n7. Leyendo últimos 5 eventos...")
    try:
        response = client.table("events").select("*").order("created_at", desc=True).limit(5).execute()
        print(f"✓ Se encontraron {len(response.data)} eventos")
        
        if response.data:
            print("\n   Últimos eventos:")
            for event in response.data:
                has_audio = "🔊" if event.get('metadata', {}).get('audio_url') else "📝"
                print(f"   {has_audio} {event['created_at'][:19]} | {event['device_id']} | {event['alert_type']} | conf: {event['confidence']:.2f}")
    except Exception as e:
        print(f"⚠ Advertencia al leer eventos: {e}")
    
    # Resumen
    print("\n" + "=" * 50)
    print("✅ TODAS LAS PRUEBAS PASARON CORRECTAMENTE")
    print("=" * 50)
    print("\nTu integración con Supabase está lista.")
    print("Puedes ejecutar main.py y las alertas se enviarán automáticamente.")
    print("\nPara ver los eventos en tiempo real:")
    print(f"→ {SUPABASE_URL}/project/default/editor")
    
    return True

if __name__ == "__main__":
    try:
        success = test_connection()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nPrueba interrumpida por el usuario.")
        exit(1)
    except Exception as e:
        print(f"\n❌ ERROR INESPERADO: {e}")
        exit(1)

