import { CookieOptions, createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'


export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. Rutas Públicas: Dejar pasar siempre
  const publicRoutes = ['/login', '/auth/callback', '/']
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // 2. Configurar respuesta inicial
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // 3. Crear cliente Supabase seguro para Middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // Actualizamos la cookie en la respuesta si es necesario
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  try {
    // 4. Verificar Sesión
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      // Si no hay usuario, redirección al login recordando a dónde quería ir
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // 5. Verificar Rol (Lógica de Tráfico)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role

    // CASO A: Super Admin intentando ver el dashboard de granja -> Mandar a Admin
    if (role === 'super_admin' && pathname === '/dashboard') {
      return NextResponse.redirect(new URL('/admin', request.url))
    }

    // CASO B: Usuario Normal intentando ver Admin -> Mandar a Dashboard
    if (role !== 'super_admin' && pathname.startsWith('/admin')) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    return response

  } catch (error) {
    console.error('Middleware Error:', error)
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}