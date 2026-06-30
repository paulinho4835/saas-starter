// Helpers de formato y presentación, agnósticos del dominio.

/** Iniciales (máx. 2) a partir de un nombre completo, para avatares. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Normaliza texto para búsquedas: minúsculas y sin acentos. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Tamaño legible (B, KB, MB, GB) a partir de bytes. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Fecha ISO (YYYY-MM-DD) en una zona horaria dada (default del runtime). */
export function todayISO(timeZone?: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}
