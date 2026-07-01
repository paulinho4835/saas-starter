"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import {
  previewProductImport,
  confirmProductImport,
  type ImportRowPreview,
} from "@/app/(dashboard)/productos/import-actions";

type CatalogOption = { id: string; name: string };

export function ImportProductsDialog({ branches }: { branches: CatalogOption[] }) {
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{
    rows: ImportRowPreview[];
    toCreate: number;
    toUpdate: number;
    withErrors: number;
  } | null>(null);
  const router = useRouter();

  function reset() {
    setPreview(null);
    setFile(null);
    setBranchId("");
  }

  async function onPreview() {
    if (!branchId) {
      toast("Selecciona una sucursal.", "error");
      return;
    }
    if (!file) {
      toast("Selecciona un archivo.", "error");
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.set("file", file);
    const res = await previewProductImport(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    setPreview(res);
  }

  async function onConfirm() {
    if (!preview || !file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("branchId", branchId);
      const res = await confirmProductImport(formData);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast(`${res.imported} productos importados.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast("No se pudo completar la importación. Intenta de nuevo.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Importar Excel
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="Importar productos desde Excel"
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <FieldLabel>Sucursal</FieldLabel>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className={fieldInputClass}
              >
                <option value="">Selecciona…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <FieldLabel>Archivo (.xlsx, .csv)</FieldLabel>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={fieldInputClass}
              />
            </label>
          </div>

          {!preview && (
            <Button onClick={onPreview} disabled={loading}>
              {loading ? "Leyendo…" : "Previsualizar"}
            </Button>
          )}

          {preview && (
            <>
              <p className="text-sm text-slate-600">
                {preview.toCreate} nuevos · {preview.toUpdate} a actualizar ·{" "}
                {preview.withErrors} con error
              </p>
              {preview.withErrors > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {preview.rows
                    .filter((r) => r.status === "error")
                    .map((r) => (
                      <p key={r.rowNumber}>
                        Fila {r.rowNumber}: {r.error}
                      </p>
                    ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={reset} disabled={loading}>
                  Volver a elegir archivo
                </Button>
                <Button
                  onClick={onConfirm}
                  disabled={loading || preview.toCreate + preview.toUpdate === 0}
                >
                  {loading
                    ? "Importando…"
                    : `Confirmar (${preview.toCreate + preview.toUpdate})`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
