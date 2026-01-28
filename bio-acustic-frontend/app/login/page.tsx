"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// 👇 VOLVEMOS A TU CLIENTE ORIGINAL (El que sí funciona)
import { supabase } from "@/lib/supabase"; 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Shield, Mail, Lock, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Usamos el cliente básico para autenticar
      const {  error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // 2. ÉXITO: Forzamos al navegador a guardar la sesión
      // Esto ayuda a que el Middleware detecte el cambio
      await supabase.auth.getSession();
      
      // 3. Redirigimos
      router.refresh(); // Refresca rutas
      router.push('/dashboard'); 
      
    } catch (err: any) {
      console.error(err);
      setError("Credenciales inválidas o error de conexión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-card to-background p-4">
      {/* Grid Background Effect */}
      <div className="absolute inset-0 overflow-hidden opacity-20 pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(to right, oklch(0.3 0.02 264) 1px, transparent 1px),
            linear-gradient(to bottom, oklch(0.3 0.02 264) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }} />
      </div>

      <Card className="w-full max-w-md relative glass-effect shadow-2xl border-border/50">
        <CardHeader className="space-y-4 pb-6">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="relative">
              <Activity className="h-12 w-12 text-primary glow-warning" strokeWidth={2.5} />
              <Shield className="h-6 w-6 text-emerald-500 absolute -right-2 -bottom-1 glow-success" />
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
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Identificador de Operador</Label>
              <div className="relative group">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@ontiveros.com"
                  className="pl-10 bg-secondary/30 border-border/50 focus:border-primary/50 transition-all h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Llave de Acceso</Label>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="password"
                  type="password"
                  className="pl-10 bg-secondary/30 border-border/50 focus:border-primary/50 transition-all h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            <Button 
              type="submit"
              disabled={loading}
              className="w-full h-12 text-base font-semibold mt-2"
              size="lg"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>Verificando Credenciales...</span>
                </div>
              ) : (
                'Iniciar Sesión Segura'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}