"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Pause, Activity } from "lucide-react";
import { Event } from "@/lib/supabase";

interface EventsTableProps {
  readonly events: Event[];
}

export function EventsTable({ events }: EventsTableProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: false 
    });
  };

  const getConfidenceLevel = (confidence: number) => {
    if (confidence >= 0.8) return 'alta';
    if (confidence >= 0.5) return 'media';
    return 'baja';
  };

  const getConfidenceBadgeClass = (level: string) => {
    if (level === 'alta') return 'alert-danger';
    if (level === 'media') return 'alert-warning';
    return 'alert-success';
  };

  const getConfidenceBadge = (confidence: number) => {
    const level = getConfidenceLevel(confidence);
    const className = getConfidenceBadgeClass(level);
    return <Badge className={`${className} font-mono text-[10px]`}>{level.toUpperCase()} {(confidence * 100).toFixed(0)}%</Badge>;
  };

  const getAlertTypeColor = (type: string) => {
    if (type === 'noise_threshold') return 'text-primary';
    if (type === 'high_pitch') return 'text-destructive';
    if (type === 'ml_prediction') return 'text-accent';
    return 'text-muted-foreground';
  };

  const getAlertTypeName = (type: string) => {
    if (type === 'noise_threshold') return 'umbral de ruido';
    if (type === 'high_pitch') return 'tono agudo';
    if (type === 'ml_prediction') return 'predicción ML';
    return type;
  };

  const toggleAudio = (eventId: string) => {
    if (playingId === eventId) {
      setPlayingId(null);
    } else {
      setPlayingId(eventId);
      // In a real implementation, integrate wavesurfer.js here
      setTimeout(() => setPlayingId(null), 3000); // Simulate playback
    }
  };

  return (
    <Card className="glass-effect">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Registro de Eventos</CardTitle>
            <CardDescription className="font-mono text-xs mt-1">
              Historial de alertas en tiempo real
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {events.length} eventos
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead className="w-[120px]">Hora</TableHead>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-center">Confianza</TableHead>
                <TableHead className="text-center">Métricas</TableHead>
                <TableHead className="text-center">Audio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Activity className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                    <p className="text-lg font-medium text-muted-foreground">Sin eventos registrados</p>
                    <p className="text-sm text-muted-foreground/70">El sistema está monitoreando en tiempo real</p>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.id} className="border-border/30 hover:bg-card/50 transition-colors">
                    <TableCell className="font-mono text-xs">
                      {formatTime(event.created_at)}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs bg-card-muted px-2 py-1 rounded">
                        {event.device_id}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${getAlertTypeColor(event.alert_type)}`}>
                        {getAlertTypeName(event.alert_type)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {getConfidenceBadge(event.confidence)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-center gap-1 font-mono text-[10px]">
                        <div>
                          <span className="text-muted-foreground">RMS:</span>{' '}
                          <span className="text-primary font-semibold">{event.metadata?.rms?.toFixed(2) || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">ZCR:</span>{' '}
                          <span className="text-accent font-semibold">{event.metadata?.zcr?.toFixed(2) || 'N/A'}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {event.metadata?.audio_url ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAudio(event.id)}
                          className="h-8 px-3 text-xs"
                        >
                          {playingId === event.id ? (
                            <>
                              <Pause className="h-3 w-3 mr-1" />
                              Pausar
                            </>
                          ) : (
                            <>
                              <Play className="h-3 w-3 mr-1" />
                              Reproducir
                            </>
                          )}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin audio</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
