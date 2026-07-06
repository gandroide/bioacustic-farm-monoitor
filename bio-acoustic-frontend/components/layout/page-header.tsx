import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  stagger?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}

export function PageHeader({ title, subtitle, actions, stagger = 1, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between animate-in-view", `stagger-${stagger}`, className)}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
