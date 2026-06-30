// Validación y saneamiento centralizado de variables de entorno.
//
// Por qué existe: la clase de bug más cara en un SaaS suele ser la misma —
// env vars que fallan en silencio (un BOM invisible al copiar/pegar, un secreto
// faltante que deja un cron devolviendo 401 sin que nadie se entere). Este módulo
// arranca gritando (claro y temprano) en vez de fallar callado.
//
// Es PURO y agnóstico del framework para poder moverse tal cual entre proyectos.
// La parte que corta el arranque vive en instrumentation.ts.

// Caracteres invisibles que se cuelan al copiar valores de paneles web:
// U+200B..U+200D = espacios de ancho cero; U+FEFF = BOM. Se construye desde
// códigos de carácter a propósito: incrustar el caracter literal en el regex
// sería justo el tipo de fragilidad que este módulo busca eliminar.
const ZERO_WIDTH = new RegExp(
  "[" + String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff) + "]",
  "g",
);

/**
 * Limpia un valor de entorno: quita BOM y caracteres invisibles de ancho cero,
 * recorta espacios, y trata "" como ausente.
 */
export function sanitizeEnvValue(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(ZERO_WIDTH, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

const s = sanitizeEnvValue;

// Lectura EXPLÍCITA variable por variable: es lo que permite a Next inyectar las
// NEXT_PUBLIC_* en el bundle durante el build (un process.env genérico no se
// reemplaza). Acepta una fuente para poder testear sin tocar el entorno real.
export function readEnv(src: Record<string, string | undefined> = process.env) {
  return {
    // Públicas (visibles en el cliente, inyectadas en build).
    NEXT_PUBLIC_SUPABASE_URL: s(src.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: s(src.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    NEXT_PUBLIC_SITE_URL: s(src.NEXT_PUBLIC_SITE_URL),
    // Servidor (secretos; nunca llegan al cliente).
    SUPABASE_SERVICE_ROLE_KEY: s(src.SUPABASE_SERVICE_ROLE_KEY),
    CRON_SECRET: s(src.CRON_SECRET),
    R2_ACCOUNT_ID: s(src.R2_ACCOUNT_ID),
    R2_ACCESS_KEY_ID: s(src.R2_ACCESS_KEY_ID),
    R2_SECRET_ACCESS_KEY: s(src.R2_SECRET_ACCESS_KEY),
    R2_BUCKET: s(src.R2_BUCKET),
    UPSTASH_REDIS_REST_URL: s(src.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: s(src.UPSTASH_REDIS_REST_TOKEN),
  };
}

export type Env = ReturnType<typeof readEnv>;

/** Acceso saneado a las variables. Importar solo desde código de servidor. */
export const env = readEnv();

// Sin estas la app no arranca de verdad → error que corta el deploy.
const HARD_REQUIRED: (keyof Env)[] = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

// Features que se activan por grupo de variables. Tener algunas pero no todas es
// casi siempre un error de configuración (típico al copiar el proyecto a otro).
const FEATURE_GROUPS: Record<string, (keyof Env)[]> = {
  "Cloudflare R2 (archivos/respaldos)": [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ],
  "Rate limiting (Upstash)": [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ],
};

export interface EnvCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Valida el entorno. PURA: devuelve errores y advertencias, no lanza ni imprime.
 * El que la llama decide qué hacer (instrumentation.ts corta el arranque ante
 * errores y reporta las advertencias).
 */
export function validateEnv(
  src: Record<string, string | undefined> = process.env,
): EnvCheck {
  const e = readEnv(src);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of HARD_REQUIRED) {
    if (!e[key]) errors.push(`Falta la variable obligatoria ${key}.`);
  }

  if (e.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      new URL(e.NEXT_PUBLIC_SUPABASE_URL);
    } catch {
      errors.push(
        `NEXT_PUBLIC_SUPABASE_URL no es una URL válida: "${e.NEXT_PUBLIC_SUPABASE_URL}".`,
      );
    }
  }

  if (!e.CRON_SECRET) {
    warnings.push(
      "CRON_SECRET no está definida: los cron jobs de Vercel devolverán 401 y no se ejecutarán.",
    );
  }

  for (const [name, keys] of Object.entries(FEATURE_GROUPS)) {
    const present = keys.filter((k) => e[k]);
    if (present.length > 0 && present.length < keys.length) {
      const missing = keys.filter((k) => !e[k]);
      warnings.push(
        `Configuración incompleta de ${name}: faltan ${missing.join(", ")}.`,
      );
    }
  }

  return { errors, warnings };
}
