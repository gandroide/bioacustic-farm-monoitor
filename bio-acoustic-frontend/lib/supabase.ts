import { createClient } from '@supabase/supabase-js'

// MODIFICACIÓN: Añadimos un fallback (|| '') para evitar que el build falle 
// si las variables no están disponibles en el momento de la compilación.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ============ TYPES FOR MULTI-TENANT ENTERPRISE SAAS ============

export type UserRole = 'super_admin' | 'org_admin' | 'site_manager' | 'viewer'

// ============ JERARQUÍA ENTERPRISE ============

/**
 * Organization - Nivel superior (Cliente Enterprise)
 * Ejemplo: "Grupo Porcícola Ontiveros"
 */
export interface Organization {
  id: string
  name: string
  slug: string
  subscription_plan: 'Enterprise' | 'Pro' | 'Basic'
  subscription_status: 'active' | 'trial' | 'suspended'
  billing_email: string | null
  created_at: string
  updated_at: string
}

/**
 * Site - Granja/Ubicación física dentro de una Organización
 * Ejemplo: "Granja Jalisco Norte"
 */
export interface Site {
  id: string
  organization_id: string
  name: string
  location: string | null
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Building - Edificio/Nave dentro de un Site
 * Ejemplo: "Nave de Maternidad A"
 */
export interface Building {
  id: string
  site_id: string
  name: string
  building_type: string | null
  capacity: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Room - Sala/Área dentro de un Building
 * Ejemplo: "Sala 1 - Parideras"
 */
export interface Room {
  id: string
  building_id: string
  name: string
  room_type: string | null
  capacity: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Profile - Usuario vinculado a una Organización
 */
export interface Profile {
  id: string
  organization_id: string | null  // NULL solo para super_admin
  assigned_site_id: string | null  // Site específico si es site_manager
  role: UserRole
  full_name: string | null
  email: string | null
  created_at: string
  updated_at: string
}

/**
 * Event - Alerta bioacústica vinculada a una Room
 */
export interface Event {
  id: string
  created_at: string
  device_id: string
  room_id: string | null  // Vinculado a Room (ya no a farm_id)
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

/**
 * Device - Dispositivo IoT (Raspberry Pi) vinculado a una Room
 */
export interface Device {
  id: string
  device_id: string
  room_id: string | null  // Vinculado a Room específica
  name: string | null
  status: 'online' | 'offline' | 'maintenance'
  last_heartbeat: string | null
  firmware_version: string | null
  created_at: string
  updated_at: string
}

// ============ TIPOS CON RELACIONES (Para JOINs) ============

export interface SiteWithOrganization extends Site {
  organization: Organization
}

export interface BuildingWithSite extends Building {
  site: SiteWithOrganization
}

export interface RoomWithBuilding extends Room {
  building: BuildingWithSite
}

export interface DeviceWithLocation extends Device {
  room: RoomWithBuilding | null
}

export interface DashboardStats {
  totalAlertsToday: number
  lastAlert: Event | null
  averageNoiseLevel: number
  deviceStatus: {
    [key: string]: 'online' | 'offline'
  }
}

// ============ HELPER FUNCTIONS - ENTERPRISE MULTI-TENANT ============

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
 * Obtiene el organization_id del usuario autenticado
 * NULL si es super_admin
 */
export async function getUserOrganizationId(): Promise<string | null> {
  const profile = await getCurrentUserProfile()
  return profile?.organization_id || null
}

// ============ ORGANIZATIONS ============

/**
 * Obtiene todas las organizaciones (solo Super Admin)
 */
export async function getAllOrganizations(): Promise<Organization[]> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching organizations:', error)
    return []
  }
}

/**
 * Obtiene la organización del usuario actual
 */
export async function getUserOrganization(): Promise<Organization | null> {
  try {
    const orgId = await getUserOrganizationId()
    if (!orgId) return null

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching user organization:', error)
    return null
  }
}

/**
 * Crea una nueva organización (solo Super Admin)
 */
export async function createOrganization(
  name: string,
  slug: string,
  subscriptionPlan: 'Enterprise' | 'Pro' | 'Basic' = 'Pro',
  billingEmail?: string
): Promise<Organization | null> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name,
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        subscription_plan: subscriptionPlan,
        subscription_status: 'trial',
        billing_email: billingEmail || null
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating organization:', error)
    return null
  }
}

// ============ SITES (GRANJAS) ============

/**
 * Obtiene todos los Sites de una Organización
 * Si es Super Admin y no se pasa orgId, devuelve todos los sites
 */
export async function getSitesByOrganization(organizationId?: string): Promise<SiteWithOrganization[]> {
  try {
    let query = supabase
      .from('sites')
      .select(`
        *,
        organization:organizations(*)
      `)
      .eq('is_active', true)

    // Si se especifica organizationId, filtrar
    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching sites:', error)
    return []
  }
}

/**
 * Obtiene un Site específico con su organización
 */
export async function getSiteById(siteId: string): Promise<SiteWithOrganization | null> {
  try {
    const { data, error } = await supabase
      .from('sites')
      .select(`
        *,
        organization:organizations(*)
      `)
      .eq('id', siteId)
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching site:', error)
    return null
  }
}

/**
 * Crea un nuevo Site dentro de una Organización
 */
