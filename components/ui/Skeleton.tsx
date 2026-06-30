import { cn } from "@/lib/cn";

// Bloque gris con pulso, para estados de carga (loading.tsx).
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-slate-200", className)}
      {...props}
    />
  );
}
