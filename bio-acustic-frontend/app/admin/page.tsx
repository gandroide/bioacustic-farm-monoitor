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
  getDeviceCountBySite
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  CheckCircle2
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

        {/* Hardware Fleet Management Section */}
        <HardwareFleetManagement sites={sites} organizations={organizations} onUpdate={fetchData} />
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
    </div>
  );
}

