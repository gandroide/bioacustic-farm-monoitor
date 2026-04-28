"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Bell, Zap, Waves } from "lucide-react";
import { Event } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface KPICardsProps {
  events: Event[];
}

export function KPICards({ events }: KPICardsProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayEvents = events.filter(e => new Date(e.created_at) >= today);
  const totalAlertsToday = todayEvents.length;
  
  const lastEvent = events[0];
  const lastAlertTime = lastEvent 
    ? new Date(lastEvent.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '--:--';
  
  const avgNoiseLevel = events.length > 0
    ? Math.round(events.reduce((sum, e) => sum + (e.metadata?.rms || 0), 0) / events.length)
    : 0;
  
  const systemStatus: "online" | "offline" = "online";

  const cards = [
    {
      title: "Alertas Hoy",
      value: totalAlertsToday,
      subtitle: "Período de 24h",
      icon: Bell,
      badge: totalAlertsToday > 0 ? `${totalAlertsToday} detectadas` : 'Sin alertas',
      badgeVariant: totalAlertsToday > 10 ? "danger" : totalAlertsToday > 0 ? "warning" : "success",
      color: totalAlertsToday > 10 ? "text-red-500" : "text-primary",
      glowClass: totalAlertsToday > 10 ? "glow-danger" : "glow-warning",
      iconBg: totalAlertsToday > 10 ? "bg-red-500/10" : "bg-primary/10",
    },
    {
      title: "Última Alerta",
      value: lastAlertTime,
      subtitle: "Evento más reciente",
      icon: Activity,
      badge: lastEvent?.device_id ? `Nodo: ${lastEvent.device_id}` : null,
      badgeVariant: "default",
      color: "text-primary",
      glowClass: "glow-warning",
      iconBg: "bg-primary/10",
    },
    {
      title: "Nivel de Ruido",
      value: `${avgNoiseLevel} RMS`,
      subtitle: "Amplitud promedio",
      icon: Waves,
      badge: avgNoiseLevel > 0 ? "Rango normal" : null,
      badgeVariant: "success",
      color: "text-accent",
      glowClass: "glow-success",
      iconBg: "bg-emerald-500/10",
    },
    {
      title: "Estado",
      value: systemStatus === "online" ? "Operacional" : "Fuera de línea",
      subtitle: "Sensores edge",
      icon: Zap,
      badge: systemStatus === "online" ? "✓ Todos activos" : "⚠ Fallo detectado",
      badgeVariant: systemStatus === "online" ? "success" : "danger",
      color: systemStatus === "online" ? "text-emerald-500" : "text-red-500",
      glowClass: systemStatus === "online" ? "glow-success" : "glow-danger",
      iconBg: systemStatus === "online" ? "bg-emerald-500/10" : "bg-red-500/10",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const badgeClass = card.badgeVariant === "danger" 
          ? "alert-danger" 
          : card.badgeVariant === "warning" 
            ? "alert-warning" 
            : card.badgeVariant === "success"
              ? "alert-success"
              : "bg-muted text-muted-foreground";

        return (
          <Card 
            key={index} 
            className={cn(
              "glass-effect card-hover animate-in-view",
              `stagger-${index + 1}`
            )}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", card.iconBg)}>
                <Icon className={cn("h-[18px] w-[18px]", card.color)} strokeWidth={2} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-bold tracking-tight", card.color)}>
                {card.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {card.subtitle}
              </p>
              {card.badge && (
                <div className="mt-3">
                  <Badge 
                    variant="outline" 
                    className={cn("text-[10px] font-mono", badgeClass)}
                  >
                    {card.badge}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}