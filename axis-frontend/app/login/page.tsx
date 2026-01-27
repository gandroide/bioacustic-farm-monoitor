"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Shield } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    // Simulate authentication
    setTimeout(() => {
      router.push('/dashboard');
    }, 1000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-card to-background p-4">
      {/* Animated grid background */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, oklch(0.3 0.02 264) 1px, transparent 1px),
            linear-gradient(to bottom, oklch(0.3 0.02 264) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }} />
      </div>

      {/* Login Card */}
      <Card className="w-full max-w-md relative glass-effect shadow-2xl">
        <CardHeader className="space-y-4 pb-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="relative">
              <Activity className="h-12 w-12 text-primary glow-warning" strokeWidth={2.5} />
              <Shield className="h-6 w-6 text-accent absolute -right-2 -bottom-1 glow-success" />
            </div>
          </div>
          
          <div className="text-center space-y-2">
            <CardTitle className="text-3xl font-bold tracking-tight">
              Ontiveros Bio-Alert
            </CardTitle>
            <CardDescription className="text-base">
              Sistema de Monitoreo Bioacústico
            </CardDescription>
          </div>

          {/* Status Badge */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-muted-foreground font-medium">
              Sistema En Línea
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Login Button */}
          <Button 
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-12 text-base font-semibold"
            size="lg"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Autenticando...</span>
              </div>
            ) : (
              'Acceder al Dashboard'
            )}
          </Button>

          {/* Footer Info */}
          <div className="space-y-3 pt-4 border-t border-border/50">
            <div className="text-center text-xs text-muted-foreground">
              v0.7.0 | Plataforma Edge Computing
            </div>
            <div className="text-center text-xs text-muted-foreground font-medium">
              Inteligencia Ganadera de Próxima Generación
            </div>
            <div className="text-center text-[10px] text-muted-foreground/70">
              Protegido con cifrado punto a punto | Cumplimiento ISO 27001
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
