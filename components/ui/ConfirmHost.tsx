"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { _bindConfirmHost, type ConfirmRequest } from "@/lib/confirm";

// Renderiza el modal de confirmación pedido vía confirm(). Montar una vez en el
// layout. Resuelve la promesa con true/false según la elección del usuario.
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    _bindConfirmHost((r) => setReq(r));
    return () => _bindConfirmHost(null);
  }, []);

  function close(ok: boolean) {
    if (!req) return;
    req.resolve(ok);
    setReq(null);
  }

  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      title={req?.title ?? "Confirmar"}
      size="sm"
    >
      <p className="text-sm text-slate-600">{req?.message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => close(false)}>
          {req?.cancelText ?? "Cancelar"}
        </Button>
        <Button
          variant={req?.tone === "danger" ? "danger" : "primary"}
          onClick={() => close(true)}
        >
          {req?.confirmText ?? "Confirmar"}
        </Button>
      </div>
    </Modal>
  );
}
