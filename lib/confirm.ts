// Diálogo de confirmación imperativo (reemplaza window.confirm).
// Uso: if (await confirm({ title, message })) { ... }
// Un único <ConfirmHost/> montado en el layout escucha y renderiza el modal.
export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "default";
};

export type ConfirmRequest = ConfirmOptions & {
  id: number;
  resolve: (ok: boolean) => void;
};

let _id = 0;
let _handler: ((req: ConfirmRequest) => void) | null = null;

export function _bindConfirmHost(fn: ((req: ConfirmRequest) => void) | null) {
  _handler = fn;
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!_handler) {
      // Fallback si el host aún no montó: no bloquea la app.
      resolve(window.confirm(options.message));
      return;
    }
    _handler({ ...options, id: ++_id, resolve });
  });
}
