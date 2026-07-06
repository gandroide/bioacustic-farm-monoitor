"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  Shield,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
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

const ADMIN_NAV: NavItem[] = [
  { label: "Centro de Comando", href: "/admin", icon: LayoutDashboard },
  { label: "Inventario", href: "/admin/inventory", icon: Package },
];

const FARM_NAV: NavItem[] = [
  { label: "Monitoreo", href: "/dashboard", icon: BarChart3 },
  { label: "Configurar Granja", href: "/dashboard/settings/farm", icon: Settings },
];

export function AppSidebar({ role, userName = "Usuario", orgName }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const navItems = role === "super_admin" ? ADMIN_NAV : FARM_NAV;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const isActive = (href: string) => {
    if (href === "/admin" || href === "/dashboard") return pathname === href;
    return pathname.startsWith(href);
  };

  const BrandIcon = role === "super_admin" ? Shield : Activity;

  const brand = (compact: boolean) => (
    <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4 shrink-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <BrandIcon className="h-5 w-5 text-primary" strokeWidth={2} />
      </div>
      {!compact && (
        <div className="flex flex-col overflow-hidden">
          <span className="text-sm font-bold tracking-tight text-foreground truncate">Bio-Alert</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate">
            {role === "super_admin" ? "Super Admin" : orgName || "Farm Admin"}
          </span>
        </div>
      )}
    </div>
  );

  const nav = (compact: boolean) => (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      <div className={cn("mb-3", compact ? "px-0" : "px-2")}>
        {!compact && (
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
            onClick={() => setMobileOpen(false)}
            className={cn(
              "sidebar-item group",
              active && "sidebar-item-active",
              compact && "justify-center px-2",
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition-colors",
                active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            {!compact && <span className="truncate">{item.label}</span>}
            {!compact && item.badge && (
              <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono text-primary">
                {item.badge}
              </span>
            )}
          </Link>
        );

        if (compact) {
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
  );

  const footer = (compact: boolean, showCollapseToggle: boolean) => (
    <div className="border-t border-sidebar-border p-3 space-y-2 shrink-0">
      <div className={cn("flex items-center gap-3 rounded-lg px-2 py-2", compact && "justify-center px-0")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
          {userName.charAt(0).toUpperCase()}
        </div>
        {!compact && (
          <div className="flex flex-col overflow-hidden">
            <span className="text-xs font-medium text-foreground truncate">{userName}</span>
            <span className="text-[10px] text-muted-foreground truncate">
              {role === "super_admin" ? "Administrador" : "Operador"}
            </span>
          </div>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      <div className={cn("flex items-center", compact ? "flex-col gap-1" : "gap-1")}>
        {compact ? (
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

        {showCollapseToggle && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "sidebar-item text-muted-foreground hover:text-foreground",
              compact ? "justify-center px-2 w-full" : "px-3",
            )}
            aria-label={compact ? "Expandir menú" : "Colapsar menú"}
          >
            {compact ? (
              <ChevronRight className="h-[18px] w-[18px]" />
            ) : (
              <ChevronLeft className="h-[18px] w-[18px]" />
            )}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar (< lg) */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 border-b border-sidebar-border bg-sidebar/95 backdrop-blur flex items-center gap-3 px-4">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menú">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 bg-sidebar border-r border-sidebar-border">
            <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
            <div className="flex flex-col h-full">
              {brand(false)}
              {nav(false)}
              {footer(false, false)}
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <BrandIcon className="h-5 w-5 text-primary" strokeWidth={2} />
          <span className="text-sm font-bold tracking-tight">Bio-Alert</span>
        </div>
      </div>

      {/* Desktop sidebar (>= lg) */}
      <aside
        className={cn(
          "hidden lg:flex fixed left-0 top-0 z-40 h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-out",
          collapsed ? "w-[68px]" : "w-[240px]",
        )}
      >
        {brand(collapsed)}
        {nav(collapsed)}
        {footer(collapsed, true)}
      </aside>
    </>
  );
}
