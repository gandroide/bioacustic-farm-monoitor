"use client";

import { useState } from "react";
import { Farm, createFarm } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, MapPin, Calendar } from "lucide-react";

interface FarmsManagementProps {
  farms: Farm[];
  onFarmCreated: () => void;
}

export function FarmsManagement({ farms, onFarmCreated }: FarmsManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newFarmName, setNewFarmName] = useState("");
  const [newFarmLocation, setNewFarmLocation] = useState("");

  const handleCreateFarm = async () => {
    if (!newFarmName.trim()) {
      alert("Por favor, ingresa un nombre para la granja");
      return;
    }

    setIsCreating(true);
    try {
      const farm = await createFarm(newFarmName, newFarmLocation);
      if (farm) {
        setNewFarmName("");
        setNewFarmLocation("");
        setIsDialogOpen(false);
        onFarmCreated();
      } else {
        alert("Error al crear la granja");
      }
    } catch (error) {
      console.error("Error creating farm:", error);
      alert("Error al crear la granja");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="glass-effect">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" strokeWidth={2} />
              Gestión de Granjas
            </CardTitle>
            <CardDescription className="mt-2">
              Administra las granjas registradas en la plataforma. Cada granja tiene acceso aislado a sus propios datos.
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 glow-warning">
                <Plus className="h-4 w-4 mr-2" />
                Crear Nueva Granja
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-effect border-border/50">
              <DialogHeader>
                <DialogTitle>Registrar Nueva Granja</DialogTitle>
                <DialogDescription>
                  Ingresa los datos de la nueva granja. Se creará un espacio aislado para sus datos.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label htmlFor="farm-name" className="text-sm font-medium">
                    Nombre de la Granja *
                  </label>
                  <input
                    id="farm-name"
                    type="text"
                    placeholder="Ej: Granja San José"
                    value={newFarmName}
                    onChange={(e) => setNewFarmName(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="farm-location" className="text-sm font-medium">
                    Ubicación (Opcional)
                  </label>
                  <input
                    id="farm-location"
                    type="text"
                    placeholder="Ej: Jalisco, México"
                    value={newFarmLocation}
                    onChange={(e) => setNewFarmLocation(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isCreating}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreateFarm}
                  disabled={isCreating}
                  className="bg-primary hover:bg-primary/90"
                >
                  {isCreating ? "Creando..." : "Crear Granja"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {farms.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" strokeWidth={1.5} />
            <p className="text-sm">No hay granjas registradas aún.</p>
            <p className="text-xs mt-1">Crea la primera granja para comenzar.</p>
          </div>
        ) : (
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Nombre</TableHead>
                  <TableHead className="font-semibold">Ubicación</TableHead>
                  <TableHead className="font-semibold">Fecha de Registro</TableHead>
                  <TableHead className="font-semibold">ID (UUID)</TableHead>
                  <TableHead className="font-semibold text-center">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {farms.map((farm) => (
                  <TableRow key={farm.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium">{farm.name}</TableCell>
                    <TableCell>
                      {farm.location ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-3 w-3" strokeWidth={2} />
                          <span className="text-sm">{farm.location}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No especificada</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-3 w-3" strokeWidth={2} />
                        <span className="text-sm font-mono">
                          {new Date(farm.created_at).toLocaleDateString('es-ES', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                        {farm.id.slice(0, 8)}...
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="alert-success text-xs">
                        ✓ Activa
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

