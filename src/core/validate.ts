/**
 * Validación con Ajv. Se compila una vez por esquema y se devuelven errores
 * legibles con la ruta JSON del problema.
 */
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { Static, TSchema } from '@sinclair/typebox';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function createAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, discriminator: true, allowUnionTypes: true });
  ajv.addFormat('date', isValidDate);
  ajv.addFormat('date-time', (v: string) => DATE_TIME_RE.test(v) && !Number.isNaN(Date.parse(v)));
  ajv.addFormat('uri', (v: string) => URL.canParse(v));
  return ajv;
}

const ajv = createAjv();
const cache = new WeakMap<TSchema, ValidateFunction>();

export interface ValidationIssue {
  path: string;
  message: string;
}

export class SchemaValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(label: string, issues: ValidationIssue[]) {
    super(`${label}: ${issues.length} error(es) de esquema\n` + issues.map((i) => `  - ${i.path || '/'}: ${i.message}`).join('\n'));
    this.issues = issues;
  }
}

function formatErrors(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  const issues = (errors ?? [])
    // Los errores de "if" son ruido: el error útil es el del "then".
    .filter((e) => e.keyword !== 'if')
    .map((e) => {
      let message = e.message ?? 'inválido';
      if (e.keyword === 'additionalProperties') message = `propiedad no permitida "${String(e.params.additionalProperty)}"`;
      if (e.keyword === 'enum') message += `: ${JSON.stringify(e.params.allowedValues)}`;
      return { path: e.instancePath, message };
    });
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.path}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compile(schema: TSchema): ValidateFunction {
  let fn = cache.get(schema);
  if (!fn) {
    fn = ajv.compile(schema);
    cache.set(schema, fn);
  }
  return fn;
}

export function check<T extends TSchema>(schema: T, value: unknown): { ok: true; value: Static<T> } | { ok: false; issues: ValidationIssue[] } {
  const fn = compile(schema);
  if (fn(value)) return { ok: true, value: value as Static<T> };
  return { ok: false, issues: formatErrors(fn.errors) };
}

export function assertValid<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  const result = check(schema, value);
  if (!result.ok) throw new SchemaValidationError(label, result.issues);
  return result.value;
}
