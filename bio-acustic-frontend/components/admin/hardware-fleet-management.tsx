"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Cpu, 
  MapPin, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Activity,
  Building2,
  UserPlus
} from "lucide-react";
import { Organization, SiteWithOrganization } from "@/lib/supabase";

interface SiteWithHardwareMetrics extends SiteWithOrganization {
  total_nodes: number;
  online_nodes: number;
  subscription_plan: 'Enterprise' | 'Pro' | 'Basic';
  subscription_status: 'active' | 'trial' | 'suspended';
  mrr: number;
}

interface HardwareFleetManagementProps {
  sites: SiteWithHardwareMetrics[];
  organizations: Organization[];
  onUpdate: () => void;
  onInviteUser?: (organizationId: string) => void;
}

export function HardwareFleetManagement({ sites, organizations, onUpdate, onInviteUser }: HardwareFleetManagementProps) {
  const router = useRouter();
  
  const getPlanBadgeColor = (plan: string) => {
    switch (plan) {
      case 'Enterprise':
        return 'bg-purple-500/10 border-purple-500/30 text-purple-500';
      case 'Pro':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-500';
      case 'Basic':
        return 'bg-slate-500/10 border-slate-500/30 text-slate-500';
      default:
        return '';
    }
  };

  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge className="alert-success text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Activa
          </Badge>
        );
      case 'trial':
        return (
          <Badge className="alert-warning text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />
            Trial
          </Badge>
        );
      case 'suspended':
        return (
          <Badge className="alert-danger text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />
            Suspendida
          </Badge>
        );
      default:
        return null;
    }
  };

  const getNodesHealthBadge = (online: number, total: number) => {
    const percentage = (online / total) * 100;
    const isHealthy = percentage === 100;
    const isCritical = percentage < 60;

    if (isHealthy) {
      return (
        <div className="flex items-center gap-2">
          <Badge className="alert-success font-mono text-xs px-3">
            {online}/{total} 🟢
          </Badge>
          <span className="text-xs text-emerald-500 font-medium">100% Online</span>
        </div>
      );
    }

    if (isCritical) {
      return (
        <div className="flex items-center gap-2">
          <Badge className="alert-danger font-mono text-xs px-3 animate-pulse">
            {online}/{total} 🔴
          </Badge>
          <span className="text-xs text-red-500 font-medium">⚠️ Crítico</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Badge className="alert-warning font-mono text-xs px-3">
          {online}/{total} 🟡
        </Badge>
        <span className="text-xs text-amber-500 font-medium">Atención requerida</span>
      </div>
    );
  };

  const getHealthStatus = (online: number, total: number) => {
    if (total === 0) return <span className="text-muted-foreground text-xs">Sin dispositivos</span>;
    
    const now = new Date();
    const recentActivity = now.toISOString();
    
    // Simulamos "última actividad" basado en el estado actual
    if (online === total) {
      return <span className="text-emerald-500 text-xs">• Sincronizado</span>;
    } else if (online / total >= 0.6) {
      return <span className="text-amber-500 text-xs">• Parcial</span>;
    } else {
      return <span className="text-red-500 text-xs">• Crítico ⚠️</span>;
    }
  };

  return (
    <Card className="glass-effect">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" strokeWidth={2} />
              Gestión de Flota IoT & Sites (Granjas)
            </CardTitle>
            <CardDescription className="mt-2">
              Monitoreo de hardware desplegado por Site. Organización → Sites → Buildings → Rooms → Devices
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sites.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Cpu className="h-12 w-12 mx-auto mb-4 opacity-50" strokeWidth={1.5} />
            <p className="text-sm">No hay sites registrados aún.</p>
            <p className="text-xs mt-2">Los sites aparecerán aquí cuando se configuren organizaciones.</p>
          </div>
        ) : (
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Organización / Site</TableHead>
                  <TableHead className="font-semibold w-[120px]">Plan</TableHead>
                  <TableHead className="font-semibold w-[280px]">Nodos (Hardware)</TableHead>
                  <TableHead className="font-semibold w-[140px]">Estado Suscripción</TableHead>
                  <TableHead className="font-semibold w-[120px]">MRR</TableHead>
                  <TableHead className="font-semibold text-center w-[120px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => {
                  const offlineNodes = site.total_nodes - site.online_nodes;
                  const healthPercentage = site.total_nodes > 0 
                    ? (site.online_nodes / site.total_nodes) * 100 
                    : 100;
                  
                  return (
                    <TableRow 
                      key={site.id} 
                      className={`hover:bg-muted/30 transition-colors ${
                        healthPercentage < 60 ? 'bg-red-500/5' : ''
                      }`}
                    >
                      {/* Organización / Site */}
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3 w-3 text-primary" />
                            <span className="font-semibold text-xs text-primary">
                              {site.organization.name}
                            </span>
                          </div>
                          <span className="font-medium text-sm ml-5">{site.name}</span>
                          {site.location && (
                            <div className="flex items-center gap-1 text-muted-foreground ml-5">
                              <MapPin className="h-3 w-3" strokeWidth={2} />
                              <span className="text-xs">{site.location}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1 ml-5">
                            <Calendar className="h-3 w-3 text-muted-foreground" strokeWidth={2} />
                            <span className="text-xs font-mono text-muted-foreground">
                              Creado {new Date(site.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Plan */}
                      <TableCell>
                        <Badge className={`${getPlanBadgeColor(site.subscription_plan)} text-xs px-3 py-1`}>
                          {site.subscription_plan}
                        </Badge>
                      </TableCell>

                      {/* Nodos (Hardware) - CRÍTICO */}
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          {getNodesHealthBadge(site.online_nodes, site.total_nodes)}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <Activity className="h-3 w-3" />
                            {getHealthStatus(site.online_nodes, site.total_nodes)}
                          </div>
                          {offlineNodes > 0 && (
                            <div className="text-xs text-red-500 font-medium">
                              ⚠️ {offlineNodes} nodo{offlineNodes > 1 ? 's' : ''} caído{offlineNodes > 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* Estado de Suscripción */}
                      <TableCell>
                        {getPaymentStatusBadge(site.subscription_status)}
                      </TableCell>

                      {/* MRR */}
                      <TableCell>
                        <span className="font-mono text-sm font-semibold text-emerald-500">
                          ${site.mrr.toFixed(2)}
                        </span>
                        <span className="text-xs text-muted-foreground">/mes</span>
                      </TableCell>

                      {/* Acciones */}
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          {onInviteUser && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3 text-xs"
                              onClick={() => onInviteUser(site.organization.id)}
                              title="Invitar administrador a esta organización"
                            >
                              <UserPlus className="h-3 w-3 mr-1" />
                              Invitar Admin
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 text-xs hover:bg-primary/10 hover:text-primary transition-colors"
                            onClick={() => router.push(`/admin/sites/${site.id}`)}
                            title="Ver inspección técnica del site"
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Inspeccionar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Leyenda */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-lg">🟢</span>
              <span>100% Online</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🟡</span>
              <span>60-99% Online (Atención)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🔴</span>
              <span>&lt;60% Online (Crítico)</span>
            </div>
            <div className="ml-auto text-xs">
              <Building2 className="h-3 w-3 inline mr-1" />
              Jerarquía: Org → Site → Building → Room → Device
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

