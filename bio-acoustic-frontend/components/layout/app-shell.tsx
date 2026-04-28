"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AppSidebar } from "./app-sidebar";

interface AppShellProps {
  children: React.ReactNode;
  requiredRole: "super_admin" | "farm_admin";
}

export function AppShell({ children, requiredRole }: AppShellProps) {
  const [userName, setUserName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setReady(true); // Let middleware handle redirect
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, role, organization_id")
          .eq("id", user.id)
          .single();

        if (profile) {
          setUserName(profile.full_name || user.email || "Usuario");

          // Get org name if available
          if (profile.organization_id) {
            const { data: org } = await supabase
              .from("organizations")
              .select("name")
              .eq("id", profile.organization_id)
              .single();
            if (org) setOrgName(org.name);
          }
        }
      } catch (e) {
        console.error("AppShell init error:", e);
      } finally {
        setReady(true);
      }
    };

    init();
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground font-mono animate-pulse">
            Inicializando sistema...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar role={requiredRole} userName={userName} orgName={orgName} />
      
      {/* Main content area — offset by sidebar width */}
      <main className="transition-all duration-300 pl-[68px] lg:pl-[240px]">
        <div className="min-h-screen">
          {children}
        </div>
      </main>
    </div>
  );
}
