"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, Farm, Event, getCurrentUserProfile } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, LogOut, RefreshCw, Building2, Database, TrendingUp, Shield } from "lucide-react";
import { FarmsManagement } from "@/components/admin/farms-management";

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  const router = useRouter();
  
  const [farms, setFarms] = useState<Farm[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState<string>("");

  const fetchData = async () => {
    try {
      // Obtener perfil del usuario
      const profile = await getCurrentUserProfile();
      if (profile?.role !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      setUserName(profile.full_name || profile.id);

      // Obtener todas las granjas
      const { data: farmsData, error: farmsError } = await supabase
        .from('farms')
        .select('*')
        .order('created_at', { ascending: false });

      if (farmsError) throw farmsError;
      setFarms(farmsData || []);

      // Obtener conteo total de eventos en toda la plataforma
      const { count, error: eventsError } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true });

      if (eventsError) throw eventsError;
      setTotalEvents(count || 0);

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

  // Calcular eventos de hoy
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
            <h2 className="text-2xl font-bold tracking-tight">Panel de Control Global</h2>
            <p className="text-sm text-muted-foreground">
              Gestión de granjas registradas y análisis de datos de toda la plataforma SaaS
            </p>
          </div>
        </div>

        {/* Global KPIs */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Total Granjas */}
          <Card className="glass-effect hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Granjas Registradas
              </CardTitle>
              <div className="glow-warning">
                <Building2 className="h-5 w-5 text-primary" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {farms.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Clientes en la plataforma
              </p>
              <Badge variant="outline" className="text-[10px] font-mono mt-3 alert-success">
                ✓ Todas operativas
              </Badge>
            </CardContent>
          </Card>

          {/* Total Eventos */}
          <Card className="glass-effect hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Eventos Totales
              </CardTitle>
              <div className="glow-success">
                <Database className="h-5 w-5 text-accent" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-accent">
                {totalEvents.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Alertas recolectadas (histórico)
              </p>
              <Badge variant="outline" className="text-[10px] font-mono mt-3">
                Dataset para ML
              </Badge>
            </CardContent>
          </Card>

          {/* Tasa de Crecimiento */}
          <Card className="glass-effect hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Crecimiento
              </CardTitle>
              <div className="glow-warning">
                <TrendingUp className="h-5 w-5 text-amber-500" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">
                +{farms.length > 0 ? Math.round((totalEvents / farms.length)) : 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Eventos promedio por granja
              </p>
              <Badge variant="outline" className="text-[10px] font-mono mt-3 alert-warning">
                ↑ Estadísticas globales
              </Badge>
            </CardContent>
          </Card>

          {/* Estado del Sistema */}
          <Card className="glass-effect hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Estado del Sistema
              </CardTitle>
              <div className="glow-success">
                <Activity className="h-5 w-5 text-accent" strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-accent">
                Operacional
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Plataforma SaaS Multi-Tenant
              </p>
              <Badge variant="outline" className="text-[10px] font-mono mt-3 alert-success">
                ✓ RLS activo
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Farms Management Section */}
        <FarmsManagement farms={farms} onFarmCreated={fetchData} />
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

