"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, Zap } from "lucide-react";
import { Event } from "@/lib/supabase";

interface EventsTableProps {
  readonly events: Event[];
}

export function EventsTable({ events }: EventsTableProps) {

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: false 
    });
  };

  const getConfidenceBadge = () => {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 uppercase text-[10px] tracking-wider px-2">
        N/A
      </Badge>
    );
  };

  const getAlertTypeDetails = (type: string) => {
    switch (type) {
      case 'noise_threshold':
        return {
          name: 'Umbral de Ruido Excedido',
          color: 'text-amber-500',
          icon: AlertTriangle,
          bgClass: 'bg-amber-500/10'
        };
      case 'high_pitch':
        return {
          name: 'Chillido de Estrés',
          color: 'text-red-500',
          icon: Zap,
          bgClass: 'bg-red-500/10'
        };
      case 'ml_prediction':
        return {
          name: 'Predicción ML: Riesgo Alto',
          color: 'text-emerald-500',
          icon: Activity,
          bgClass: 'bg-emerald-500/10'
        };
      default:
        return {
          name: type,
          color: 'text-muted-foreground',
          icon: Activity,
          bgClass: 'bg-muted/50'
        };
    }
  };

  return (
    <Card className="glass-effect">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Registro de Eventos IA</CardTitle>
            <CardDescription className="font-mono text-xs mt-1">
              Detecciones del sistema de análisis bioacústico
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs bg-primary/10 border-primary/30">
            {events.length} eventos detectados
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead className="w-[140px]">Timestamp</TableHead>
                <TableHead>Tipo de Alerta</TableHead>
                <TableHead className="text-center w-[180px]">Confianza IA</TableHead>
                <TableHead className="text-center w-[220px]">Métricas Bioacústicas</TableHead>
                <TableHead className="w-[180px]">Dispositivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <Activity className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                    <p className="font-semibold capitalize text-foreground">Sin eventos registrados</p>
                    <p className="text-sm text-muted-foreground/70">El sistema está monitoreando en tiempo real</p>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => {
                  const alertDetails = getAlertTypeDetails(event.event_type);
                  const AlertIcon = alertDetails.icon;
                  
                  return (
                    <TableRow key={event.id} className="border-border/30 hover:bg-card/50 transition-colors">
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {formatTime(event.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-md ${alertDetails.bgClass}`}>
                          <AlertIcon className={`h-5 w-5 ${alertDetails.color} flex-shrink-0`} strokeWidth={2} />
                          <span className={`text-sm font-medium ${alertDetails.color}`}>
                            {alertDetails.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {getConfidenceBadge()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-6 font-mono text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">RMS:</span>
                            <span className="text-amber-500 font-bold text-sm">{event.rms_level?.toFixed(2) || 'N/A'}</span>
                          </div>
                          <div className="flex flex-col border-l border-border/50 pl-3">
                            <span className="text-[10px] text-muted-foreground font-mono mb-1">BATTERY</span>
                            <span className="text-emerald-500 font-bold text-sm">{event.battery_percentage ? `${event.battery_percentage}%` : 'N/A'}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center">
                          <span className="font-mono text-xs bg-muted px-3 py-1.5 rounded border border-border/50">
                            {event.device_id}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
