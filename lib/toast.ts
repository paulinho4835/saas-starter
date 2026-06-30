// Store de toasts basado en eventos (sin necesidad de React context).
export type ToastItem = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
};

let _id = 0;
const _subs: Array<(t: ToastItem) => void> = [];

export function toast(message: string, type: ToastItem["type"] = "success") {
  const item: ToastItem = { id: ++_id, message, type };
  _subs.forEach((fn) => fn(item));
}

export function _subscribe(fn: (t: ToastItem) => void) {
  _subs.push(fn);
  return () => {
    const i = _subs.indexOf(fn);
    if (i !== -1) _subs.splice(i, 1);
  };
}
