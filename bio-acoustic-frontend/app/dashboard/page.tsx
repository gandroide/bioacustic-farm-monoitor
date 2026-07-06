"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, Event, getCurrentUserProfile, getUserOrganization, getSiteById } from "@/lib/supabase";
import { KPICards } from "@/components/dashboard/kpi-cards";
import { PageHeader } from "@/components/layout/page-header";
import { AlertsChart } from "@/components/dashboard/alerts-chart";
import { EventsTable } from "@/components/dashboard/events-table";
import { KPISkeleton } from "@/components/dashboard/kpi-skeleton";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
      const profile = await getCurrentUserProfile();
      if (!profile) {
        router.push('/login');
        return;
      }

      if (profile.role === 'super_admin') {
        router.push('/admin');
        return;
      }

      const organization = await getUserOrganization();
      if (organization) {
        setOrganizationName(organization.name);
      }

      if (profile.assigned_site_id) {
        const site = await getSiteById(profile.assigned_site_id);
        if (site) {
          setSiteName(site.name);
        }
      }

      let query = supabase
        .from('acoustic_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      let roomIds: string[] = [];

      if (profile.assigned_site_id) {
        const { data: buildings } = await supabase
          .from('buildings')
          .select('id')
          .eq('site_id', profile.assigned_site_id);

        if (buildings && buildings.length > 0) {
          const buildingIds = buildings.map(b => b.id);
          
          const { data: rooms } = await supabase
            .from('rooms')
            .select('id')
            .in('building_id', buildingIds);

          if (rooms && rooms.length > 0) {
            roomIds = rooms.map(r => r.id);
          }
        }
      } else if (organization) {
        // Org Admin: fetch all rooms for this organization
        const { data: sites } = await supabase
          .from('sites')
          .select('id')
          .eq('organization_id', organization.id);
          
        if (sites && sites.length > 0) {
          const siteIds = sites.map(s => s.id);
          const { data: buildings } = await supabase
            .from('buildings')
            .select('id')
            .in('site_id', siteIds);
            
          if (buildings && buildings.length > 0) {
            const buildingIds = buildings.map(b => b.id);
            const { data: rooms } = await supabase
              .from('rooms')
              .select('id')
              .in('building_id', buildingIds);
              
            if (rooms && rooms.length > 0) {
              roomIds = rooms.map(r => r.id);
            }
          }
        }
      }

      if (roomIds.length > 0) {
        query = query.in('room_id', roomIds);
      } else {
        // Evitar traer datos ajenos si no hay cuartos en esta org/site
        setEvents([]);
        setLoading(false);
        setRefreshing(false);
        return;
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
    const subscription = supabase
      .channel('events_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'acoustic_events',
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
    toast.info("Actualizando datos...");
    Promise.all([fetchEvents()]).then(() => toast.success("Datos actualizados"));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-card/30">
      {/* Page Content */}
      <div className="px-6 lg:px-8 py-8 space-y-8">
        <PageHeader
          title="Resumen en Tiempo Real"
          subtitle={
            <div className="flex items-center gap-2">
              <span>Análisis bioacústico y gestión de alertas</span>
              {organizationName && (
                <>
                  <span className="text-muted-foreground/40">•</span>
                  <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                    {organizationName}
                  </Badge>
                </>
              )}
              {siteName && (
                <>
                  <span className="text-muted-foreground/40">/</span>
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                    {siteName}
                  </Badge>
                </>
              )}
            </div>
          }
          actions={
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Actualizar"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          }
        />

        {/* KPIs */}
        {loading ? <KPISkeleton /> : <KPICards events={events} />}

        {/* Chart */}
        {loading ? (
          <div className="animate-in-view stagger-4">
            <div className="h-[400px] rounded-lg glass-effect flex items-center justify-center">
              <div className="h-8 w-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          </div>
        ) : (
          <div className="animate-in-view stagger-4">
            <AlertsChart events={events} />
          </div>
        )}

        {/* Events Table */}
        {loading ? <TableSkeleton /> : (
          <div className="animate-in-view stagger-5">
            <EventsTable events={events} />
          </div>
        )}

      </div>
    </div>
  );
}
