"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Event } from "@/lib/supabase";

interface AlertsChartProps {
  events: Event[];
}

export function AlertsChart({ events }: AlertsChartProps) {
  // Process events into chart data (last 24 hours, grouped by hour)
  const chartData = Array.from({ length: 24 }, (_, i) => {
    const hour = new Date();
    hour.setHours(hour.getHours() - (23 - i));
    hour.setMinutes(0, 0, 0);
    
    const hourEnd = new Date(hour);
    hourEnd.setHours(hourEnd.getHours() + 1);
    
    const hourEvents = events.filter(e => {
      const eventTime = new Date(e.created_at);
      return eventTime >= hour && eventTime < hourEnd;
    });
    
    const avgConfidence = hourEvents.length > 0
      ? Math.round(hourEvents.reduce((sum, e) => sum + e.confidence, 0) / hourEvents.length * 100)
      : 0;
    
    return {
      time: hour.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      alerts: hourEvents.length,
      confidence: avgConfidence,
    };
  });

  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Línea de Tiempo de Alertas</CardTitle>
        <CardDescription className="font-mono text-xs">
          Últimas 24 horas | Monitoreo en tiempo real
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart 
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="alertGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.68 0.19 55)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="oklch(0.68 0.19 55)" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.5 0.15 165)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="oklch(0.5 0.15 165)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="oklch(0.3 0.02 264)"
              opacity={0.3}
            />
            <XAxis 
              dataKey="time"
              stroke="oklch(0.6 0.015 264)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={10}
            />
            <YAxis 
              stroke="oklch(0.6 0.015 264)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dx={-10}
            />
            <Tooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border border-border bg-card p-3 shadow-xl">
                      <div className="grid gap-2">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-muted-foreground font-mono">
                            Hora
                          </span>
                          <span className="font-bold text-sm">
                            {payload[0].payload.time}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase text-muted-foreground font-mono">
                              Alertas
                            </span>
                            <span className="font-bold text-sm text-primary">
                              {payload[0].value}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase text-muted-foreground font-mono">
                              Confianza
                            </span>
                            <span className="font-bold text-sm text-accent">
                              {payload[1]?.value}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="alerts"
              stroke="oklch(0.68 0.19 55)"
              fill="url(#alertGradient)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="confidence"
              stroke="oklch(0.5 0.15 165)"
              fill="url(#confidenceGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
        
        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">Alertas</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-accent" />
            <span className="text-muted-foreground">Confianza</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
