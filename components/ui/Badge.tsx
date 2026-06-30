import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
  {
    variants: {
      tone: {
        neutral: "bg-slate-100 text-slate-600 ring-slate-200",
        success: "bg-emerald-100 text-emerald-700 ring-emerald-200",
        danger: "bg-red-100 text-red-700 ring-red-200",
        warning: "bg-amber-100 text-amber-700 ring-amber-200",
        brand: "bg-brand/10 text-brand ring-brand/20",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  tone,
  className,
  ...props
}: VariantProps<typeof badgeVariants> & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
