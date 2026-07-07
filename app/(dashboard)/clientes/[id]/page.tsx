import { notFound } from "next/navigation";
import { User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireNavAccess } from "@/lib/guard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScrollHint } from "@/components/ui/ScrollHint";
import { SALE_TYPE_LABEL, type SaleType } from "@/lib/saleType";

type Customer = {
  id: string;
  full_name: string;
  nit: string | null;
  email: string | null;
  phone: string | null;
};

type HistoryRow = {
  quantity: number;
  unit_price_bs: number;
  subtotal_bs: number;
  products: {
    code: string;
    application: string | null;
    internal_mm: number | null;
    external_mm: number | null;
    height_mm: number | null;
    flange_mm: number | null;
    stop_mm: number | null;
  } | null;
  sales: { created_at: string; sale_type: string } | null;
};

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-BO", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireNavAccess("clientes");
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, nit, email, phone")
    .eq("id", id)
    .maybeSingle();
  if (!customer) notFound();

  const { data: historyData } = await supabase
    .from("sale_items")
    .select(
      "quantity, unit_price_bs, subtotal_bs, products(code, application, internal_mm, external_mm, height_mm, flange_mm, stop_mm), sales!inner(created_at, sale_type, customer_id)",
    )
    .eq("sales.customer_id", id)
    .order("sales(created_at)", { ascending: false });
  const history = (historyData ?? []) as unknown as HistoryRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={(customer as Customer).full_name}
        subtitle={[
          (customer as Customer).nit ? `NIT: ${(customer as Customer).nit}` : null,
          (customer as Customer).phone,
          (customer as Customer).email,
        ]
          .filter(Boolean)
          .join(" · ") || undefined}
      />

      <Card>
        {history.length === 0 ? (
          <EmptyState
            icon={<User className="h-6 w-6" />}
            title="Sin compras registradas"
            description="Este cliente todavía no tiene ventas asociadas."
          />
        ) : (
          <>
            <ScrollHint />
            <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Aplicación</th>
                  <th className="px-3 py-2">MI</th>
                  <th className="px-3 py-2">ME</th>
                  <th className="px-3 py-2">ALT</th>
                  <th className="px-3 py-2">PEST</th>
                  <th className="px-3 py-2">TOPE</th>
                  <th className="px-3 py-2">Cant.</th>
                  <th className="px-3 py-2">Precio (Bs)</th>
                  <th className="px-3 py-2">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      {row.sales ? formatDate(row.sales.created_at) : "—"}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {row.products?.code ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{row.products?.application ?? "—"}</td>
                    <td className="px-3 py-2">{formatMm(row.products?.internal_mm ?? null)}</td>
                    <td className="px-3 py-2">{formatMm(row.products?.external_mm ?? null)}</td>
                    <td className="px-3 py-2">{formatMm(row.products?.height_mm ?? null)}</td>
                    <td className="px-3 py-2">{formatMm(row.products?.flange_mm ?? null)}</td>
                    <td className="px-3 py-2">{formatMm(row.products?.stop_mm ?? null)}</td>
                    <td className="px-3 py-2">{row.quantity}</td>
                    <td className="px-3 py-2">{row.unit_price_bs}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {row.sales ? SALE_TYPE_LABEL[row.sales.sale_type as SaleType] : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
