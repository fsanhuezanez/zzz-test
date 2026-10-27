import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runUpdate, type UpdateOptions } from '../src/pipeline.ts';

export const ROOT = resolve(import.meta.dirname, '..');
export const FIXTURE_DATA = join(ROOT, 'test/fixtures/data');
export const NOW = new Date('2026-10-27T12:00:00Z');

/** Copia el fixture a un directorio temporal para poder mutarlo. */
export interface Box { dir: string; data: string; out: string; reports: string; exportDir: string }

export async function sandbox(): Promise<Box> {
  const dir = await mkdtemp(join(tmpdir(), 'zzz-meta-'));
  const data = join(dir, 'data');
  await cp(FIXTURE_DATA, data, { recursive: true });
  return { dir, data, out: join(dir, 'db'), reports: join(dir, 'reports'), exportDir: join(dir, 'export') };
}

export function update(box: Box, extra: Partial<UpdateOptions> = {}) {
  return runUpdate({
    dataDir: box.data, outDir: box.out, reportsDir: box.reports, schemasDir: join(ROOT, 'schemas'), exportDir: box.exportDir,
    patch: '3.3', now: NOW, allowFixtures: true, ...extra,
  });
}

export async function readJson<T = any>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** Envío mínimo válido para la fuente ficticia A. */
export function submission(overrides: Record<string, unknown> = {}, claims: unknown[] = []) {
  return {
    sourceId: 'example-guide-a',
    url: 'https://guide-a.example.com/zzz/x',
    accessedAt: '2026-10-25',
    declaredPatch: '3.3',
    collectedBy: 'test',
    evidenceType: 'explicit_recommendation',
    confidence: 'high',
    verification: { state: 'unverified' },
    claims: claims.length ? claims : [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T0' }],
    ...overrides,
  };
}
