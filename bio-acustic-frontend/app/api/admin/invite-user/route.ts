import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Cliente de Supabase con service role (admin privileges)
// IMPORTANTE: Solo usar en server-side
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // Service role key (server-only)
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function POST(request: NextRequest) {
  try {
    // Verificar que el usuario actual es super_admin
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // Crear cliente regular con el token del usuario
    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            authorization: authHeader
          }
        }
      }
    );

    // Verificar rol de super_admin
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Permisos insuficientes' }, { status: 403 });
    }

    // Parsear body de la request
    const { email, fullName, organizationId } = await request.json();

    if (!email || !organizationId) {
      return NextResponse.json(
        { error: 'Email y organizationId son requeridos' },
        { status: 400 }
      );
    }

    // Validar que la organización existe
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      return NextResponse.json(
        { error: 'Organización no encontrada' },
        { status: 404 }
      );
    }

    // Invitar usuario usando service role
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
        data: {
          full_name: fullName || email.split('@')[0],
          organization_id: organizationId,
          role: 'org_admin'
        }
      }
    );

    if (inviteError) {
      console.error('Error inviting user:', inviteError);
      return NextResponse.json(
        { error: `Error al enviar invitación: ${inviteError.message}` },
        { status: 500 }
      );
    }

    // El usuario fue invitado, ahora necesitamos crear su profile
    // El trigger on_auth_user_created lo creará automáticamente,
    // pero vamos a actualizarlo para asegurar que tenga el organization_id correcto
    if (inviteData?.user?.id) {
      // Esperar un momento para que el trigger cree el profile
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Actualizar el profile con los datos correctos
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: inviteData.user.id,
          organization_id: organizationId,
          role: 'org_admin',
          full_name: fullName || email.split('@')[0],
          email: email
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        console.error('Error updating profile:', profileError);
        // No fallar la request, el usuario ya fue invitado
      }
    }

    return NextResponse.json({
      success: true,
      message: `Invitación enviada a ${email}`,
      user: inviteData?.user,
      organization: org.name
    });

  } catch (error) {
    console.error('Error in invite-user API:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

