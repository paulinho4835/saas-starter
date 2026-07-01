"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { createSupplier } from "@/app/(dashboard)/proveedores/actions";

export function NewSupplierForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const res = await createSupplier(new FormData(e.currentTarget));
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear el proveedor.", "error");
      return;
    }
    toast("Proveedor creado.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Nuevo proveedor</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo proveedor">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nombre" name="name" required />
          <Field label="Teléfono" name="phone" />
          <Field label="Persona de contacto" name="contact_name" />
          <Field label="Notas" name="notes" />
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
