import { supabase } from '@/lib/supabase/client'

export async function inviteUserToOrganization(
  email: string,
  organizationId: string,
  fullName?: string,
  password?: string
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return { success: false, message: '', error: 'No hay sesión activa' }
    }

    const response = await fetch('/api/admin/invite-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email,
        organizationId,
        fullName,
        password,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        message: '',
        error: data.error || 'Error al enviar invitación',
      }
    }

    return {
      success: true,
      message: data.message || 'Invitación enviada correctamente',
      error: undefined,
    }
  } catch (error) {
    console.error('Error inviting user:', error)
    return {
      success: false,
      message: '',
      error: 'Error de conexión al enviar invitación',
    }
  }
}
