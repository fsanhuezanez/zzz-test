import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CatalogIndex } from '../src/core/catalog.ts';
import { checkIntegrity } from '../src/core/integrity.ts';
import { readDatabase } from '../src/core/store.ts';
import { loadInputs } from '../src/pipeline.ts';
import { ROOT } from './helpers.ts';

const inputs = await loadInputs(join(ROOT, 'data'));

test('los datos reales cargan y el catálogo es coherente', () => {
  assert.ok(new CatalogIndex(inputs.catalog));
  assert.ok(inputs.catalog.agents.length > 0);
});

test('fuentes reales: sin fixtures, y Prydwen/Mobalytics marcadas como no automatizables', () => {
  for (const s of inputs.sources) assert.notEqual(s.kind, 'fixture', `${s.id}: las fuentes ficticias no pueden estar en data/`);
  for (const id of ['prydwen', 'mobalytics']) assert.equal(inputs.sources.find((x) => x.id === id)!.automation.status, 'disallowed');
  assert.equal(inputs.sources.find((x) => x.id === 'akademiya')!.automation.status, 'unknown');
});

test('las pistas de buscador están separadas en leads/ y nunca verificadas', async () => {
  const { scanEditorial } = await import('../src/collectors/manual.ts');
  const scan = await scanEditorial(join(ROOT, 'data/editorial'), join(ROOT, 'data'));
  for (const { origin, data } of scan.submissions) {
    const sub = data as { collectionMethod?: string; verification: { state: string } };
    if (sub.collectionMethod === 'web_search') {
      assert.match(origin, /\/leads\//, `${origin}: los datos de buscador van en leads/`);
      assert.equal(sub.verification.state, 'unverified');
    }
    if (origin.includes('/leads/')) assert.equal(sub.collectionMethod, 'web_search', `${origin}: leads/ solo contiene datos de buscador`);
  }
});

test('la base publicada en /db es válida e íntegra', async () => {
  const db = await readDatabase(join(ROOT, 'db'));
  if (!db) return; // aún no generada
  assert.deepEqual(checkIntegrity(db), []);
  assert.equal(db.manifest.isFixture, false);
  const bundle = JSON.parse(await readFile(join(ROOT, 'export/zzz-meta.json'), 'utf8'));
  assert.equal(bundle.meta.dataVersion, db.manifest.dataVersion, 'export/ desactualizado: npm run export');
  assert.equal(await readFile(join(ROOT, 'export/zzz-meta.types.ts'), 'utf8'), await readFile(join(ROOT, 'src/export/types.ts'), 'utf8'));
});

test('la base de ejemplo es íntegra y está marcada como ficticia', async () => {
  const db = await readDatabase(join(ROOT, 'examples/fixture-db'));
  if (!db) return;
  assert.deepEqual(checkIntegrity(db), []);
  assert.equal(db.manifest.isFixture, true);
});
