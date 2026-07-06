"use client";

import { Badge } from "@/components/ui/badge";
import { Activity, Bell, Zap, Waves } from "lucide-react";
import { Event } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { KPICard, type KPITone } from "./kpi-card";
import type { ReactNode } from "react";

interface KPICardsProps {
  events: Event[];
}

type BadgeTone = "danger" | "warning" | "success" | "default";

const badgeToneClass = (tone: BadgeTone) =>
  tone === "danger"
    ? "alert-danger"
    : tone === "warning"
      ? "alert-warning"
      : tone === "success"
        ? "alert-success"
        : "bg-muted text-muted-foreground";

const badgeNode = (label: string | null, tone: BadgeTone): ReactNode =>
  label ? (
    <Badge variant="outline" className={cn("text-[10px] font-mono", badgeToneClass(tone))}>
      {label}
    </Badge>
  ) : null;

export function KPICards({ events }: KPICardsProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayEvents = events.filter((e) => new Date(e.created_at) >= today);
  const totalAlertsToday = todayEvents.length;

  const lastEvent = events[0];
  const lastAlertTime = lastEvent
    ? new Date(lastEvent.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  const avgNoiseLevel = events.length > 0
    ? Math.round(events.reduce((sum, e) => sum + (e.rms_level || 0), 0) / events.length)
    : 0;

  const systemStatus: "online" | "offline" = "online";

  const alertsTone: KPITone = totalAlertsToday > 10 ? "red" : "primary";
  const statusTone: KPITone = systemStatus === "online" ? "emerald" : "red";

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KPICard
        stagger={1}
        tone={alertsTone}
        title="Alertas Hoy"
        icon={<Bell className={cn("h-[18px] w-[18px]", alertsTone === "red" ? "text-red-500" : "text-primary")} strokeWidth={2} />}
        value={totalAlertsToday}
        subtitle="Período de 24h"
        footer={badgeNode(
          totalAlertsToday > 0 ? `${totalAlertsToday} detectadas` : "Sin alertas",
          totalAlertsToday > 10 ? "danger" : totalAlertsToday > 0 ? "warning" : "success",
        )}
      />

      <KPICard
        stagger={2}
        tone="primary"
        title="Última Alerta"
        icon={<Activity className="h-[18px] w-[18px] text-primary" strokeWidth={2} />}
        value={lastAlertTime}
        subtitle="Evento más reciente"
        footer={badgeNode(lastEvent?.device_id ? `Nodo: ${lastEvent.device_id}` : null, "default")}
      />

      <KPICard
        stagger={3}
        tone="emerald"
        title="Nivel de Ruido"
        icon={<Waves className="h-[18px] w-[18px] text-emerald-500" strokeWidth={2} />}
        value={`${avgNoiseLevel} RMS`}
        subtitle="Amplitud promedio"
        footer={badgeNode(avgNoiseLevel > 0 ? "Rango normal" : null, "success")}
      />

      <KPICard
        stagger={4}
        tone={statusTone}
        title="Estado"
        icon={<Zap className={cn("h-[18px] w-[18px]", statusTone === "emerald" ? "text-emerald-500" : "text-red-500")} strokeWidth={2} />}
        value={systemStatus === "online" ? "Operacional" : "Fuera de línea"}
        subtitle="Sensores edge"
        footer={badgeNode(
          systemStatus === "online" ? "Todos activos" : "Fallo detectado",
          systemStatus === "online" ? "success" : "danger",
        )}
      />
    </div>
  );
}
