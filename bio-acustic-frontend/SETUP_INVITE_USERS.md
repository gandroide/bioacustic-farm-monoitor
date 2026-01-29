# Configuración del Sistema de Invitación de Usuarios

## Variables de Entorno Requeridas

Para que el sistema de invitación de usuarios funcione correctamente, necesitas agregar la siguiente variable de entorno a tu archivo `.env.local`:

```bash
# Supabase Service Role Key (SOLO para server-side)
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

### ⚠️ IMPORTANTE: Seguridad

- Esta key **NUNCA** debe exponerse al cliente
- Solo se usa en API routes del servidor (`/api/admin/invite-user`)
- Tiene privilegios completos sobre tu base de datos

### Dónde Obtener la Service Role Key

1. Ve a tu proyecto de Supabase: https://supabase.com/dashboard
2. Selecciona tu proyecto
3. Ve a **Settings** → **API**
4. Copia la **service_role** key (NO la anon key)
5. Agrégala a tu archivo `.env.local`

## Configuración de Email en Supabase

Para que las invitaciones por email funcionen:

1. Ve a **Authentication** → **Email Templates**
2. Configura los templates de email:
   - **Confirm signup**: Template para usuarios invitados
   - Personaliza el mensaje y el link de redirect

3. Configura el **Site URL** en **Settings** → **General**:
   ```
   http://localhost:3000  (desarrollo)
   https://tudominio.com  (producción)
   ```

## Cómo Funciona

1. **Super Admin** hace clic en "Invitar Admin" en la tabla de sites
2. Ingresa email y nombre del nuevo administrador
3. El sistema:
   - Envía invitación vía `supabase.auth.admin.inviteUserByEmail()`
   - Crea/actualiza el profile con `organization_id` y `role='org_admin'`
   - El usuario recibe un email con link de activación
4. El usuario hace clic en el link y establece su contraseña
5. Al hacer login, es redirigido a `/dashboard` con acceso a su organización

## Troubleshooting

### "Error al enviar invitación"
- Verifica que `SUPABASE_SERVICE_ROLE_KEY` esté configurada
- Revisa que el email no esté ya registrado
- Verifica los logs de la API route: `/api/admin/invite-user`

### "Usuario no tiene acceso a la organización"
- Verifica que el profile tenga `organization_id` correcto
- Revisa las políticas RLS de Supabase
- Ejecuta esta query para verificar:
  ```sql
  SELECT id, email, organization_id, role 
  FROM profiles 
  WHERE email = 'usuario@ejemplo.com';
  ```

### Emails no se envían
- Verifica la configuración de SMTP en Supabase (Settings → Auth)
- Para desarrollo local, puedes ver los emails en los logs de Supabase
- En producción, configura un proveedor de email (SendGrid, AWS SES, etc.)

## Testing

Para probar la funcionalidad:

1. Asegúrate de estar logueado como Super Admin
2. Ve a `/admin`
3. En la tabla de sites, haz clic en "Invitar Admin"
4. Ingresa un email de prueba
5. Verifica que el email llegue (revisa spam si es necesario)
6. Abre el link de invitación y completa el registro

## Flujo Completo

```
Super Admin → [Invitar Admin] → Ingresa email
     ↓
API Route (/api/admin/invite-user)
     ↓
Supabase Admin API: inviteUserByEmail()
     ↓
Email enviado con link de activación
     ↓
Usuario hace clic en link → Establece contraseña
     ↓
Profile actualizado con organization_id + role='org_admin'
     ↓
Usuario puede hacer login y acceder a su dashboard
```

## Permisos del Usuario Invitado

El usuario invitado como `org_admin` tendrá:

- ✅ Acceso completo a todos los sites de su organización
- ✅ Puede crear buildings, rooms y vincular devices
- ✅ Puede ver todos los eventos y alertas de su organización
- ❌ NO puede crear nuevos sites (eso requiere super_admin)
- ❌ NO puede ver/editar otras organizaciones

## Notas Adicionales

- Los usuarios invitados recibirán un email de Supabase con el subject: "You have been invited to join..."
- El link de invitación expira después de 24 horas (configurable en Supabase)
- Si el usuario ya existe con ese email, se actualizará su organización
- Los usuarios pueden cambiar su contraseña desde el dashboard

