import { supabase } from '@/lib/supabase/client'
import type { Site, SiteWithOrganization } from './types'

export async function getSitesByOrganization(organizationId?: string): Promise<SiteWithOrganization[]> {
  try {
    let query = supabase
      .from('sites')
      .select(`
        *,
        organization:organizations(*)
      `)

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

export async function getSiteById(siteId: string): Promise<SiteWithOrganization | null> {
  try {
    const { data, error } = await supabase
      .from('sites')
      .select(`
        *,
        organization:organizations(*)
      `)
      .eq('id', siteId)
      .maybeSingle()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching site:', error)
    return null
  }
}

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
      })
      .select()
      .maybeSingle()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating site:', error)
    return null
  }
}
