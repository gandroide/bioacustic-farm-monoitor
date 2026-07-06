"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { 
  getCurrentUserProfile,
  getSiteById,
  getBuildingsBySite,
  getRoomsByBuilding,
  getDevicesByRoom,
  createBuilding,
  createRoom,
  updateBuilding,
  updateRoom,
  deleteBuilding,
  deleteRoom,
  supabase,
  Event,
  Building,
  Room,
  Device,
  SiteWithOrganization
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminIoTSimulator } from "@/components/admin/admin-iot-simulator";
import { 
  ArrowLeft,
  Building2,
  Home,
  Cpu,
  Activity,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Wifi,
  WifiOff,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  Save,
  RefreshCw
} from "lucide-react";
import { EventsTable } from "@/components/dashboard/events-table";
import { AlertsChart } from "@/components/dashboard/alerts-chart";
import { toast } from "sonner";

export const dynamic = 'force-dynamic';

interface RoomWithDevices extends Room {
  devices: Device[];
}

interface BuildingWithRooms extends Building {
  rooms: RoomWithDevices[];
}

type DialogMode = 'add_building' | 'add_room' | 'edit_building' | 'edit_room' | 'claim_device' | null;

interface DialogState {
  mode: DialogMode;
  buildingId?: string;
  roomId?: string;
  currentName?: string;
  currentType?: string;
}

