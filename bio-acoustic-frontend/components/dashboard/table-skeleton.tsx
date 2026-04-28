"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton() {
  return (
    <Card className="glass-effect animate-in-view stagger-5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-5 w-48 mb-2" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/50 overflow-hidden">
          {/* Header row */}
          <div className="flex items-center gap-4 px-4 py-3 bg-muted/30 border-b border-border/30">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40 flex-1" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
          {/* Data rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-4 border-b border-border/20 last:border-0"
            >
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-48 rounded-md flex-1" />
              <Skeleton className="h-7 w-24 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-28 rounded" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
