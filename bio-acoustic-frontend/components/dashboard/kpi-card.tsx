import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type KPITone = "primary" | "emerald" | "red" | "amber" | "muted"

interface KPICardProps {
  title: string
  icon: ReactNode
  value: string | number
  subtitle?: string
  footer?: ReactNode
  tone?: KPITone
  stagger?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}

const TONE_STYLES: Record<KPITone, { iconBg: string; valueText: string }> = {
  primary: { iconBg: "bg-primary/10", valueText: "text-primary" },
  emerald: { iconBg: "bg-emerald-500/10", valueText: "text-emerald-500" },
  red: { iconBg: "bg-red-500/10", valueText: "text-red-500" },
  amber: { iconBg: "bg-amber-500/10", valueText: "text-amber-500" },
  muted: { iconBg: "bg-muted/30", valueText: "text-foreground" },
}

export function KPICard({
  title,
  icon,
  value,
  subtitle,
  footer,
  tone = "primary",
  stagger,
  className,
}: KPICardProps) {
  const styles = TONE_STYLES[tone]
  return (
    <Card
      className={cn(
        "glass-effect card-hover animate-in-view",
        stagger && `stagger-${stagger}`,
        className
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", styles.iconBg)}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold tracking-tight", styles.valueText)}>{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        {footer && <div className="mt-3">{footer}</div>}
      </CardContent>
    </Card>
  )
}
