import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EditorialSubmission } from '../src/schema/claims.ts';
import { Provenance } from '../src/schema/common.ts';
import { PUBLISHED_SCHEMAS } from '../src/schema/index.ts';
import { check } from '../src/core/validate.ts';
import { prettyJson } from '../src/core/canonical.ts';
import { ROOT, readJson, submission } from './helpers.ts';

const baseProvenance = {
  sourceId: 'x', url: 'https://x.example.com/', accessedAt: '2026-10-01', declaredPatch: '3.3',
  evidenceType: 'explicit_recommendation', confidence: 'high', collectionMethod: 'manual_entry',
  verification: { state: 'unverified' },
};

test('un envío mínimo es válido', () => {
  assert.equal(check(EditorialSubmission, submission()).ok, true);
});

test('rechaza propiedades desconocidas, fechas imposibles y kinds inexistentes', () => {
  const r = check(EditorialSubmission, submission({ accessedAt: '2026-02-30' }, [{ kind: 'tier', agent: 'a', role: 'attack', tier: 'T0', extra: 1 }, { kind: 'nope' }]));
  assert.equal(r.ok, false);
  if (r.ok) return;
  const text = r.issues.map((i) => `${i.path} ${i.message}`).join('\n');
  assert.match(text, /\/accessedAt/);
  assert.match(text, /propiedad no permitida "extra"/);
  assert.match(text, /\/claims\/1/);
});

test('"verified" exige revisor y fecha', () => {
  assert.equal(check(EditorialSubmission, submission({ verification: { state: 'verified' } })).ok, false);
  assert.equal(check(EditorialSubmission, submission({ verification: { state: 'verified', reviewedBy: 'b', reviewedAt: '2026-10-26' } })).ok, true);
});

test('las citas largas se rechazan (no copiar artículos)', () => {
  const r = check(EditorialSubmission, submission({}, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T0', evidence: { excerpt: 'x'.repeat(201) } }]));
  assert.equal(r.ok, false);
});

test('procedencia: estimación interna requiere rationale y no admite confianza alta', () => {
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'internal_estimate', confidence: 'medium' }).ok, false);
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'internal_estimate', confidence: 'high', rationale: 'r' }).ok, false);
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'internal_estimate', confidence: 'low', rationale: 'r' }).ok, true);
});

test('procedencia: observed_data requiere muestra; consenso requiere derivedFrom y método derived', () => {
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'observed_data' }).ok, false);
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'observed_data', sample: { description: 'd' } }).ok, true);
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'cross_source_consensus', derivedFrom: ['a', 'b'] }).ok, false);
  assert.equal(check(Provenance, { ...baseProvenance, evidenceType: 'cross_source_consensus', collectionMethod: 'derived', derivedFrom: ['a', 'b'] }).ok, true);
});

test('los esquemas publicados en /schemas están al día con src/schema', async () => {
  const files = (await readdir(join(ROOT, 'schemas'))).sort();
  assert.deepEqual(files, Object.keys(PUBLISHED_SCHEMAS).sort());
  for (const [name, schema] of Object.entries(PUBLISHED_SCHEMAS)) {
    const expected = JSON.parse(prettyJson({ $schema: 'http://json-schema.org/draft-07/schema#', ...schema, $id: name }));
    assert.deepEqual(await readJson(join(ROOT, 'schemas', name)), expected, `${name} desactualizado: ejecuta npm run schemas`);
  }
});