export default function SiteInspectionPage() {
  const router = useRouter();
  const params = useParams();
  const siteId = params.site_id as string;

  const [loading, setLoading] = useState(true);
  const [site, setSite] = useState<SiteWithOrganization | null>(null);
  const [buildings, setBuildings] = useState<BuildingWithRooms[]>([]);
  const [totalDevices, setTotalDevices] = useState(0);
  const [onlineDevices, setOnlineDevices] = useState(0);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState>({ mode: null });
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    capacity: "",
    deviceUid: ""
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchSiteData = async () => {
    try {
      // Verificar permisos
      const profile = await getCurrentUserProfile();
      if (!profile || (profile.role !== 'super_admin' && profile.role !== 'org_admin')) {
        router.push('/admin');
        return;
      }

      // Guardar si es super_admin (para mostrar IoT Simulator)
      setIsSuperAdmin(profile.role === 'super_admin');

      // Obtener información del site
      const siteData = await getSiteById(siteId);
      if (!siteData) {
        console.error('Site not found');
        router.push('/admin');
        return;
      }
      setSite(siteData);

      // Obtener buildings del site
      const buildingsData = await getBuildingsBySite(siteId);

      // Para cada building, obtener rooms y devices
      const buildingsWithData = await Promise.all(
        buildingsData.map(async (building) => {
          const rooms = await getRoomsByBuilding(building.id);
          
          const roomsWithDevices = await Promise.all(
            rooms.map(async (room) => {
              const devices = await getDevicesByRoom(room.id);
              return {
                ...room,
                devices: devices.map(d => ({
                  id: d.id,
                  device_id: d.device_id,
                  uid: d.uid,
                  mac_address: d.mac_address,
                  room_id: d.room_id,
                  name: d.name,
                  status: d.status,
                  last_heartbeat: d.last_heartbeat,
                  firmware_version: d.firmware_version,
                  created_at: d.created_at,
                  updated_at: d.updated_at
                }))
              };
            })
          );

          return {
            ...building,
            rooms: roomsWithDevices
          };
        })
      );

      setBuildings(buildingsWithData);

      // Calcular totales
      let total = 0;
      let online = 0;
      buildingsWithData.forEach(building => {
        building.rooms.forEach(room => {
          total += room.devices.length;
          online += room.devices.filter(d => d.status === 'online').length;
        });
      });
      setTotalDevices(total);
      setOnlineDevices(online);

      // Fetch acoustic events for this site's rooms
      const roomIds: string[] = [];
      buildingsWithData.forEach(b => {
        b.rooms.forEach(r => roomIds.push(r.id));
      });

      let eventsQuery = supabase
        .from('acoustic_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (roomIds.length > 0) {
        // Filter by rooms in this site, but also include unassigned events (room_id is null) 
        // to ensure hardcoded testing events are visible to the Super Admin
        eventsQuery = eventsQuery.or(`room_id.in.(${roomIds.join(',')}),room_id.is.null`);
      }

      const { data: eventsData, error: eventsError } = await eventsQuery;

      if (eventsError) {
        console.error('Error fetching site events:', eventsError);
      } else {
        setEvents(eventsData || []);
      }

    } catch (error) {
      console.error('Error fetching site data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSiteData();

    // Subscribe to realtime events for this site
    const subscription = supabase
      .channel('admin_events_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'acoustic_events',
        },
        () => {
          fetchSiteData();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [siteId]);

  const openDialog = async (mode: DialogMode, data?: Partial<DialogState>) => {
    setDialogState({ mode, ...data });
    setFormData({
      name: data?.currentName || "",
      type: data?.currentType || "",
      capacity: "",
      deviceUid: ""
    });

    if (mode === 'claim_device') {
      const { data: stockDevices } = await supabase
        .from('devices')
        .select('*')
        .is('room_id', null)
        .order('created_at', { ascending: false });
      setAvailableDevices(stockDevices || []);
    }
  };

  const closeDialog = () => {
    setDialogState({ mode: null });
    setFormData({ name: "", type: "", capacity: "", deviceUid: "" });
  };

  const handleSubmit = async () => {
    if (!site) return;
    
    setSubmitting(true);
    try {
      switch (dialogState.mode) {
        case 'add_building':
          const newBuilding = await createBuilding(
            site.id,
            formData.name,
            formData.type || undefined,
            formData.capacity ? parseInt(formData.capacity) : undefined
          );
          if (newBuilding) {
            toast.success('Edificio creado correctamente');
            await fetchSiteData();
          } else {
            toast.error('Error al crear edificio');
          }
          break;

        case 'add_room':
          if (!dialogState.buildingId) return;
          const newRoom = await createRoom(
            dialogState.buildingId,
            formData.name,
            formData.type || undefined,
            formData.capacity ? parseInt(formData.capacity) : undefined
          );
          if (newRoom) {
            toast.success('Sala creada correctamente');
            await fetchSiteData();
          } else {
            toast.error('Error al crear sala');
          }
          break;

        case 'edit_building':
          if (!dialogState.buildingId) return;
          const buildingUpdated = await updateBuilding(dialogState.buildingId, {
            name: formData.name,
            building_type: formData.type || undefined
          });
          if (buildingUpdated) {
            toast.success('Edificio actualizado');
            await fetchSiteData();
          } else {
            toast.error('Error al actualizar edificio');
          }
          break;

        case 'edit_room':
          if (!dialogState.roomId) return;
          const roomUpdated = await updateRoom(dialogState.roomId, {
            name: formData.name,
            room_type: formData.type || undefined
          });
          if (roomUpdated) {
            toast.success('Sala actualizada');
            await fetchSiteData();
          } else {
            toast.error('Error al actualizar sala');
          }
          break;

        case 'claim_device':
          if (!dialogState.roomId || !formData.deviceUid) return;
          const { error: claimError } = await supabase
            .from('devices')
            .update({ room_id: dialogState.roomId, updated_at: new Date().toISOString() })
            .eq('id', formData.deviceUid);
            
          if (!claimError) {
            toast.success('Dispositivo vinculado correctamente');
            await fetchSiteData();
          } else {
            toast.error('Error al vincular dispositivo');
          }
          break;
      }
      closeDialog();
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      toast.error('Error en la operación');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateDevice = async (device: Device, action: 'online' | 'offline' | 'alert') => {
    try {
      if (action === 'online' || action === 'offline') {
        const { error } = await supabase
          .from('devices')
          .update({
            status: action,
            last_heartbeat: action === 'online' ? new Date().toISOString() : device.last_heartbeat,
            updated_at: new Date().toISOString()
          })
          .eq('id', device.id);
        
        if (error) throw error;
        toast.success(`Dispositivo simulado como ${action}`);
      } else if (action === 'alert') {
        const { error } = await supabase
          .from('acoustic_events')
          .insert({
            device_id: device.id,
            room_id: device.room_id,
            event_type: 'test_alert',
            rms_level: 90.0,
            battery_percentage: 100
          });
          
        if (error) throw error;
        toast.success('Alerta de prueba generada (RMS: 90.0)');
      }
      
      await fetchSiteData();
    } catch (error) {
      console.error('Error simulating device:', error);
      toast.error('Error al ejecutar simulación');
    }
  };

  const handleDelete = async (type: 'building' | 'room', id: string, name: string) => {
    if (!confirm(`¿Estás seguro de eliminar este ${type === 'building' ? 'edificio' : 'sala'}?\n\n"${name}"\n\nEsta acción no se puede deshacer.`)) {
      return;
    }

    try {
      const success = type === 'building' 
        ? await deleteBuilding(id)
        : await deleteRoom(id);

      if (success) {
        toast.success(`${type === 'building' ? 'Edificio' : 'Sala'} eliminado`);
        await fetchSiteData();
      } else {
        toast.error('Error al eliminar');
      }
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Error al eliminar');
    }
  };

  const isDeviceOnline = (device: Device) => {
    if (device.status !== 'online') return false;
    if (!device.last_heartbeat) return false;

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const lastHeartbeat = new Date(device.last_heartbeat);
    return lastHeartbeat > tenMinutesAgo;
  };

  const hasOfflineDevices = (building: BuildingWithRooms) => {
    return building.rooms.some(room => 
      room.devices.some(device => !isDeviceOnline(device))
    );
  };

  const formatHeartbeat = (heartbeat: string | null) => {
    if (!heartbeat) return 'Nunca';
    const date = new Date(heartbeat);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMinutes < 1) return 'Ahora';
    if (diffMinutes < 60) return `Hace ${diffMinutes}m`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Hace ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `Hace ${diffDays}d`;
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchSiteData().then(() => setRefreshing(false));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-card to-background">
        <div className="h-12 w-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-card to-background">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-lg font-medium">Site no encontrado</p>
          <Button onClick={() => router.push('/admin')} className="mt-4">
            Volver al Admin
          </Button>
        </div>
      </div>
    );
  }

  const healthPercentage = totalDevices > 0 ? (onlineDevices / totalDevices) * 100 : 100;

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
                  <Building2 className="h-6 w-6 text-primary" strokeWidth={2} />
                  <div>
                    <h1 className="text-xl font-bold tracking-tight">{site.name}</h1>
                    <p className="text-xs text-muted-foreground">
                      {site.organization.name} • Inspección Técnica
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {site.location && (
                <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {site.location}
                </div>
              )}
              {isSuperAdmin && (
                <Button
                  onClick={() => openDialog('add_building')}
                  size="sm"
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Nuevo Edificio
                </Button>
              )}
              <Badge 
                className={`${
                  healthPercentage === 100 ? 'alert-success' : 
                  healthPercentage >= 60 ? 'alert-warning' : 
                  'alert-danger'
                }`}
              >
                {healthPercentage === 100 ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Todos Online
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {onlineDevices}/{totalDevices} Online
                  </>
                )}
              </Badge>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing || loading}
                title="Actualizar"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* IoT Simulator (Solo Super Admin) */}
        {isSuperAdmin && (
          <AdminIoTSimulator 
            siteId={siteId} 
            onSimulationComplete={fetchSiteData}
          />
        )}

        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Buildings (Naves)
              </CardTitle>
              <Building2 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{buildings.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Estructuras registradas
              </p>
            </CardContent>
          </Card>

          <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Rooms (Salas)
              </CardTitle>
              <Home className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">
                {buildings.reduce((sum, b) => sum + b.rooms.length, 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Áreas monitoreadas
              </p>
            </CardContent>
          </Card>

          <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Devices IoT
              </CardTitle>
              <Cpu className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-500">
                {onlineDevices}/{totalDevices}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Dispositivos activos
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Bioacoustic Events Feed */}
        <div className="space-y-6 animate-in-view stagger-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Análisis Bioacústico del Sitio</h2>
          </div>
          <AlertsChart events={events} />
          <EventsTable events={events} />
        </div>

        {/* Buildings Grid */}
        <div className="flex items-center justify-between mt-12 animate-in-view stagger-5">
          <h2 className="text-xl font-bold tracking-tight">Infraestructura IoT</h2>
        </div>
        {buildings.length === 0 ? (
          <Card className="glass-effect">
            <CardContent className="py-12 text-center">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" strokeWidth={1.5} />
              <p className="text-lg font-medium text-muted-foreground">Sin buildings registrados</p>
              <p className="text-sm text-muted-foreground mt-2">
                Este site aún no tiene estructura configurada.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {buildings.map((building) => {
              const hasOffline = hasOfflineDevices(building);
              const buildingDevices = building.rooms.reduce((sum, r) => sum + r.devices.length, 0);
              const buildingOnline = building.rooms.reduce(
                (sum, r) => sum + r.devices.filter(d => isDeviceOnline(d)).length, 
                0
              );

              return (
                <Card 
                  key={building.id} 
                  className={`glass-effect transition-all duration-300 ${
                    hasOffline ? 'border-red-500/50 bg-red-500/5' : 'hover:border-primary/30'
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Building2 className={`h-6 w-6 ${hasOffline ? 'text-red-500' : 'text-primary'}`} strokeWidth={2} />
                        <div>
                          <CardTitle className="text-lg">{building.name}</CardTitle>
                          {building.building_type && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Tipo: {building.building_type}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={hasOffline ? 'alert-danger' : 'alert-success'}>
                          {buildingOnline}/{buildingDevices} Online
                        </Badge>
                        {isSuperAdmin && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => openDialog('add_room', { buildingId: building.id })}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Agregar Sala
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => openDialog('edit_building', {
                                    buildingId: building.id,
                                    currentName: building.name,
                                    currentType: building.building_type || undefined
                                  })}
                                >
                                  <Edit2 className="h-4 w-4 mr-2" />
                                  Editar Edificio
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-500"
                                  onClick={() => handleDelete('building', building.id, building.name)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Eliminar Edificio
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {building.rooms.map((room) => (
                        <div key={room.id} className="border border-border/50 rounded-lg p-4 bg-muted/30">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Home className="h-4 w-4 text-amber-500" strokeWidth={2} />
                              <span className="font-medium text-sm">{room.name}</span>
                              {room.room_type && (
                                <Badge variant="outline" className="text-xs">
                                  {room.room_type}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                <Cpu className="h-3 w-3 mr-1" />
                                {room.devices.length} dispositivo{room.devices.length !== 1 ? 's' : ''}
                              </Badge>
                            </div>
                            {isSuperAdmin && (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openDialog('claim_device', { roomId: room.id })}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Vincular
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <MoreVertical className="h-3 w-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => openDialog('edit_room', {
                                        roomId: room.id,
                                        currentName: room.name,
                                        currentType: room.room_type || undefined
                                      })}
                                    >
                                      <Edit2 className="h-4 w-4 mr-2" />
                                      Editar Sala
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-red-500"
                                      onClick={() => handleDelete('room', room.id, room.name)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Eliminar Sala
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                          </div>

                          {room.devices.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              Sin dispositivos instalados
                            </p>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                              {room.devices.map((device) => {
                                const online = isDeviceOnline(device);
                                return (
                                  <div
                                    key={device.id}
                                    className={`border rounded-md p-3 ${
                                      online 
                                        ? 'border-emerald-500/30 bg-emerald-500/5' 
                                        : 'border-red-500/30 bg-red-500/5'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        {online ? (
                                          <Wifi className="h-4 w-4 text-emerald-500" strokeWidth={2} />
                                        ) : (
                                          <WifiOff className="h-4 w-4 text-red-500" strokeWidth={2} />
                                        )}
                                        <span className={`text-xs font-medium ${
                                          online ? 'text-emerald-500' : 'text-red-500'
                                        }`}>
                                          {online ? 'Online' : 'Offline'}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Badge variant="outline" className="text-[10px] font-mono">
                                          {device.status}
                                        </Badge>
                                        
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                              <MoreVertical className="h-4 w-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => handleSimulateDevice(device, 'online')}>
                                              <Activity className="h-4 w-4 mr-2" /> Simular Online
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleSimulateDevice(device, 'offline')}>
                                              <WifiOff className="h-4 w-4 mr-2" /> Simular Offline
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleSimulateDevice(device, 'alert')}>
                                              <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" /> Generar Alerta de Prueba
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </div>

                                    <div className="space-y-1">
                                      <div className="text-xs">
                                        <span className="text-muted-foreground">Nombre:</span>
                                        <span className="ml-2 font-medium">{device.name || 'Sin nombre'}</span>
                                      </div>
                                      <div className="text-xs font-mono bg-muted/50 p-1.5 rounded">
                                        <span className="text-muted-foreground">UID:</span>
                                        <span className="ml-2 text-primary font-semibold">{device.uid || device.mac_address || device.device_id}</span>
                                      </div>
                                      <div className="text-xs">
                                        <span className="text-muted-foreground">Heartbeat:</span>
                                        <span className={`ml-2 ${
                                          online ? 'text-emerald-500' : 'text-red-500'
                                        }`}>
                                          {formatHeartbeat(device.last_heartbeat)}
                                        </span>
                                      </div>
                                      {device.firmware_version && (
                                        <div className="text-xs">
                                          <span className="text-muted-foreground">FW:</span>
                                          <span className="ml-2 font-mono">{device.firmware_version}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Universal Dialog for CRUD Operations */}
      <Dialog open={dialogState.mode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState.mode === 'add_building' && 'Agregar Nuevo Edificio/Nave'}
              {dialogState.mode === 'add_room' && 'Agregar Nueva Sala'}
              {dialogState.mode === 'edit_building' && 'Editar Edificio'}
              {dialogState.mode === 'edit_room' && 'Editar Sala'}
              {dialogState.mode === 'claim_device' && 'Vincular Dispositivo IoT'}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {dialogState.mode === 'claim_device' ? (
                  <p>Selecciona un dispositivo disponible en el inventario para vincularlo a esta sala.</p>
                ) : (
                  <p>Completa los datos para {dialogState.mode?.includes('add') ? 'crear' : 'actualizar'} el elemento.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {dialogState.mode === 'claim_device' ? (
              <div className="space-y-2">
                <Label htmlFor="deviceUid">Seleccionar Dispositivo (Inventario)</Label>
                {availableDevices.length === 0 ? (
                  <div className="text-sm text-muted-foreground border border-dashed border-border p-4 rounded-md bg-muted/30 text-center">
                    <p className="font-medium text-foreground mb-1">Inventario Vacío</p>
                    <p>No hay dispositivos disponibles en stock.</p>
                    <p>Crea uno nuevo en la sección de Inventario.</p>
                  </div>
                ) : (
                  <>
                    <Select
                      value={formData.deviceUid}
                      onValueChange={(value) => setFormData({ ...formData, deviceUid: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un dispositivo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDevices.map(d => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name || 'Sin nombre'} ({d.uid || d.mac_address || 'Sin ID'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-2">
                      Selecciona un dispositivo no asignado para vincularlo a esta sala.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    placeholder={dialogState.mode?.includes('building') ? 'ej: Nave de Maternidad A' : 'ej: Sala 1 - Parideras'}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Tipo (Opcional)</Label>
                  <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {dialogState.mode?.includes('building') ? (
                        <>
                          <SelectItem value="Maternidad">Maternidad</SelectItem>
                          <SelectItem value="Engorde">Engorde</SelectItem>
                          <SelectItem value="Destete">Destete</SelectItem>
                          <SelectItem value="Gestación">Gestación</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Parideras">Parideras</SelectItem>
                          <SelectItem value="Corrales">Corrales</SelectItem>
                          <SelectItem value="Cuarentena">Cuarentena</SelectItem>
                          <SelectItem value="Almacenamiento">Almacenamiento</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {dialogState.mode?.includes('add') && (
                  <div className="space-y-2">
                    <Label htmlFor="capacity">Capacidad (Opcional)</Label>
                    <Input
                      id="capacity"
                      type="number"
                      placeholder="ej: 50"
                      value={formData.capacity}
                      onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !formData.name && !formData.deviceUid}>
              {submitting ? (
                <>
                  <div className="h-4 w-4 border-2 border-background/20 border-t-background rounded-full animate-spin mr-2" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {dialogState.mode?.includes('add') ? 'Crear' : dialogState.mode === 'claim_device' ? 'Vincular' : 'Guardar'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

