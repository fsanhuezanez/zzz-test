import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogIndex } from '../src/core/catalog.ts';
import { applyLifecycle, patchAtDate } from '../src/core/lifecycle.ts';
import { normalizeSubmission } from '../src/core/normalize.ts';
import { EditorialSubmission } from '../src/schema/claims.ts';
import { assertValid } from '../src/core/validate.ts';
import { loadInputs } from '../src/pipeline.ts';
import { FIXTURE_DATA, NOW, submission } from './helpers.ts';

const inputs = await loadInputs(FIXTURE_DATA);
const catalog = new CatalogIndex(inputs.catalog);
const sources = new Map(inputs.sources.map((s) => [s.id, s]));
const drafts = (sub: Record<string, unknown>) =>
  normalizeSubmission(assertValid(EditorialSubmission, sub, 't'), { catalog, sources, method: 'manual_entry', origin: 't' }).drafts;
const lifecycle = (d: ReturnType<typeof drafts>, now = NOW) =>
  applyLifecycle(d, { currentPatch: '3.3', now, sources, calendar: inputs.calendar, catalog, previousFirstSeen: new Map() });

test('patchAtDate usa el calendario', () => {
  assert.equal(patchAtDate(inputs.calendar, '2026-10-20'), '3.2');
  assert.equal(patchAtDate(inputs.calendar, '2026-10-21'), '3.3');
  assert.equal(patchAtDate(inputs.calendar, '2020-01-01'), null);
});

test('dedupe: el mismo dato consultado dos veces se guarda una vez con la consulta más reciente', () => {
  const out = lifecycle([...drafts(submission({ accessedAt: '2026-10-22' })), ...drafts(submission({ accessedAt: '2026-10-25' }))]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.provenance.accessedAt, '2026-10-25');
  assert.equal(out[0]!.status, 'current');
});

test('un parche más nuevo de la misma fuente reemplaza (superseded) al anterior', () => {
  const old = drafts(submission({ declaredPatch: '3.2', accessedAt: '2026-09-20' }, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T1' }]));
  const fresh = drafts(submission());
  const out = lifecycle([...old, ...fresh]);
  const superseded = out.find((c) => c.status === 'superseded')!;
  const current = out.find((c) => c.status === 'current')!;
  assert.equal(superseded.provenance.declaredPatch, '3.2');
  assert.equal(superseded.supersededBy, current.id);
});

test('misma fuente y parche: la corrección más reciente gana', () => {
  const a = drafts(submission({ accessedAt: '2026-10-22' }, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T1' }]));
  const b = drafts(submission({ accessedAt: '2026-10-25' }));
  const out = lifecycle([...a, ...b]);
  assert.equal(out.find((c) => c.status === 'current')!.provenance.accessedAt, '2026-10-25');
});

test('stale: parche anterior o consulta demasiado antigua', () => {
  const older = lifecycle(drafts(submission({ declaredPatch: '3.2', accessedAt: '2026-10-22' })));
  assert.equal(older[0]!.status, 'stale');
  assert.ok(older[0]!.flags.includes('older_patch'));
  const aged = lifecycle(drafts(submission({ accessedAt: '2026-10-22' })), new Date('2027-01-15T00:00:00Z'));
  assert.equal(aged[0]!.status, 'stale');
  assert.ok(aged[0]!.flags.includes('access_too_old'));
});

test('flags de revisión: sin verificar, sin parche, previo al lanzamiento', () => {
  const undeclared = lifecycle(drafts(submission({ declaredPatch: null, accessedAt: '2026-10-22' })));
  assert.ok(undeclared[0]!.flags.includes('patch_undeclared'));
  assert.ok(undeclared[0]!.flags.includes('unverified'));
  assert.equal(undeclared[0]!.status, 'current', 'sin parche, pero consultado durante 3.3 según el calendario');
  const undeclaredOld = lifecycle(drafts(submission({ declaredPatch: null, accessedAt: '2026-10-01' })));
  assert.equal(undeclaredOld[0]!.status, 'stale');
  const preview = lifecycle(drafts(submission({ accessedAt: '2026-10-10' })));
  assert.ok(preview[0]!.flags.includes('pre_release'));
});

test('retracted: una fuente que retira un dato lo marca como retirado', () => {
  const out = lifecycle([
    ...drafts(submission({ accessedAt: '2026-10-22' })),
    ...drafts(submission({ accessedAt: '2026-10-26' }, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T0', retracted: true }])),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.status, 'retracted');
});
