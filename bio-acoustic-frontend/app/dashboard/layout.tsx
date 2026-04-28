import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell requiredRole="farm_admin">{children}</AppShell>;
}
