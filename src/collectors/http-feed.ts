/**
 * Recolector automatizado para fuentes que lo AUTORIZAN (API pública con
 * licencia, feed publicado por la propia fuente o permiso por escrito).
 *
 * Garantías: puerta de políticas, robots.txt obligatorio, user-agent
 * identificable, pausa mínima entre peticiones y timeout. Cualquier fallo
 * devuelve `failure` y el pipeline conserva los datos anteriores de la fuente.
 * No ejecuta JavaScript, no usa cabeceras de navegador ni rota IPs: si la
 * fuente bloquea, se respeta el bloqueo.
 */
import type { Source } from '../schema/sources.ts';
import { automationDecision } from './policy.ts';
import { isPathAllowed } from './robots.ts';
import type { CollectorResult, FetchLike } from './types.ts';

export const USER_AGENT = 'zzz-meta-knowledge/0.1 (+https://github.com/fsanhuezanez/zzz-test)';
const PRODUCT_TOKEN = 'zzz-meta-knowledge';

export interface HttpFeedOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function collectHttpFeed(source: Source, options: HttpFeedOptions = {}): Promise<CollectorResult> {
  const adapter = source.adapter;
  const result: CollectorResult = { sourceId: source.id, submissions: [] };
  if (!adapter) return result;

  const decision = automationDecision(source, adapter.method);
  if (!decision.allowed) return { ...result, failure: `bloqueado por política: ${decision.reason}` };

  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? defaultSleep;
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
  const feedUrl = new URL(adapter.url);

  try {
    const robotsUrl = new URL('/robots.txt', feedUrl.origin).toString();
    const robots = await doFetch(robotsUrl, { headers, signal: AbortSignal.timeout(adapter.timeoutMs) });
    if (robots.status >= 400 && robots.status < 500 && robots.status !== 401 && robots.status !== 403) {
      // Sin robots.txt (404/410…): permitido según RFC 9309.
    } else if (!robots.ok) {
      return { ...result, failure: `robots.txt respondió ${robots.status}; por prudencia no se accede` };
    } else if (!isPathAllowed(await robots.text(), PRODUCT_TOKEN, feedUrl.pathname + feedUrl.search)) {
      return { ...result, failure: `robots.txt prohíbe ${feedUrl.pathname} para ${PRODUCT_TOKEN}` };
    }

    await sleep(adapter.minIntervalMs);
    const res = await doFetch(feedUrl.toString(), { headers, signal: AbortSignal.timeout(adapter.timeoutMs) });
    if (!res.ok) return { ...result, failure: `el feed respondió HTTP ${res.status}` };
    const body = JSON.parse(await res.text()) as unknown;
    const list = Array.isArray((body as { submissions?: unknown[] })?.submissions)
      ? (body as { submissions: unknown[] }).submissions
      : [body];
    result.submissions = list.map((data, i) => ({ origin: `${adapter.url}#${i}`, method: adapter.method, data }));
    return result;
  } catch (err) {
    return { ...result, failure: `error de red o formato: ${(err as Error).message}` };
  }
}
