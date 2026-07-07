"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { updateExchangeRate } from "@/app/(dashboard)/ajustes/actions";

export function ExchangeRateForm({ exchangeRate }: { exchangeRate: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const res = await updateExchangeRate(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar el tipo de cambio.", "error");
      return;
    }
    toast("Tipo de cambio actualizado. Los precios de todos los productos se recalcularon.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-3">
      <Field
        label="Tipo de cambio (Bs por $)"
        name="exchangeRate"
        type="number"
        step="0.01"
        min={0.01}
        required
        defaultValue={exchangeRate}
        className="w-48"
      />
      <Button type="submit" disabled={loading}>
        {loading ? "Guardando…" : "Guardar y recalcular precios"}
      </Button>
    </form>
  );
}
