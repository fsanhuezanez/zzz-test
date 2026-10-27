/**
 * Serialización canónica: claves ordenadas, sin espacios variables. Permite
 * hashes estables y diffs limpios en git.
 */
import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** JSON legible y determinista para escribir en disco. */
export function prettyJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2) + '\n';
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function shortHash(value: unknown): string {
  return sha256(canonicalJson(value)).slice(0, 12);
}
