"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { createCustomer } from "@/app/(dashboard)/clientes/actions";

// Modal de alta de cliente. Plantilla para los formularios de tu dominio:
// estado local → server action → toast + refresh.
export function NewCustomerForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const res = await createCustomer(new FormData(e.currentTarget));
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear el cliente.", "error");
      return;
    }
    toast("Cliente creado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Nuevo cliente</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo cliente">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nombre completo" name="full_name" required />
          <Field label="Correo" name="email" type="email" />
          <Field label="Teléfono" name="phone" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
