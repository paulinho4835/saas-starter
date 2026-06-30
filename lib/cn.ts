import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Une clases condicionales (clsx) y resuelve conflictos de Tailwind (twMerge).
// Permite sobreescribir estilos de los primitivos vía la prop `className`.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
