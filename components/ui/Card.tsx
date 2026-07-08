import { cn } from "@/lib/cn";

// Contenedor blanco estándar (panel/tarjeta) usado en toda la app.
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Radio y sombra calcados del legacy: .card { border-radius: 4px;
        // box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 0 0 1px rgba(63,63,68,.1); }
        "rounded-[4px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(63,63,68,0.1)]",
        className,
      )}
      {...props}
    />
  );
}
