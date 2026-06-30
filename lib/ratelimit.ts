// Rate limiting centralizado (Upstash Redis), reutilizable en API routes y
// server actions. Un solo origen de verdad para las reglas por "bucket".
//
// Diseño:
//   - DEGRADA con gracia: si UPSTASH_* no está configurado (local/dev) o si Redis
//     no responde, NO bloquea — devuelve { ok: true }. Nunca debe tumbar la app
//     por un problema de infraestructura del limitador.
//   - Las instancias de Ratelimit se cachean por bucket (evita reconstruir el
//     cliente Redis en cada request en el mismo proceso/lambda caliente).
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Cada bucket tiene su propia ventana y prefijo de claves en Redis.
export type RateLimitBucket =
  | "login" // intentos de inicio de sesión
  | "public-form" // formularios públicos por token (sin sesión)
  | "api"; // API genérica

interface Rule {
  limit: number;
  window: Duration;
}

const RULES: Record<RateLimitBucket, Rule> = {
  login: { limit: 5, window: "2 m" },
  "public-form": { limit: 10, window: "10 m" },
  api: { limit: 60, window: "1 m" },
};

const limiters = new Map<RateLimitBucket, Ratelimit>();

function getLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // sin Upstash → no-op (no bloquea)

  const cached = limiters.get(bucket);
  if (cached) return cached;

  const rule = RULES[bucket];
  const rl = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(rule.limit, rule.window),
    prefix: `rl:${bucket}`,
  });
  limiters.set(bucket, rl);
  return rl;
}

export interface RateLimitResult {
  /** true si la petición está permitida (incluye el caso "limitador apagado"). */
  ok: boolean;
  /** Segundos hasta que la ventana se reinicia (0 si no aplica). */
  retryAfterSeconds: number;
}

/**
 * Verifica el rate limit de un identificador (normalmente la IP) en un bucket.
 * Nunca lanza: ante cualquier fallo del limitador, permite la petición.
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<RateLimitResult> {
  const rl = getLimiter(bucket);
  if (!rl) return { ok: true, retryAfterSeconds: 0 };

  try {
    const { success, reset } = await rl.limit(identifier);
    return {
      ok: success,
      retryAfterSeconds: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
    };
  } catch {
    // Redis caído / red intermitente: no bloquear al usuario por eso.
    return { ok: true, retryAfterSeconds: 0 };
  }
}

/**
 * Extrae la IP del cliente de las cabeceras (Vercel/proxy ponen x-forwarded-for).
 * Sirve tanto con `req.headers` (API routes) como con `headers()` (server actions).
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Mensaje en español neutro para un 429 según los segundos restantes. */
export function tooManyRequestsMessage(retryAfterSeconds: number): string {
  const mins = Math.ceil(retryAfterSeconds / 60);
  if (mins <= 1)
    return "Demasiadas solicitudes. Espera un momento antes de volver a intentarlo.";
  return `Demasiadas solicitudes. Espera ${mins} minutos antes de volver a intentarlo.`;
}
