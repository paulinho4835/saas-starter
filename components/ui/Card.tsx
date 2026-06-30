import { cn } from "@/lib/cn";

// Contenedor blanco estándar (panel/tarjeta) usado en toda la app.
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg bg-white shadow-sm ring-1 ring-slate-200",
        className,
      )}
      {...props}
    />
  );
}
