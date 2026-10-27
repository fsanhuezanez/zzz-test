import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('ninguna fuente real tiene automatización sin permiso documentado', () => {
  for (const s of inputs.sources) {
    assert.notEqual(s.kind, 'fixture', `${s.id}: las fuentes ficticias no pueden estar en data/`);
    if (s.adapter) assert.equal(s.automation.status, 'allowed', `${s.id} tiene adaptador sin permiso`);
  }
  for (const id of ['prydwen', 'mobalytics']) {
    const s = inputs.sources.find((x) => x.id === id)!;
    assert.equal(s.automation.status, 'disallowed');
    assert.deepEqual(s.automation.allowedMethods, ['manual_entry']);
  }
  assert.equal(inputs.sources.find((x) => x.id === 'akademiya')!.automation.status, 'unknown');
});

test('la base publicada en /db es válida e íntegra', async () => {
  const db = await readDatabase(join(ROOT, 'db'));
  if (!db) return; // aún no generada
  assert.deepEqual(checkIntegrity(db), []);
  assert.equal(db.manifest.isFixture, false);
});

test('la base de ejemplo es íntegra y está marcada como ficticia', async () => {
  const db = await readDatabase(join(ROOT, 'examples/fixture-db'));
  if (!db) return;
  assert.deepEqual(checkIntegrity(db), []);
  assert.equal(db.manifest.isFixture, true);
});
