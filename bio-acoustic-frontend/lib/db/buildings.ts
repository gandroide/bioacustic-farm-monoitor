import { supabase } from '@/lib/supabase/client'
import type { Building } from './types'

export async function getBuildingsBySite(siteId: string): Promise<Building[]> {
  try {
    const { data, error } = await supabase
      .from('buildings')
      .select('*')
      .eq('site_id', siteId)
      .order('name', { ascending: true })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching buildings:', error)
    return []
  }
}

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
      })
      .select()
      .maybeSingle()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating building:', error)
    return null
  }
}

export async function updateBuilding(
  buildingId: string,
  updates: { name?: string; building_type?: string; capacity?: number }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('buildings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', buildingId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error updating building:', error)
    return false
  }
}

export async function deleteBuilding(buildingId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('buildings')
      .delete()
      .eq('id', buildingId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('Error deleting building:', error)
    return false
  }
}
