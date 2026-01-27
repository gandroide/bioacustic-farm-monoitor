import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database
export interface Event {
  id: string
  created_at: string
  device_id: string
  alert_type: string
  confidence: number
  metadata: {
    rms: number
    zcr: number
    audio_file_local?: string
    audio_url?: string
    storage_path?: string
  }
}

export interface DashboardStats {
  totalAlertsToday: number
  lastAlert: Event | null
  averageNoiseLevel: number
  deviceStatus: {
    [key: string]: 'online' | 'offline'
  }
}

