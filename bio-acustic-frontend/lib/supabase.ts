import { createClient } from '@supabase/supabase-js'

// MODIFICACIÓN: Añadimos un fallback (|| '') para evitar que el build falle 
// si las variables no están disponibles en el momento de la compilación.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ============ TYPES FOR MULTI-TENANT SAAS ============

export type UserRole = 'super_admin' | 'farm_admin' | 'viewer'

export interface Farm {
  id: string
  name: string
  location: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  farm_id: string | null
  role: UserRole
  full_name: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  created_at: string
  device_id: string
  alert_type: string
  confidence: number
  farm_id: string | null  // NUEVO: Vinculación a la granja
  metadata: {
    rms: number
    zcr: number
    audio_file_local?: string
    audio_url?: string
    storage_path?: string
  }
}

export interface Device {
  id: string
  device_id: string
  farm_id: string | null
  name: string | null
  location: string | null
  status: 'active' | 'inactive' | 'maintenance'
  created_at: string
  updated_at: string
}

export interface DashboardStats {
  totalAlertsToday: number
  lastAlert: Event | null
  averageNoiseLevel: number
  deviceStatus: {
    [key: string]: 'online' | 'offline'
  }
}

// ============ HELPER FUNCTIONS ============

/**
 * Obtiene el perfil del usuario autenticado actual
 */
export async function getCurrentUserProfile(): Promise<Profile | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
}

/**
 * Verifica si el usuario actual es Super Admin
 */
export async function isSuperAdmin(): Promise<boolean> {
  const profile = await getCurrentUserProfile()
  return profile?.role === 'super_admin'
}

/**
 * Obtiene todas las granjas (solo para Super Admin)
 */
export async function getAllFarms(): Promise<Farm[]> {
  try {
    const { data, error } = await supabase
      .from('farms')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching farms:', error)
    return []
  }
}

/**
 * Crea una nueva granja (solo para Super Admin)
 */
export async function createFarm(name: string, location: string): Promise<Farm | null> {
  try {
    const { data, error } = await supabase
      .from('farms')
      .insert({ name, location })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating farm:', error)
    return null
  }
}