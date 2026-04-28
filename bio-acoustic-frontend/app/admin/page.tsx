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
  RefreshCw, 
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  Mail,
  Loader2,
  Building,
  MapPin
} from "lucide-react";
import { HardwareFleetManagement } from "@/components/admin/hardware-fleet-management";
import { KPISkeleton } from "@/components/dashboard/kpi-skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

  // Invite user dialog
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");
  const [inviting, setInviting] = useState(false);

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
      const profile = await getCurrentUserProfile();
      if (profile?.role !== 'super_admin') {
        router.push('/dashboard');
        return;
      }

      const orgsData = await getAllOrganizations();
      setOrganizations(orgsData);

      const sitesData = await getSitesByOrganization();

      const sitesWithMetrics = await Promise.all(
        sitesData.map(async (site) => {
          const deviceCount = await getDeviceCountBySite(site.id);
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
    toast.info("Actualizando datos...");
    fetchData().then(() => toast.success("Datos actualizados"));
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
        toast.success(result.message);
        setInviteDialogOpen(false);
        setInviteEmail("");
        setInviteFullName("");
      } else {
        toast.error(result.error || 'Error al enviar invitación');
      }
    } catch (error) {
      console.error('Error sending invite:', error);
      toast.error('Error al enviar invitación');
    } finally {
      setInviting(false);
    }
  };

  const handleCreateOrganization = async () => {
    if (!orgFormData.name.trim() || !orgFormData.siteName.trim()) {
      toast.error('Nombre de organización y site son obligatorios');
      return;
    }

    setCreatingOrg(true);
    try {
      const slug = orgFormData.slug.trim() || 
                   orgFormData.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const newOrg = await createOrganization(
        orgFormData.name.trim(),
        slug,
        orgFormData.plan,
        orgFormData.billingEmail.trim() || undefined
      );

      if (!newOrg) {
        toast.error('Error al crear organización');
        setCreatingOrg(false);
        return;
      }

      const newSite = await createSite(
        newOrg.id,
        orgFormData.siteName.trim(),
        undefined,
        undefined
      );

      if (!newSite) {
        toast.warning('Organización creada pero error al crear site');
      } else {
        toast.success(`Organización "${newOrg.name}" creada correctamente`);
      }

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
      toast.error('Error al crear organización');
    } finally {
      setCreatingOrg(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-card/30">
      {/* Page Content */}
      <div className="px-6 lg:px-8 py-8 space-y-8">
        {/* Page Header */}
        <div className="flex items-center justify-between animate-in-view stagger-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Centro de Comando</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitoreo de flota IoT, suscripciones y salud del negocio
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
            <Button
              onClick={() => setCreateOrgDialogOpen(true)}
              className="gap-2"
            >
              <Building className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva Organización</span>
            </Button>
          </div>
        </div>

        {/* KPIs */}
        {loading ? (
          <KPISkeleton />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* KPI 1: MRR */}
            <Card className="glass-effect card-hover animate-in-view stagger-1">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  MRR (Ingresos)
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                  <DollarSign className="h-[18px] w-[18px] text-emerald-500" strokeWidth={2} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-500 tracking-tight">
                  ${totalMRR.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Estado financiero mensual
                </p>
                {totalMRR > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                    <Badge variant="outline" className="text-[10px] font-mono alert-success">
                      {organizations.length} organizaciones
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* KPI 2: Fleet Health */}
            <Card className={cn(
              "glass-effect card-hover animate-in-view stagger-2",
              offlineNodes > 0 && "border-red-500/20"
            )}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Salud de la Flota
                </CardTitle>
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  offlineNodes > 0 ? "bg-red-500/10" : "bg-emerald-500/10"
                )}>
                  <Cpu className={cn("h-[18px] w-[18px]", offlineNodes > 0 ? "text-red-500" : "text-emerald-500")} strokeWidth={2} />
                </div>
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-bold tracking-tight", offlineNodes > 0 ? "text-red-500" : "text-emerald-500")}>
                  {onlineNodes}/{totalNodes} Online
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Dispositivos en {sites.length} sitios
                </p>
                <div className="mt-3">
                  {offlineNodes > 0 ? (
                    <Badge variant="outline" className="text-[10px] font-mono alert-danger">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {offlineNodes} nodos offline
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-mono alert-success">
                      ✓ Flota operativa
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* KPI 3: Cloud Costs */}
            <Card className="glass-effect card-hover animate-in-view stagger-3">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Costos de Nube
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <CloudLightning className="h-[18px] w-[18px] text-primary" strokeWidth={2} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary tracking-tight">
                  Supabase
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Uso de recursos cloud
                </p>
                <div className="mt-3">
                  <Badge variant="outline" className="text-[10px] font-mono alert-warning">
                    ⚡ Plan activo
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* KPI 4: Subscriptions */}
            <Card className="glass-effect card-hover animate-in-view stagger-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Suscripciones
                </CardTitle>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-[18px] w-[18px] text-primary" strokeWidth={2} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary tracking-tight">
                  {activeSubscriptions} Activas
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Clientes pagando actualmente
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <Badge variant="outline" className="text-[10px] font-mono alert-success">
                    {organizations.length - activeSubscriptions} en trial
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Hardware Fleet Management Section */}
        {!loading && (
          <div className="animate-in-view stagger-5">
            <HardwareFleetManagement 
              sites={sites} 
              organizations={organizations} 
              onUpdate={fetchData}
              onInviteUser={handleInviteUser}
            />
          </div>
        )}
      </div>

      {/* ===== DIALOGS ===== */}

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
                  <p className="font-semibold text-foreground mb-1">Información importante</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>El usuario recibirá un email con un link de activación</li>
                    <li>Se le asignará el rol de <strong>Org Admin</strong></li>
                    <li>Tendrá acceso a todos los sites de la organización</li>
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
                <p>Registra una nueva organización cliente. Se creará un site inicial automáticamente.</p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-4 border-b border-border pb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Building className="h-4 w-4" />
                Información de la Organización
              </h3>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="orgName">
                    Nombre <span className="text-red-500">*</span>
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
                    placeholder="auto-generado"
                    value={orgFormData.slug}
                    onChange={(e) => setOrgFormData({ ...orgFormData, slug: e.target.value })}
                    disabled={creatingOrg}
                    className="font-mono text-sm"
                  />
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
                      <SelectItem value="Basic">Basic — $200/mes</SelectItem>
                      <SelectItem value="Pro">Pro — $450/mes</SelectItem>
                      <SelectItem value="Enterprise">Enterprise — $800/mes</SelectItem>
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
                    placeholder="facturacion@cliente.com"
                    value={orgFormData.billingEmail}
                    onChange={(e) => setOrgFormData({ ...orgFormData, billingEmail: e.target.value })}
                    disabled={creatingOrg}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Site Inicial
              </h3>
              
              <div className="space-y-2">
                <Label htmlFor="siteName">
                  Nombre del Site <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="siteName"
                  placeholder="ej: Granja Principal - Jalisco"
                  value={orgFormData.siteName}
                  onChange={(e) => setOrgFormData({ ...orgFormData, siteName: e.target.value })}
                  disabled={creatingOrg}
                />
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
