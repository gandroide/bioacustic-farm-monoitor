"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, Event, getCurrentUserProfile, getUserOrganization, getSiteById } from "@/lib/supabase";
import { KPICards } from "@/components/dashboard/kpi-cards";
import { AlertsChart } from "@/components/dashboard/alerts-chart";
import { EventsTable } from "@/components/dashboard/events-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, LogOut, RefreshCw, Settings } from "lucide-react";
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const router = useRouter();
  
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [siteName, setSiteName] = useState<string>("");
  const [organizationName, setOrganizationName] = useState<string>("");

  const fetchEvents = async () => {
    try {
      // Verificar autenticación y obtener perfil
      const profile = await getCurrentUserProfile();
      if (!profile) {
        router.push('/login');
        return;
      }

      // Si es super_admin, redirigir al panel de admin
      if (profile.role === 'super_admin') {
        router.push('/admin');
        return;
      }

      // Obtener información de la organización
      const organization = await getUserOrganization();
      if (organization) {
        setOrganizationName(organization.name);
      }

      // Obtener nombre del site asignado (si aplica)
      if (profile.assigned_site_id) {
        const site = await getSiteById(profile.assigned_site_id);
        if (site) {
          setSiteName(site.name);
        }
      }

      // Obtener eventos
      // RLS filtrará automáticamente por organization_id del usuario
      // Si hay assigned_site_id, filtrar también por ese site
      let query = supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      // Si el usuario tiene un site asignado específico, filtrar por rooms de ese site
      if (profile.assigned_site_id) {
        // Primero obtener buildings del site
        const { data: buildings } = await supabase
          .from('buildings')
          .select('id')
          .eq('site_id', profile.assigned_site_id);

        if (buildings && buildings.length > 0) {
          const buildingIds = buildings.map(b => b.id);
          
          // Luego obtener rooms de esos buildings
          const { data: rooms } = await supabase
            .from('rooms')
            .select('id')
            .in('building_id', buildingIds);

          if (rooms && rooms.length > 0) {
            const roomIds = rooms.map(r => r.id);
            query = query.in('room_id', roomIds);
          }
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    
    // Set up real-time subscription
    const subscription = supabase
      .channel('events_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
        },
        () => {
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEvents();
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
              <Activity className="h-8 w-8 text-primary glow-warning" strokeWidth={2.5} />
              <div>
                <h1 className="text-xl font-bold tracking-tight">Ontiveros Bio-Alert</h1>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Panel de Monitoreo</p>
                  {organizationName && (
                    <>
                      <span className="text-xs text-muted-foreground">•</span>
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                        {organizationName}
                      </Badge>
                    </>
                  )}
                  {siteName && (
                    <>
                      <span className="text-xs text-muted-foreground">/</span>
                      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                        {siteName}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Link href="/dashboard/settings/farm">
                <Button variant="outline" className="gap-2" title="Configurar estructura de la granja">
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Configurar Granja</span>
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Actualizar"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" title="Configuración">
                <Settings className="h-4 w-4" />
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
        {/* Subtitle */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Resumen en tiempo real</h2>
            <p className="text-sm text-muted-foreground">
              Análisis bioacústico y gestión de alertas en tiempo real
            </p>
          </div>
        </div>

        {/* KPIs */}
        <KPICards events={events} />

        {/* Chart */}
        <AlertsChart events={events} />

        {/* Events Table */}
        <EventsTable events={events} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-16">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div>
              <span className="font-semibold">Ontiveros Bio-Alert</span> v0.7.0 | Plataforma Edge Computing
            </div>
            <div>
              Inteligencia Ganadera de Próxima Generación | © {new Date().getFullYear()}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
