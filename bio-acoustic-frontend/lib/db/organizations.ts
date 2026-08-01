import { supabase } from '@/lib/supabase/client'
import { getUserOrganizationId } from './profiles'
import type { Organization } from './types'

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

export async function getUserOrganization(): Promise<Organization | null> {
  try {
    const orgId = await getUserOrganizationId()
    if (!orgId) return null

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching user organization:', error)
    return null
  }
}

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
        billing_email: billingEmail || null,
      })
      .select()
      .maybeSingle()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error creating organization:', error)
    return null
  }
}
