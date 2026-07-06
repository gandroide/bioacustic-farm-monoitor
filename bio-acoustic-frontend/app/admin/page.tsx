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
  MapPin,
  Eye,
  EyeOff
} from "lucide-react";
import { HardwareFleetManagement } from "@/components/admin/hardware-fleet-management";
import { KPISkeleton } from "@/components/dashboard/kpi-skeleton";
import { KPICard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
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
  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordVisible, setInvitePasswordVisible] = useState(false);
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
    setInvitePassword("");
    setInviteDialogOpen(true);
  };

  const handleSendInvite = async () => {
    if (!inviteEmail || !selectedOrgId || !invitePassword || invitePassword.length < 6) {
      toast.error('El email y la contraseña temporal (mínimo 6 caracteres) son obligatorios');
      return;
    }

    setInviting(true);
    try {
      const result = await inviteUserToOrganization(inviteEmail, selectedOrgId, inviteFullName, invitePassword);

      if (result.success) {
        toast.success(result.message);
        setInviteDialogOpen(false);
        setInviteEmail("");
        setInviteFullName("");
        setInvitePassword("");
      } else {
        toast.error(result.error || 'Error al crear la cuenta');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('Error al crear la cuenta');
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
        <PageHeader
          title="Centro de Comando"
          subtitle="Monitoreo de flota IoT, suscripciones y salud del negocio"
          actions={
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Actualizar"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              </Button>
              <Button onClick={() => setCreateOrgDialogOpen(true)} className="gap-2">
                <Building className="h-4 w-4" />
                <span className="hidden sm:inline">Nueva Organización</span>
              </Button>
            </>
          }
        />

        {/* KPIs */}
        {loading ? (
          <KPISkeleton />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KPICard
              stagger={1}
              tone="emerald"
              title="MRR (Ingresos)"
              icon={<DollarSign className="h-[18px] w-[18px] text-emerald-500" strokeWidth={2} />}
              value={`$${totalMRR.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              subtitle="Estado financiero mensual"
              footer={
                totalMRR > 0 && (
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                    <Badge variant="outline" className="text-[10px] font-mono alert-success">
                      {organizations.length} organizaciones
                    </Badge>
                  </div>
                )
              }
            />

            <KPICard
              stagger={2}
              tone={offlineNodes > 0 ? "red" : "emerald"}
              className={offlineNodes > 0 ? "border-red-500/20" : undefined}
              title="Salud de la Flota"
              icon={
                <Cpu
                  className={cn(
                    "h-[18px] w-[18px]",
                    offlineNodes > 0 ? "text-red-500" : "text-emerald-500",
                  )}
                  strokeWidth={2}
                />
              }
              value={`${onlineNodes}/${totalNodes} Online`}
              subtitle={`Dispositivos en ${sites.length} sitios`}
              footer={
                offlineNodes > 0 ? (
                  <Badge variant="outline" className="text-[10px] font-mono alert-danger">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {offlineNodes} nodos offline
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] font-mono alert-success">
                    Flota operativa
                  </Badge>
                )
              }
            />

            <KPICard
              stagger={3}
              tone="primary"
              title="Costos de Nube"
              icon={<CloudLightning className="h-[18px] w-[18px] text-primary" strokeWidth={2} />}
              value="Supabase"
              subtitle="Uso de recursos cloud"
              footer={
                <Badge variant="outline" className="text-[10px] font-mono alert-warning">
                  Plan activo
                </Badge>
              }
            />

            <KPICard
              stagger={4}
              tone="primary"
              title="Suscripciones"
              icon={<Users className="h-[18px] w-[18px] text-primary" strokeWidth={2} />}
              value={`${activeSubscriptions} Activas`}
              subtitle="Clientes pagando actualmente"
              footer={
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <Badge variant="outline" className="text-[10px] font-mono alert-success">
                    {organizations.length - activeSubscriptions} en trial
                  </Badge>
                </div>
              }
            />
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
              Crear Cuenta de Admin
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>Crea una nueva cuenta de administrador para esta organización.</p>
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

            <div className="space-y-2">
              <Label htmlFor="invitePassword">
                Contraseña Temporal <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="invitePassword"
                  type={invitePasswordVisible ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  disabled={inviting}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setInvitePasswordVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={invitePasswordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {invitePasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5" strokeWidth={2} />
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground mb-1">Aprovisionamiento Directo</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>La cuenta se activará inmediatamente y el admin podrá hacer login con estas credenciales</li>
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
                  Creando...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Crear Admin
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
