"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { createOrg } from "@/app/(dashboard)/superadmin/actions";

export function NewOrgForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const res = await createOrg(new FormData(e.currentTarget));
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo crear.", "error");
      return;
    }
    toast("Organización creada. Se envió la invitación al admin.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Nueva organización</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nueva organización"
        subtitle="Se invitará por correo a su primer administrador."
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nombre de la organización" name="orgName" required />
          <Field label="Nombre del administrador" name="adminName" required />
          <Field label="Correo del administrador" name="adminEmail" type="email" required />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creando…" : "Crear e invitar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
