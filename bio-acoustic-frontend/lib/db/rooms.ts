import { supabase } from '@/lib/supabase/client'
import type { Room } from './types'

export async function getRoomsByBuilding(buildingId: string): Promise<Room[]> {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('building_id', buildingId)
      .order('name', { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching rooms:', error)
    return []
  }
}

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
      })
      .select()
      .maybeSingle()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating room:', error)
    return null
  }
}

export async function updateRoom(
  roomId: string,
  updates: { name?: string; room_type?: string; capacity?: number }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('rooms')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', roomId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error updating room:', error)
    return false
  }
}

export async function deleteRoom(roomId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error deleting room:', error)
    return false
  }
}
