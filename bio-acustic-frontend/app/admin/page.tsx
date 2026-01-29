"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  supabase, 
  SiteWithOrganization,
  Organization,
  getCurrentUserProfile,
  getAllOrganizations,
  getSitesByOrganization,
  getDeviceCountBySite,
  inviteUserToOrganization,
  createOrganization,
  createSite
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  DollarSign, 
  Cpu, 
  CloudLightning, 
  Users, 
  LogOut, 
  RefreshCw, 
  Shield,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  Mail,
  Loader2,
  Package,
  Building,
  MapPin
} from "lucide-react";
import { HardwareFleetManagement } from "@/components/admin/hardware-fleet-management";

export const dynamic = 'force-dynamic';

// ============ TIPOS EXTENDIDOS PARA EL DASHBOARD ============

interface SiteWithHardwareMetrics extends SiteWithOrganization {
  total_nodes: number;
  online_nodes: number;
  subscription_plan: 'Enterprise' | 'Pro' | 'Basic';
  subscription_status: 'active' | 'trial' | 'suspended';
  mrr: number;
}

export default function AdminPage() {
  const router = useRouter();
  
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [sites, setSites] = useState<SiteWithHardwareMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState<string>("");

  // Invite user dialog
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteNotification, setInviteNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create organization dialog
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [orgFormData, setOrgFormData] = useState({
    name: "",
    slug: "",
    siteName: "",
    plan: "Pro" as 'Enterprise' | 'Pro' | 'Basic',
    billingEmail: ""
  });
  const [creatingOrg, setCreatingOrg] = useState(false);

  // Calcular métricas del negocio
  const totalMRR = sites.reduce((sum, site) => sum + site.mrr, 0);
  const totalNodes = sites.reduce((sum, site) => sum + site.total_nodes, 0);
  const onlineNodes = sites.reduce((sum, site) => sum + site.online_nodes, 0);
  const activeSubscriptions = organizations.filter(org => org.subscription_status === 'active').length;
  const offlineNodes = totalNodes - onlineNodes;

  const fetchData = async () => {
    try {
      // Verificar rol de Super Admin
      const profile = await getCurrentUserProfile();
      if (profile?.role !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      setUserName(profile.full_name || profile.id);

      // Obtener todas las organizaciones (Super Admin ve todo)
      const orgsData = await getAllOrganizations();
      setOrganizations(orgsData);

      // Obtener todos los sites con sus organizaciones
      const sitesData = await getSitesByOrganization();

      // Calcular métricas de hardware para cada site
      const sitesWithMetrics = await Promise.all(
        sitesData.map(async (site) => {
          const deviceCount = await getDeviceCountBySite(site.id);
          
          // Calcular MRR basado en plan de la organización
          const mrrByPlan: Record<string, number> = {
            'Enterprise': 800,
            'Pro': 450,
            'Basic': 200
          };

          return {
            ...site,
            total_nodes: deviceCount.total,
            online_nodes: deviceCount.online,
            subscription_plan: site.organization.subscription_plan,
            subscription_status: site.organization.subscription_status,
            mrr: mrrByPlan[site.organization.subscription_plan] || 0
          };
        })
      );

      setSites(sitesWithMetrics);

    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleInviteUser = (organizationId: string) => {
    setSelectedOrgId(organizationId);
    setInviteEmail("");
    setInviteFullName("");
    setInviteDialogOpen(true);
  };

  const handleSendInvite = async () => {
    if (!inviteEmail || !selectedOrgId) return;

    setInviting(true);
    try {
      const result = await inviteUserToOrganization(inviteEmail, selectedOrgId, inviteFullName);

      if (result.success) {
        setInviteNotification({ type: 'success', message: result.message });
        setInviteDialogOpen(false);
        setInviteEmail("");
        setInviteFullName("");
        setTimeout(() => setInviteNotification(null), 5000);
      } else {
        setInviteNotification({ type: 'error', message: result.error || 'Error al enviar invitación' });
        setTimeout(() => setInviteNotification(null), 5000);
      }
    } catch (error) {
      console.error('Error sending invite:', error);
      setInviteNotification({ type: 'error', message: 'Error al enviar invitación' });
      setTimeout(() => setInviteNotification(null), 5000);
    } finally {
      setInviting(false);
    }
  };

  const handleCreateOrganization = async () => {
    if (!orgFormData.name.trim() || !orgFormData.siteName.trim()) {
      setInviteNotification({ type: 'error', message: '❌ Nombre de organización y site son obligatorios' });
      setTimeout(() => setInviteNotification(null), 3000);
      return;
    }

    setCreatingOrg(true);
    try {
      // Generar slug automático si no se proporcionó
      const slug = orgFormData.slug.trim() || 
                   orgFormData.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

      // Crear organización
      const newOrg = await createOrganization(
        orgFormData.name.trim(),
        slug,
        orgFormData.plan,
        orgFormData.billingEmail.trim() || undefined
      );

      if (!newOrg) {
        setInviteNotification({ type: 'error', message: '❌ Error al crear organización' });
        setTimeout(() => setInviteNotification(null), 5000);
        setCreatingOrg(false);
        return;
      }

      // Crear site inicial para la organización
      const newSite = await createSite(
        newOrg.id,
        orgFormData.siteName.trim(),
        undefined,
        undefined
      );

      if (!newSite) {
        setInviteNotification({ type: 'error', message: '⚠️ Organización creada pero error al crear site' });
        setTimeout(() => setInviteNotification(null), 5000);
      } else {
        setInviteNotification({ 
          type: 'success', 
          message: `✅ Organización "${newOrg.name}" creada correctamente` 
        });
        setTimeout(() => setInviteNotification(null), 5000);
      }

      // Cerrar dialog y refrescar datos
      setCreateOrgDialogOpen(false);
      setOrgFormData({
        name: "",
        slug: "",
        siteName: "",
        plan: "Pro",
        billingEmail: ""
      });
      await fetchData();
    } catch (error) {
      console.error('Error creating organization:', error);
      setInviteNotification({ type: 'error', message: '❌ Error al crear organización' });
      setTimeout(() => setInviteNotification(null), 5000);
    } finally {
      setCreatingOrg(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-12 w-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary glow-warning" strokeWidth={2.5} />
              <div>
                <h1 className="text-xl font-bold tracking-tight">Ontiveros Bio-Alert</h1>
                <p className="text-xs text-muted-foreground">Panel de Super Administrador</p>
              </div>
            </div>

            {/* User Info & Actions */}
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => router.push('/admin/inventory')}
                className="gap-2"
                title="Gestionar inventario de hardware"
              >
                <Package className="h-4 w-4" />
                <span className="hidden md:inline">Inventario</span>
              </Button>
              <div className="hidden md:flex flex-col items-end">
                <span className="text-sm font-medium">{userName}</span>
                <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-500">
                  Super Admin
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Actualizar"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleLogout} title="Cerrar Sesión">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome Section */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Centro de Comando Hardware & SaaS</h2>
            <p className="text-sm text-muted-foreground">
              Monitoreo de flota IoT, suscripciones y salud del negocio
            </p>
          </div>
          <Button
            onClick={() => setCreateOrgDialogOpen(true)}
            className="gap-2"
          >
            <Building className="h-4 w-4" />
            Nueva Organización
          </Button>
        </div>

        {/* Business & Hardware KPIs */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          
          {/* KPI 1: MRR (Ingresos Recurrentes) */}
          <Card className="glass-effect hover:border-emerald-500/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                MRR (Ingresos)
              </CardTitle>
              <div className="glow-success">
                <DollarSign className="h-5 w-5 text-emerald-500" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-500">
                ${totalMRR.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Estado financiero mensual
              </p>
              <div className="flex items-center gap-2 mt-3">
                <TrendingUp className="h-3 w-3 text-emerald-500" />
                <Badge variant="outline" className="text-[10px] font-mono alert-success">
                  +12% vs mes anterior
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* KPI 2: Salud Global de la Flota (CRÍTICO) */}
          <Card className={`glass-effect transition-all duration-300 ${
            offlineNodes > 0 
              ? 'hover:border-red-500/30 border-red-500/20' 
              : 'hover:border-emerald-500/30'
          }`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Salud de la Flota IoT
              </CardTitle>
              <div className={offlineNodes > 0 ? 'glow-danger' : 'glow-success'}>
                <Cpu className={`h-5 w-5 ${offlineNodes > 0 ? 'text-red-500' : 'text-emerald-500'}`} strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${offlineNodes > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {onlineNodes}/{totalNodes} Online
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Dispositivos IoT en {sites.length} sitios
              </p>
              {offlineNodes > 0 ? (
                <div className="flex items-center gap-2 mt-3">
                  <AlertCircle className="h-3 w-3 text-red-500" />
                  <Badge variant="outline" className="text-[10px] font-mono alert-danger">
                    {offlineNodes} Nodos Offline - Requieren atención
                  </Badge>
                </div>
              ) : (
                <Badge variant="outline" className="text-[10px] font-mono mt-3 alert-success">
                  ✓ Toda la flota operativa
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* KPI 3: Costos de Nube */}
          <Card className="glass-effect hover:border-amber-500/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Costos de Nube
              </CardTitle>
              <div className="glow-warning">
                <CloudLightning className="h-5 w-5 text-amber-500" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">
                Storage: 45%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Uso de recursos Supabase/Vercel
              </p>
              <Badge variant="outline" className="text-[10px] font-mono mt-3 alert-warning">
                ⚡ Bajo control
              </Badge>
            </CardContent>
          </Card>

          {/* KPI 4: Suscripciones Activas */}
          <Card className="glass-effect hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Suscripciones
              </CardTitle>
              <div className="glow-warning">
                <Users className="h-5 w-5 text-primary" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {activeSubscriptions} Activas
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Clientes pagando actualmente
              </p>
              <div className="flex items-center gap-2 mt-3">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <Badge variant="outline" className="text-[10px] font-mono alert-success">
                  {organizations.length - activeSubscriptions} En trial
                </Badge>
              </div>
            </CardContent>
          </Card>
          
        </div>

        {/* Invite User Notification */}
        {inviteNotification && (
          <Card className={`${
            inviteNotification.type === 'success' 
              ? 'border-emerald-500/50 bg-emerald-500/10' 
              : 'border-red-500/50 bg-red-500/10'
          }`}>
            <CardContent className="p-4 flex items-center gap-2">
              {inviteNotification.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500" />
              )}
              <span className="text-sm font-medium">{inviteNotification.message}</span>
            </CardContent>
          </Card>
        )}

        {/* Hardware Fleet Management Section */}
        <HardwareFleetManagement 
          sites={sites} 
          organizations={organizations} 
          onUpdate={fetchData}
          onInviteUser={handleInviteUser}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-16">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div>
              <span className="font-semibold">Ontiveros Bio-Alert</span> v1.0.0 | Plataforma SaaS Multi-Tenant
            </div>
            <div>
              Super Admin Dashboard | © {new Date().getFullYear()}
            </div>
          </div>
        </div>
      </footer>

      {/* Invite User Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Invitar Admin de Organización
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>Envía una invitación por email para que el administrador pueda acceder a su organización.</p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="inviteEmail" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email del Usuario
              </Label>
              <Input
                id="inviteEmail"
                type="email"
                placeholder="cliente@ejemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviting}
              />
              <p className="text-xs text-muted-foreground">
                Se enviará un correo de invitación a esta dirección
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inviteFullName">
                Nombre Completo (Opcional)
              </Label>
              <Input
                id="inviteFullName"
                type="text"
                placeholder="Juan Pérez"
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                disabled={inviting}
              />
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5" strokeWidth={2} />
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground mb-1">ℹ️ Información importante</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>El usuario recibirá un email con un link de activación</li>
                    <li>Se le asignará automáticamente el rol de <strong>Org Admin</strong></li>
                    <li>Tendrá acceso completo a todos los sites de la organización</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setInviteDialogOpen(false)}
              disabled={inviting}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleSendInvite}
              disabled={inviting || !inviteEmail}
            >
              {inviting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Enviar Invitación
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Organization Dialog */}
      <Dialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building className="h-5 w-5 text-primary" />
              Crear Nueva Organización
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>Registra una nueva organización cliente en el sistema. Se creará automáticamente un site inicial.</p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Información de la Organización */}
            <div className="space-y-4 border-b border-border pb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Building className="h-4 w-4" />
                Información de la Organización
              </h3>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="orgName">
                    Nombre de la Organización <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="orgName"
                    placeholder="ej: Grupo Porcícola Los Pinos"
                    value={orgFormData.name}
                    onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })}
                    disabled={creatingOrg}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orgSlug">
                    Slug (Opcional)
                  </Label>
                  <Input
                    id="orgSlug"
                    placeholder="ej: grupo-pinos (auto-generado)"
                    value={orgFormData.slug}
                    onChange={(e) => setOrgFormData({ ...orgFormData, slug: e.target.value })}
                    disabled={creatingOrg}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se genera automáticamente si se deja vacío
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="orgPlan">Plan de Suscripción</Label>
                  <Select 
                    value={orgFormData.plan} 
                    onValueChange={(value: 'Enterprise' | 'Pro' | 'Basic') => 
                      setOrgFormData({ ...orgFormData, plan: value })
                    }
                    disabled={creatingOrg}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Basic">Basic - $200/mes</SelectItem>
                      <SelectItem value="Pro">Pro - $450/mes</SelectItem>
                      <SelectItem value="Enterprise">Enterprise - $800/mes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingEmail">
                    Email de Facturación (Opcional)
                  </Label>
                  <Input
                    id="billingEmail"
                    type="email"
                    placeholder="ej: facturacion@cliente.com"
                    value={orgFormData.billingEmail}
                    onChange={(e) => setOrgFormData({ ...orgFormData, billingEmail: e.target.value })}
                    disabled={creatingOrg}
                  />
                </div>
              </div>
            </div>

            {/* Información del Site Inicial */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Site Inicial
              </h3>
              
              <div className="space-y-2">
                <Label htmlFor="siteName">
                  Nombre del Site Inicial <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="siteName"
                  placeholder="ej: Granja Principal - Jalisco"
                  value={orgFormData.siteName}
                  onChange={(e) => setOrgFormData({ ...orgFormData, siteName: e.target.value })}
                  disabled={creatingOrg}
                />
                <p className="text-xs text-muted-foreground">
                  Se creará automáticamente un site inicial para la organización
                </p>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5" strokeWidth={2} />
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground mb-1">ℹ️ Qué se creará</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Organización con estado <strong>trial</strong></li>
                    <li>Un site inicial vinculado a la organización</li>
                    <li>Una vez creada, podrás invitar al administrador</li>
                    <li>El admin podrá crear buildings, rooms y vincular devices</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setCreateOrgDialogOpen(false)}
              disabled={creatingOrg}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleCreateOrganization}
              disabled={creatingOrg || !orgFormData.name.trim() || !orgFormData.siteName.trim()}
            >
              {creatingOrg ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                <>
                  <Building className="h-4 w-4 mr-2" />
                  Crear Organización
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

