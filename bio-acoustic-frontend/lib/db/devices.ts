import { supabase } from '@/lib/supabase/client'
import type { DeviceWithLocation } from './types'

export async function getDevicesByRoom(roomId: string): Promise<DeviceWithLocation[]> {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select(`
        *,
        uid,
        mac_address,
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

export async function claimDeviceToRoom(deviceUid: string, roomId: string): Promise<boolean> {
  try {
    const { data: device, error: findError } = await supabase
      .from('devices')
      .select('id')
      .eq('uid', deviceUid)
      .maybeSingle()

    if (findError || !device) {
      console.error('Device not found:', deviceUid)
      return false
    }

    const { error: updateError } = await supabase
      .from('devices')
      .update({
        room_id: roomId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', device.id)

    if (updateError) throw updateError
    return true
  } catch (error) {
    console.error('Error claiming device:', error)
    return false
  }
}

export async function getDeviceCountBySite(siteId: string): Promise<{ total: number; online: number }> {
  try {
    const { data: buildings, error: buildingsError } = await supabase
      .from('buildings')
      .select('id')
      .eq('site_id', siteId)

    if (buildingsError) throw buildingsError
    if (!buildings || buildings.length === 0) return { total: 0, online: 0 }

    const buildingIds = buildings.map((b) => b.id)

    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id')
      .in('building_id', buildingIds)

    if (roomsError) throw roomsError
    if (!rooms || rooms.length === 0) return { total: 0, online: 0 }

    const roomIds = rooms.map((r) => r.id)

    const { count: totalCount, error: totalError } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .in('room_id', roomIds)

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
      online: onlineCount || 0,
    }
  } catch (error) {
    console.error('Error counting devices:', error)
    return { total: 0, online: 0 }
  }
}
