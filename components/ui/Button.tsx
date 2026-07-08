import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import { cn } from "@/lib/cn";

// Botón unificado de la app. Centraliza colores, tamaños, focus-ring y estados
// disabled para que todo se vea y se comporte igual.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-fg",
        secondary:
          "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        // .btn-danger del legacy (Bootstrap 3): rojo sólido, sin borde.
        danger: "bg-[#d9534f] text-white hover:bg-[#c9302c]",
        ghost: "text-slate-600 hover:bg-slate-100",
        dark: "bg-night text-white hover:bg-night-soft",
      },
      size: {
        sm: "px-3 py-1.5 text-xs",
        md: "px-4 py-2 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonBaseProps = VariantProps<typeof buttonVariants> & {
  className?: string;
};

// Como <button>
export function Button({
  variant,
  size,
  className,
  ...props
}: ButtonBaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

// Como <Link> (next/link) con la misma apariencia.
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ButtonBaseProps & React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
