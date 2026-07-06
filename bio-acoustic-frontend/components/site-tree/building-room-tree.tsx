"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Cpu, Edit2, Home, MoreVertical, Plus, Trash2 } from "lucide-react";
import type { Device } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { DeviceCard, type DeviceCardAction } from "./device-card";
import type { BuildingWithRooms, RoomWithDevices } from "./types";

interface BuildingRoomTreeProps {
  buildings: BuildingWithRooms[];
  deviceVariant: "detailed" | "compact";
  canEdit: boolean;
  showSimulateMenu?: boolean;
  showHealthBadges?: boolean;
  isDeviceOnline: (device: Device) => boolean;
  onAddRoom: (buildingId: string) => void;
  onEditBuilding: (b: BuildingWithRooms) => void;
  onDeleteBuilding: (b: BuildingWithRooms) => void;
  onEditRoom: (b: BuildingWithRooms, r: RoomWithDevices) => void;
  onDeleteRoom: (b: BuildingWithRooms, r: RoomWithDevices) => void;
  onClaimDevice: (roomId: string) => void;
  onSimulateDevice?: (device: Device, action: DeviceCardAction) => void;
  formatHeartbeat?: (heartbeat: string | null) => string;
  emptyState?: React.ReactNode;
}

export function BuildingRoomTree({
  buildings,
  deviceVariant,
  canEdit,
  showSimulateMenu = false,
  showHealthBadges = false,
  isDeviceOnline,
  onAddRoom,
  onEditBuilding,
  onDeleteBuilding,
  onEditRoom,
  onDeleteRoom,
  onClaimDevice,
  onSimulateDevice,
  formatHeartbeat,
  emptyState,
}: BuildingRoomTreeProps) {
  if (buildings.length === 0) {
    return emptyState ?? null;
  }

  return (
    <div className="space-y-6">
      {buildings.map((building) => {
        const buildingDevices = building.rooms.reduce((sum, r) => sum + r.devices.length, 0);
        const buildingOnline = building.rooms.reduce(
          (sum, r) => sum + r.devices.filter((d) => isDeviceOnline(d)).length,
          0,
        );
        const hasOffline = buildingOnline < buildingDevices;

        return (
          <Card
            key={building.id}
            className={cn(
              "glass-effect transition-all duration-300",
              showHealthBadges && hasOffline
                ? "border-red-500/50 bg-red-500/5"
                : "hover:border-primary/30",
            )}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Building2
                    className={cn(
                      "h-6 w-6",
                      showHealthBadges && hasOffline ? "text-red-500" : "text-primary",
                    )}
                    strokeWidth={2}
                  />
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
                  {showHealthBadges && buildingDevices > 0 && (
                    <Badge className={hasOffline ? "alert-danger" : "alert-success"}>
                      {buildingOnline}/{buildingDevices} Online
                    </Badge>
                  )}
                  {canEdit && (
                    <>
                      <Button size="sm" onClick={() => onAddRoom(building.id)}>
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
                          <DropdownMenuItem onClick={() => onEditBuilding(building)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            Editar Edificio
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-500"
                            onClick={() => onDeleteBuilding(building)}
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
              {building.rooms.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-border rounded-lg">
                  <Home className="h-8 w-8 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">No hay salas en este edificio</p>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onAddRoom(building.id)}
                      className="mt-3"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Agregar Primera Sala
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {building.rooms.map((room) => (
                    <div
                      key={room.id}
                      className="border border-border/50 rounded-lg p-4 bg-muted/30"
                    >
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
                            {room.devices.length} dispositivo
                            {room.devices.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onClaimDevice(room.id)}
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
                                <DropdownMenuItem onClick={() => onEditRoom(building, room)}>
                                  <Edit2 className="h-4 w-4 mr-2" />
                                  Editar Sala
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-500"
                                  onClick={() => onDeleteRoom(building, room)}
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
                        <div
                          className={cn(
                            "grid gap-3 mt-3",
                            deviceVariant === "detailed"
                              ? "md:grid-cols-2 lg:grid-cols-3"
                              : "md:grid-cols-2 lg:grid-cols-3",
                          )}
                        >
                          {room.devices.map((device) => (
                            <DeviceCard
                              key={device.id}
                              device={device}
                              online={isDeviceOnline(device)}
                              variant={deviceVariant}
                              showSimulateMenu={showSimulateMenu}
                              onSimulate={onSimulateDevice}
                              formatHeartbeat={formatHeartbeat}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
