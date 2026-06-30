import { cn } from "@/lib/cn";

// Clases base compartidas para inputs/selects/textarea. Antes estaban repetidas
// en cada formulario; ahora viven en un solo lugar. El `text-slate-900 bg-white`
// explícito evita texto invisible en modo oscuro (los controles nativos no heredan
// el color por defecto del tema).
export const fieldInputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("mb-1 block text-slate-600", className)}>{children}</span>
  );
}

// Campo de texto/numérico/fecha con etiqueta. Cubre el caso más común.
export function Field({
  label,
  className,
  inputClassName,
  invalid,
  ...props
}: {
  label: string;
  inputClassName?: string;
  invalid?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("block text-sm", className)}>
      <FieldLabel>{label}</FieldLabel>
      <input
        className={cn(
          fieldInputClass,
          invalid && "border-red-400 focus:border-red-500 focus:ring-red-500",
          inputClassName,
        )}
        {...props}
      />
    </label>
  );
}