export async function createSite(
  organizationId: string,
  name: string,
  location?: string,
  address?: string
): Promise<Site | null> {
  try {
    const { data, error } = await supabase
      .from('sites')
      .insert({
        organization_id: organizationId,
        name,
        location,
        address,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating site:', error)
    return null
  }
}

// ============ USER INVITATIONS (ADMIN) ============

/**
 * Invita un usuario a una organización (solo Super Admin)
 * Usa la API route para manejar la service role key de forma segura
 */
export async function inviteUserToOrganization(
  email: string,
  organizationId: string,
  fullName?: string
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    // Obtener el token de sesión actual
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return { success: false, message: '', error: 'No hay sesión activa' }
    }

    const response = await fetch('/api/admin/invite-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        email,
        organizationId,
        fullName
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        message: '',
        error: data.error || 'Error al enviar invitación'
      }
    }

    return {
      success: true,
      message: data.message || 'Invitación enviada correctamente',
      error: undefined
    }
  } catch (error) {
    console.error('Error inviting user:', error)
    return {
      success: false,
      message: '',
      error: 'Error de conexión al enviar invitación'
    }
  }
}

// ============ BUILDINGS ============

/**
 * Obtiene todos los Buildings de un Site
 */
export async function getBuildingsBySite(siteId: string): Promise<Building[]> {
  try {
    const { data, error } = await supabase
      .from('buildings')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching buildings:', error)
    return []
  }
}

/**
 * Crea un nuevo Building dentro de un Site
 */
export async function createBuilding(
  siteId: string,
  name: string,
  buildingType?: string,
  capacity?: number
): Promise<Building | null> {
  try {
    const { data, error } = await supabase
      .from('buildings')
      .insert({
        site_id: siteId,
        name,
        building_type: buildingType,
        capacity,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating building:', error)
    return null
  }
}

/**
 * Actualiza el nombre de un Building
 */
export async function updateBuilding(
  buildingId: string,
  updates: { name?: string; building_type?: string; capacity?: number }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('buildings')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', buildingId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error updating building:', error)
    return false
  }
}

/**
 * Elimina (desactiva) un Building
 */
export async function deleteBuilding(buildingId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('buildings')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', buildingId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error deleting building:', error)
    return false
  }
}

// ============ ROOMS ============

/**
 * Obtiene todas las Rooms de un Building
 */
export async function getRoomsByBuilding(buildingId: string): Promise<Room[]> {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('building_id', buildingId)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching rooms:', error)
    return []
  }
}

/**
 * Crea una nueva Room dentro de un Building
 */
export async function createRoom(
  buildingId: string,
  name: string,
  roomType?: string,
  capacity?: number
): Promise<Room | null> {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .insert({
        building_id: buildingId,
        name,
        room_type: roomType,
        capacity,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating room:', error)
    return null
  }
}

/**
 * Actualiza el nombre de una Room
 */
export async function updateRoom(
  roomId: string,
  updates: { name?: string; room_type?: string; capacity?: number }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('rooms')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', roomId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error updating room:', error)
    return false
  }
}

/**
 * Elimina (desactiva) una Room
 */
export async function deleteRoom(roomId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('rooms')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', roomId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error deleting room:', error)
    return false
  }
}

// ============ DEVICES ============

/**
 * Obtiene todos los Devices de una Room con ubicación completa
 */
export async function getDevicesByRoom(roomId: string): Promise<DeviceWithLocation[]> {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select(`
        *,
        room:rooms(
          *,
          building:buildings(
            *,
            site:sites(
              *,
              organization:organizations(*)
            )
          )
        )
      `)
      .eq('room_id', roomId)

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching devices:', error)
    return []
  }
}

/**
 * Vincula un dispositivo a una Room mediante device_id (UID)
 * El dispositivo debe existir previamente en la tabla devices
 */
export async function claimDeviceToRoom(deviceUid: string, roomId: string): Promise<boolean> {
  try {
    // Buscar el dispositivo por device_id (UID)
    const { data: device, error: findError } = await supabase
      .from('devices')
      .select('id')
      .eq('device_id', deviceUid)
      .single()

    if (findError || !device) {
      console.error('Device not found:', deviceUid)
      return false
    }

    // Actualizar el room_id del dispositivo
    const { error: updateError } = await supabase
      .from('devices')
      .update({ 
        room_id: roomId,
        updated_at: new Date().toISOString()
      })
      .eq('id', device.id)

    if (updateError) throw updateError
    return true
  } catch (error) {
    console.error('Error claiming device:', error)
    return false
  }
}

/**
 * Obtiene el conteo de dispositivos por Site (para Admin Dashboard)
 */
export async function getDeviceCountBySite(siteId: string): Promise<{ total: number; online: number }> {
  try {
    // Obtener todos los buildings del site
    const { data: buildings, error: buildingsError } = await supabase
      .from('buildings')
      .select('id')
      .eq('site_id', siteId)

    if (buildingsError) throw buildingsError
    if (!buildings || buildings.length === 0) return { total: 0, online: 0 }

    const buildingIds = buildings.map(b => b.id)

    // Obtener todas las rooms de esos buildings
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id')
      .in('building_id', buildingIds)

    if (roomsError) throw roomsError
    if (!rooms || rooms.length === 0) return { total: 0, online: 0 }

    const roomIds = rooms.map(r => r.id)

    // Contar dispositivos totales
    const { count: totalCount, error: totalError } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .in('room_id', roomIds)

    // Contar dispositivos online (heartbeat reciente - últimos 10 minutos)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count: onlineCount, error: onlineError } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .in('room_id', roomIds)
      .eq('status', 'online')
      .gte('last_heartbeat', tenMinutesAgo)

    if (totalError || onlineError) throw totalError || onlineError

    return {
      total: totalCount || 0,
      online: onlineCount || 0
    }
  } catch (error) {
    console.error('Error counting devices:', error)
    return { total: 0, online: 0 }
  }
}