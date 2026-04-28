"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, 
  AlertTriangle, 
  Skull,
  Play,
  Loader2,
  CheckCircle2,
  XCircle
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";

interface AdminIoTSimulatorProps {
  siteId: string;
  onSimulationComplete: () => void;
}

type SimulationStatus = 'idle' | 'running' | 'success' | 'error';

export function AdminIoTSimulator({ siteId, onSimulationComplete }: AdminIoTSimulatorProps) {
  const [status, setStatus] = useState<SimulationStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  // Obtener todos los devices del site (atravesando la jerarquía)
  const getDevicesFromSite = async () => {
    try {
      // 1. Obtener buildings del site
      const { data: buildings, error: buildingsError } = await supabase
        .from('buildings')
        .select('id')
        .eq('site_id', siteId);

      if (buildingsError) throw buildingsError;
      if (!buildings || buildings.length === 0) return [];

      const buildingIds = buildings.map(b => b.id);

      // 2. Obtener rooms de esos buildings
      const { data: rooms, error: roomsError } = await supabase
        .from('rooms')
        .select('id')
        .in('building_id', buildingIds);

      if (roomsError) throw roomsError;
      if (!rooms || rooms.length === 0) return [];

      const roomIds = rooms.map(r => r.id);

      // 3. Obtener devices de esas rooms
      const { data: devices, error: devicesError } = await supabase
        .from('devices')
        .select('*')
        .in('room_id', roomIds);

      if (devicesError) throw devicesError;
      return devices || [];
    } catch (error) {
      console.error('Error fetching devices:', error);
      return [];
    }
  };

  // SIMULACIÓN 1: Force Online
  const forceOnline = async () => {
    setStatus('running');
    setMessage('Activando todos los dispositivos...');

    try {
      const devices = await getDevicesFromSite();
      
      if (devices.length === 0) {
        setStatus('error');
        setMessage('⚠️ No hay dispositivos en este site');
        setTimeout(() => setStatus('idle'), 3000);
        return;
      }

      const now = new Date().toISOString();

      // Actualizar todos los devices
      const { error } = await supabase
        .from('devices')
        .update({
          status: 'online',
          last_heartbeat: now,
          updated_at: now
        })
        .in('id', devices.map(d => d.id));

      if (error) throw error;

      setStatus('success');
      setMessage(`✅ ${devices.length} dispositivos activados correctamente`);
      
      setTimeout(() => {
        setStatus('idle');
        onSimulationComplete();
      }, 2000);
    } catch (error) {
      console.error('Error in forceOnline:', error);
      setStatus('error');
      setMessage('❌ Error al activar dispositivos');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  // SIMULACIÓN 2: Simulate Critical Failure
  const simulateCriticalFailure = async () => {
    setStatus('running');
    setMessage('Simulando falla crítica...');

    try {
      const devices = await getDevicesFromSite();
      
      if (devices.length === 0) {
        setStatus('error');
        setMessage('⚠️ No hay dispositivos en este site');
        setTimeout(() => setStatus('idle'), 3000);
        return;
      }

      // Seleccionar 2 devices aleatorios (o menos si no hay suficientes)
      const failCount = Math.min(2, devices.length);
      const shuffled = [...devices].sort(() => 0.5 - Math.random());
      const devicesToFail = shuffled.slice(0, failCount);

      // Poner en offline con heartbeat antiguo
      const oldHeartbeat = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hora atrás

      const { error } = await supabase
        .from('devices')
        .update({
          status: 'offline',
          last_heartbeat: oldHeartbeat,
          updated_at: new Date().toISOString()
        })
        .in('id', devicesToFail.map(d => d.id));

      if (error) throw error;

      setStatus('success');
      setMessage(`⚠️ ${failCount} dispositivo${failCount > 1 ? 's' : ''} en falla crítica`);
      
      setTimeout(() => {
        setStatus('idle');
        onSimulationComplete();
      }, 2000);
    } catch (error) {
      console.error('Error in simulateCriticalFailure:', error);
      setStatus('error');
      setMessage('❌ Error al simular falla');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  // SIMULACIÓN 3: Kill Site
  const killSite = async () => {
    setStatus('running');
    setMessage('Apagando todo el site...');

    try {
      const devices = await getDevicesFromSite();
      
      if (devices.length === 0) {
        setStatus('error');
        setMessage('⚠️ No hay dispositivos en este site');
        setTimeout(() => setStatus('idle'), 3000);
        return;
      }

      // Poner TODOS en offline con heartbeat muy antiguo
      const oldHeartbeat = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 horas atrás

      const { error } = await supabase
        .from('devices')
        .update({
          status: 'offline',
          last_heartbeat: oldHeartbeat,
          updated_at: new Date().toISOString()
        })
        .in('id', devices.map(d => d.id));

      if (error) throw error;

      setStatus('success');
      setMessage(`💀 ${devices.length} dispositivos offline (Site muerto)`);
      
      setTimeout(() => {
        setStatus('idle');
        onSimulationComplete();
      }, 2000);
    } catch (error) {
      console.error('Error in killSite:', error);
      setStatus('error');
      setMessage('❌ Error al apagar site');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const handleAction = (action: 'force_online' | 'critical_failure' | 'kill_site') => {
    setConfirmAction(action);
  };

  const executeAction = () => {
    if (confirmAction === 'force_online') {
      forceOnline();
    } else if (confirmAction === 'critical_failure') {
      simulateCriticalFailure();
    } else if (confirmAction === 'kill_site') {
      killSite();
    }
    setConfirmAction(null);
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <>
      <Card className="glass-effect border-red-500/30 bg-red-500/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5 text-red-500" strokeWidth={2} />
                IoT Simulator (Debug Mode)
              </CardTitle>
              <CardDescription className="mt-2">
                Herramientas de prueba para simular estados de hardware
              </CardDescription>
            </div>
            <Badge className="alert-danger text-xs">
              SUPER ADMIN ONLY
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Status Message */}
          {status !== 'idle' && (
            <div className={`mb-4 p-3 rounded-lg border flex items-center gap-2 ${
              status === 'success' ? 'border-emerald-500/30 bg-emerald-500/5' :
              status === 'error' ? 'border-red-500/30 bg-red-500/5' :
              'border-amber-500/30 bg-amber-500/5'
            }`}>
              {getStatusIcon()}
              <span className="text-sm font-medium">{message}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid gap-3 md:grid-cols-3">
            {/* Force Online */}
            <Button
              variant="outline"
              className="h-auto flex flex-col items-start gap-2 p-4 hover:border-emerald-500/50 hover:bg-emerald-500/5"
              onClick={() => handleAction('force_online')}
              disabled={status === 'running'}
            >
              <div className="flex items-center gap-2 w-full">
                <Play className="h-4 w-4 text-emerald-500" strokeWidth={2} />
                <span className="font-semibold text-sm">Force Online</span>
              </div>
              <p className="text-xs text-left text-muted-foreground">
                Activa todos los dispositivos del site y actualiza heartbeat
              </p>
            </Button>

            {/* Simulate Critical Failure */}
            <Button
              variant="outline"
              className="h-auto flex flex-col items-start gap-2 p-4 hover:border-amber-500/50 hover:bg-amber-500/5"
              onClick={() => handleAction('critical_failure')}
              disabled={status === 'running'}
            >
              <div className="flex items-center gap-2 w-full">
                <AlertTriangle className="h-4 w-4 text-amber-500" strokeWidth={2} />
                <span className="font-semibold text-sm">Critical Failure</span>
              </div>
              <p className="text-xs text-left text-muted-foreground">
                Simula la caída de 2 dispositivos aleatorios
              </p>
            </Button>

            {/* Kill Site */}
            <Button
              variant="outline"
              className="h-auto flex flex-col items-start gap-2 p-4 hover:border-red-500/50 hover:bg-red-500/5"
              onClick={() => handleAction('kill_site')}
              disabled={status === 'running'}
            >
              <div className="flex items-center gap-2 w-full">
                <Skull className="h-4 w-4 text-red-500" strokeWidth={2} />
                <span className="font-semibold text-sm">Kill Site</span>
              </div>
              <p className="text-xs text-left text-muted-foreground">
                Apaga TODOS los dispositivos del site (prueba de caída masiva)
              </p>
            </Button>
          </div>

          {/* Warning Notice */}
          <div className="mt-4 p-3 border border-amber-500/30 bg-amber-500/5 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" strokeWidth={2} />
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold text-foreground mb-1">⚠️ Modo de Pruebas</p>
                <p>
                  Estas acciones modifican directamente el estado de los dispositivos en la base de datos.
                  Úsalas solo para testing y debugging. Los cambios son inmediatos y afectan a la vista del cliente.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar Simulación
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2">
                {confirmAction === 'force_online' && (
                  <>
                    <p>¿Estás seguro de que quieres <strong className="text-emerald-500">activar todos los dispositivos</strong> de este site?</p>
                    <p className="text-xs text-muted-foreground">
                      Esto actualizará el status a "online" y el heartbeat a la fecha actual.
                    </p>
                  </>
                )}
                {confirmAction === 'critical_failure' && (
                  <>
                    <p>¿Estás seguro de que quieres simular una <strong className="text-amber-500">falla crítica</strong>?</p>
                    <p className="text-xs text-muted-foreground">
                      Esto pondrá 2 dispositivos aleatorios en estado "offline".
                    </p>
                  </>
                )}
                {confirmAction === 'kill_site' && (
                  <>
                    <p>¿Estás seguro de que quieres <strong className="text-red-500">apagar todo el site</strong>?</p>
                    <p className="text-xs text-muted-foreground">
                      Esto pondrá TODOS los dispositivos en estado "offline" con heartbeat antiguo. Útil para probar alertas de caída masiva.
                    </p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmAction(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              onClick={executeAction}
              className={
                confirmAction === 'force_online' ? 'bg-emerald-600 hover:bg-emerald-700' :
                confirmAction === 'critical_failure' ? 'bg-amber-600 hover:bg-amber-700' :
                'bg-red-600 hover:bg-red-700'
              }
            >
              Confirmar Simulación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

