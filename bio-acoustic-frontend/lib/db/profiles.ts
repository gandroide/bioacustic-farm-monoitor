import { supabase } from '@/lib/supabase/client'
import type { Profile } from './types'

export async function getCurrentUserProfile(): Promise<Profile | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (error) throw error

    // MOCK / FALLBACK: Enforce real IDs if profile is missing or missing fields
    const defaultOrgId = '422c7814-0efc-4877-a8e2-277270a7b7f8'
    const defaultSiteId = 'deb0f8b5-17d5-432e-af14-3a888216551c'

    if (!data) {
      return {
        id: user.id,
        organization_id: defaultOrgId,
        assigned_site_id: defaultSiteId,
        role: 'site_manager',
        full_name: user.email || 'Usuario',
        email: user.email || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Profile
    }

    if (!data.organization_id) data.organization_id = defaultOrgId
    if (!data.assigned_site_id) data.assigned_site_id = defaultSiteId

    return data
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
}

export async function isSuperAdmin(): Promise<boolean> {
  const profile = await getCurrentUserProfile()
  return profile?.role === 'super_admin'
}

export async function getUserOrganizationId(): Promise<string | null> {
  const profile = await getCurrentUserProfile()
  return profile?.organization_id || null
}
