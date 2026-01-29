"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, getCurrentUserProfile, Device } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Package,
  Plus,
  Edit2,
  Trash2,
  MoreVertical,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  PackagePlus
} from "lucide-react";

export const dynamic = 'force-dynamic';

interface UnassignedDevice extends Device {
  // Dispositivos sin room_id asignado
}

type DialogMode = 'create' | 'edit' | null;

export default function InventoryPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<UnassignedDevice[]>([]);
  
  // Dialog state
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedDevice, setSelectedDevice] = useState<UnassignedDevice | null>(null);
  const [formData, setFormData] = useState({
    deviceId: "",
    name: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchDevices = async () => {
    try {
      // Verificar permisos
      const profile = await getCurrentUserProfile();
      if (!profile || profile.role !== 'super_admin') {
        router.push('/admin');
        return;
      }

      // Obtener dispositivos no asignados (room_id = NULL)
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .is('room_id', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (error) {
      console.error('Error fetching devices:', error);
      showNotification('error', '❌ Error al cargar dispositivos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const openDialog = (mode: DialogMode, device?: UnassignedDevice) => {
    setDialogMode(mode);
    if (mode === 'edit' && device) {
      setSelectedDevice(device);
      setFormData({
        deviceId: device.device_id,
        name: device.name || ""
      });
    } else {
      setSelectedDevice(null);
      setFormData({
        deviceId: "",
        name: ""
      });
    }
  };

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedDevice(null);
    setFormData({ deviceId: "", name: "" });
  };

  const handleSubmit = async () => {
    if (!formData.deviceId.trim()) {
      showNotification('error', '❌ El Device UID es obligatorio');
      return;
    }

    setSubmitting(true);
    try {
      if (dialogMode === 'create') {
        // Crear nuevo dispositivo
        const { error } = await supabase
          .from('devices')
          .insert({
            device_id: formData.deviceId.trim(),
            name: formData.name.trim() || null,
            status: 'offline',
            room_id: null // Importante: sin asignar
          });

        if (error) {
          // Manejar error de duplicado
          if (error.code === '23505') {
            showNotification('error', '❌ Este Device UID ya está registrado');
          } else {
            showNotification('error', `❌ Error: ${error.message}`);
          }
          setSubmitting(false);
          return;
        }

        showNotification('success', '✅ Dispositivo registrado correctamente');
      } else if (dialogMode === 'edit' && selectedDevice) {
        // Editar dispositivo existente
        const { error } = await supabase
          .from('devices')
          .update({
            device_id: formData.deviceId.trim(),
            name: formData.name.trim() || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedDevice.id);

        if (error) {
          if (error.code === '23505') {
            showNotification('error', '❌ Este Device UID ya está registrado');
          } else {
            showNotification('error', `❌ Error: ${error.message}`);
          }
          setSubmitting(false);
          return;
        }

        showNotification('success', '✅ Dispositivo actualizado correctamente');
      }

      closeDialog();
      await fetchDevices();
    } catch (error) {
      console.error('Error saving device:', error);
      showNotification('error', '❌ Error al guardar dispositivo');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (device: UnassignedDevice) => {
    if (!confirm(`¿Estás seguro de eliminar el dispositivo "${device.device_id}"?\n\nEsta acción no se puede deshacer.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('devices')
        .delete()
        .eq('id', device.id);

      if (error) throw error;

      showNotification('success', '✅ Dispositivo eliminado');
      await fetchDevices();
    } catch (error) {
      console.error('Error deleting device:', error);
      showNotification('error', '❌ Error al eliminar dispositivo');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-card to-background">
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
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/admin')}
                title="Volver al Admin"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <Package className="h-6 w-6 text-primary" strokeWidth={2} />
                  <div>
                    <h1 className="text-xl font-bold tracking-tight">Inventario de Hardware</h1>
                    <p className="text-xs text-muted-foreground">
                      Gestión de dispositivos IoT no asignados
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Button
              onClick={() => openDialog('create')}
              className="gap-2"
            >
              <PackagePlus className="h-4 w-4" />
              Registrar Nuevo Dispositivo
            </Button>
          </div>
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div className="fixed top-20 right-4 z-50 animate-in slide-in-from-top">
          <Card className={`${
            notification.type === 'success' 
              ? 'border-emerald-500/50 bg-emerald-500/10' 
              : 'border-red-500/50 bg-red-500/10'
          }`}>
            <CardContent className="p-4 flex items-center gap-2">
              {notification.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Stats Summary */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Stock Total
              </CardTitle>
              <Package className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{devices.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Dispositivos disponibles
              </p>
            </CardContent>
          </Card>

          <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Offline
              </CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">
                {devices.filter(d => d.status === 'offline').length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sin actividad reciente
              </p>
            </CardContent>
          </Card>

          <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Online
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-500">
                {devices.filter(d => d.status === 'online').length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Activos en stock
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Devices Table */}
        <Card className="glass-effect">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" strokeWidth={2} />
              Dispositivos No Asignados (Stock)
            </CardTitle>
            <CardDescription>
              Hardware registrado en el sistema pendiente de ser vinculado a una sala
            </CardDescription>
          </CardHeader>
          <CardContent>
            {devices.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" strokeWidth={1.5} />
                <p className="text-lg font-medium text-muted-foreground">No hay dispositivos en stock</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Registra nuevos dispositivos antes de enviarlos a los clientes
                </p>
                <Button onClick={() => openDialog('create')} className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Registrar Primer Dispositivo
                </Button>
              </div>
            ) : (
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Device UID</TableHead>
                      <TableHead className="font-semibold">Nombre/Modelo</TableHead>
                      <TableHead className="font-semibold w-[120px]">Estado</TableHead>
                      <TableHead className="font-semibold w-[180px]">Fecha de Registro</TableHead>
                      <TableHead className="font-semibold text-center w-[120px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((device) => (
                      <TableRow key={device.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell>
                          <span className="font-mono text-sm font-semibold text-primary">
                            {device.device_id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {device.name || <span className="text-muted-foreground italic">Sin nombre</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={device.status === 'online' ? 'alert-success' : 'alert-danger'}>
                            {device.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Date(device.created_at).toLocaleDateString('es-ES', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openDialog('edit', device)}
                              >
                                <Edit2 className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-500"
                                onClick={() => handleDelete(device)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Create/Edit Device Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? '➕ Registrar Nuevo Dispositivo' : '✏️ Editar Dispositivo'}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>
                  {dialogMode === 'create' 
                    ? 'Registra un nuevo dispositivo IoT en el inventario antes de enviarlo al cliente.' 
                    : 'Actualiza la información del dispositivo.'}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="deviceId">
                Device UID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="deviceId"
                placeholder="ej: RPI-001-JALISCO"
                value={formData.deviceId}
                onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
                className="font-mono"
                disabled={submitting || dialogMode === 'edit'} // No editar UID en modo edit
              />
              <p className="text-xs text-muted-foreground">
                {dialogMode === 'create' 
                  ? 'Identificador único del dispositivo (impreso en la etiqueta física)'
                  : 'El Device UID no puede modificarse después de crearlo'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Nombre/Modelo (Opcional)</Label>
              <Input
                id="name"
                placeholder="ej: Sensor Gen 1, Raspberry Pi 4"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Descripción o modelo del dispositivo para identificarlo fácilmente
              </p>
            </div>

            {dialogMode === 'create' && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5" strokeWidth={2} />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground mb-1">ℹ️ Información</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>El dispositivo se registrará con estado <strong>offline</strong></li>
                      <li>Permanecerá en el inventario hasta que lo vincules a una sala</li>
                      <li>Podrás editarlo o eliminarlo desde esta vista</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !formData.deviceId.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {dialogMode === 'create' ? 'Registrar' : 'Guardar Cambios'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

