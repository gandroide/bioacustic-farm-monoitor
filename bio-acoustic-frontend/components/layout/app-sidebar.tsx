"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Activity,
  BarChart3,
  Building,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  Shield,
  MapPin,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

interface AppSidebarProps {
  role: "super_admin" | "farm_admin";
  userName?: string;
  orgName?: string;
}

export function AppSidebar({ role, userName = "Usuario", orgName }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const adminNav: NavItem[] = [
    { label: "Centro de Comando", href: "/admin", icon: LayoutDashboard },
    { label: "Inventario", href: "/admin/inventory", icon: Package },
  ];

  const farmNav: NavItem[] = [
    { label: "Monitoreo", href: "/dashboard", icon: BarChart3 },
    { label: "Configurar Granja", href: "/dashboard/settings/farm", icon: Settings },
  ];

  const navItems = role === "super_admin" ? adminNav : farmNav;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const isActive = (href: string) => {
    if (href === "/admin" || href === "/dashboard") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-out",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {role === "super_admin" ? (
            <Shield className="h-5 w-5 text-primary" strokeWidth={2} />
          ) : (
            <Activity className="h-5 w-5 text-primary" strokeWidth={2} />
          )}
        </div>
        {!collapsed && (
          <div className="flex flex-col overflow-hidden animate-fade-in">
            <span className="text-sm font-bold tracking-tight text-foreground truncate">
              Bio-Alert
            </span>
            <span className="text-[10px] text-muted-foreground font-mono truncate">
              {role === "super_admin" ? "Super Admin" : orgName || "Farm Admin"}
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <div className={cn("mb-3", collapsed ? "px-0" : "px-2")}>
          {!collapsed && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {role === "super_admin" ? "Plataforma" : "Mi Granja"}
            </span>
          )}
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          const linkContent = (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "sidebar-item group",
                active && "sidebar-item-active",
                collapsed && "justify-center px-2"
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-colors",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              {!collapsed && (
                <span className="truncate">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono text-primary">
                  {item.badge}
                </span>
              )}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return linkContent;
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        {/* User info */}
        <div className={cn(
          "flex items-center gap-3 rounded-lg px-2 py-2",
          collapsed && "justify-center px-0"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {userName.charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="text-xs font-medium text-foreground truncate">
                {userName}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                {role === "super_admin" ? "Administrador" : "Operador"}
              </span>
            </div>
          )}
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Logout + Collapse */}
        <div className="flex items-center gap-1">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  className="sidebar-item justify-center px-2 w-full text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Cerrar Sesión</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={handleLogout}
              className="sidebar-item flex-1 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-[18px] w-[18px]" />
              <span className="text-xs">Cerrar Sesión</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-md transition-colors hover:text-foreground hover:bg-card"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>
    </aside>
  );
}
