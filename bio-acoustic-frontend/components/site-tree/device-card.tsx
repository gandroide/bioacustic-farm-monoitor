"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Activity, AlertTriangle, Cpu, MoreVertical, Wifi, WifiOff } from "lucide-react";
import type { Device } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export type DeviceCardAction = "online" | "offline" | "alert";

interface DeviceCardProps {
  device: Device;
  online: boolean;
  variant?: "detailed" | "compact";
  showSimulateMenu?: boolean;
  onSimulate?: (device: Device, action: DeviceCardAction) => void;
  formatHeartbeat?: (heartbeat: string | null) => string;
}

export function DeviceCard({
  device,
  online,
  variant = "detailed",
  showSimulateMenu = false,
  onSimulate,
  formatHeartbeat,
}: DeviceCardProps) {
  const uid = device.uid || device.mac_address || device.device_id || "Sin Identificador";

  if (variant === "compact") {
    return (
      <div className="border border-border/30 rounded-md p-2 bg-background/50">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="h-3 w-3 text-emerald-500" />
          <span className="text-xs font-medium">{device.name || "Sin nombre"}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] ml-auto",
              device.status === "online" ? "alert-success" : "alert-danger",
            )}
          >
            {device.status}
          </Badge>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">UID: {uid}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border rounded-md p-3",
        online ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5",
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {online ? (
            <Wifi className="h-4 w-4 text-emerald-500" strokeWidth={2} />
          ) : (
            <WifiOff className="h-4 w-4 text-red-500" strokeWidth={2} />
          )}
          <span className={cn("text-xs font-medium", online ? "text-emerald-500" : "text-red-500")}>
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px] font-mono">
            {device.status}
          </Badge>

          {showSimulateMenu && onSimulate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSimulate(device, "online")}>
                  <Activity className="h-4 w-4 mr-2" /> Simular Online
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSimulate(device, "offline")}>
                  <WifiOff className="h-4 w-4 mr-2" /> Simular Offline
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSimulate(device, "alert")}>
                  <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" /> Generar Alerta de Prueba
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs">
          <span className="text-muted-foreground">Nombre:</span>
          <span className="ml-2 font-medium">{device.name || "Sin nombre"}</span>
        </div>
        <div className="text-xs font-mono bg-muted/50 p-1.5 rounded">
          <span className="text-muted-foreground">UID:</span>
          <span className="ml-2 text-primary font-semibold">{uid}</span>
        </div>
        {formatHeartbeat && (
          <div className="text-xs">
            <span className="text-muted-foreground">Heartbeat:</span>
            <span className={cn("ml-2", online ? "text-emerald-500" : "text-red-500")}>
              {formatHeartbeat(device.last_heartbeat)}
            </span>
          </div>
        )}
        {device.firmware_version && (
          <div className="text-xs">
            <span className="text-muted-foreground">FW:</span>
            <span className="ml-2 font-mono">{device.firmware_version}</span>
          </div>
        )}
      </div>
    </div>
  );
}
