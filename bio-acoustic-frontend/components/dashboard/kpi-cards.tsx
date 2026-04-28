"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Bell, Zap, Waves } from "lucide-react"; // Agregué Waves
import { Event } from "@/lib/supabase";

interface KPICardsProps {
  events: Event[];
}

export function KPICards({ events }: KPICardsProps) {
  // Calculate KPIs from events
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
      trend: totalAlertsToday > 0 ? `+12% vs ayer` : 'Sin alertas',
      trendUp: totalAlertsToday > 5,
      color: totalAlertsToday > 10 ? "text-alert-danger" : "text-alert-warning",
      glowClass: totalAlertsToday > 10 ? "glow-danger" : "glow-warning",
    },
    {
      title: "Última Alerta",
      value: lastAlertTime,
      subtitle: "Evento más reciente",
      icon: Activity,
      trend: `Dispositivo: ${lastEvent?.device_id || 'N/A'}`,
      trendUp: null,
      color: "text-primary",
      glowClass: "glow-warning",
    },
    {
      title: "Nivel de Ruido Promedio",
      value: `${avgNoiseLevel}`,
      subtitle: "Amplitud RMS",
      icon: Waves, // <--- AQUÍ FALTABA EL ICONO
      trend: "Dentro del rango normal",
      trendUp: false,
      color: "text-accent",
      glowClass: "glow-success",
    },
    {
      title: "Estado del Sistema",
      value: systemStatus === "online" ? "Operacional" : "Fuera de línea",
      subtitle: "Dispositivos edge",
      icon: Zap,
      trend: "Todos los sensores activos",
      trendUp: true,
      color: systemStatus === "online" ? "text-accent" : "text-destructive",
      glowClass: systemStatus === "online" ? "glow-success" : "",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Card key={index} className="glass-effect hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`${card.glowClass}`}>
                {/* Añadimos protección por si Icon es undefined */}
                {Icon && <Icon className={`h-5 w-5 ${card.color}`} strokeWidth={2} />}
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${card.color}`}>
                {card.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {card.subtitle}
              </p>
              <div className="flex items-center gap-2 mt-3">
                {card.trendUp !== null && (
                  <Badge 
                    variant="outline" 
                    className={`text-[10px] font-mono ${
                      card.trendUp 
                        ? "alert-warning" 
                        : "alert-success"
                    }`}
                  >
                    {card.trendUp ? "↑" : "↓"} {card.trend}
                  </Badge>
                )}
                {card.trendUp === null && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {card.trend}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}