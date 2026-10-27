import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogIndex, nameKey } from '../src/core/catalog.ts';
import { Vocabulary } from '../src/core/vocabulary.ts';
import { normalizeSubmission } from '../src/core/normalize.ts';
import { EditorialSubmission } from '../src/schema/claims.ts';
import { assertValid } from '../src/core/validate.ts';
import { loadInputs } from '../src/pipeline.ts';
import { FIXTURE_DATA, submission } from './helpers.ts';

const inputs = await loadInputs(FIXTURE_DATA);
const catalog = new CatalogIndex(inputs.catalog);
const sources = new Map(inputs.sources.map((s) => [s.id, s]));
const vocabulary = new Vocabulary(inputs.vocabulary);

function run(sub: Record<string, unknown>) {
  return normalizeSubmission(assertValid(EditorialSubmission, sub, 'test'), { catalog, sources, vocabulary, origin: 'test.json' });
}

test('resuelve nombres y alias a ids canónicos', () => {
  assert.equal(nameKey('Von Lycaon'), 'vonlycaon');
  assert.equal(catalog.resolve('agent', 'Von Lycaon'), 'lycaon');
  assert.equal(catalog.resolve('agent', 'astra'), 'astra-yao');
  assert.equal(catalog.resolve('wEngine', 'deep sea visitor'), 'deep-sea-visitor');
});

test('agente desconocido → error con sugerencia', () => {
  const { issues } = run(submission({}, [{ kind: 'tier', agent: 'Elen', role: 'attack', tier: 'T0' }]));
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /desconocido "Elen".*Ellen Joe/);
});

test('tier: normaliza etiqueta con la escala y rechaza etiquetas fuera de escala', () => {
  const ok = run(submission({}, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 't0.5' }]));
  assert.deepEqual(ok.issues, []);
  const claim = ok.drafts[0]!;
  assert.equal(claim.kind, 'tier');
  if (claim.kind === 'tier') {
    assert.equal(claim.payload.tier, 'T0.5');
    assert.equal(claim.payload.score, 0.9);
    assert.equal(claim.payload.tierScale, 't-scale');
  }
  const bad = run(submission({}, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'S+' }]));
  assert.match(bad.issues[0]!.message, /fuera de la escala/);
});

test('ids deterministas e independientes de la fecha de consulta', () => {
  const a = run(submission({ accessedAt: '2026-10-22' }));
  const b = run(submission({ accessedAt: '2026-10-25' }));
  assert.equal(a.drafts[0]!.id, b.drafts[0]!.id);
  const c = run(submission({}, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T1' }]));
  assert.notEqual(a.drafts[0]!.id, c.drafts[0]!.id);
  assert.equal(a.drafts[0]!.slotKey, c.drafts[0]!.slotKey);
});

test('no se atribuyen estimaciones propias a fuentes externas', () => {
  const { issues } = run(submission({ evidenceType: 'internal_estimate', confidence: 'low' }));
  assert.ok(issues.some((i) => /estimación propia/.test(i.message)));
});

test('la fuente interna solo registra estimaciones con rationale', () => {
  const base = { sourceId: 'maintainer', url: 'https://github.com/fsanhuezanez/zzz-test' };
  const noRationale = run(submission({ ...base, evidenceType: 'internal_estimate', confidence: 'low' }));
  assert.ok(noRationale.issues.some((i) => /rationale/.test(i.message)));
  const asFact = run(submission({ ...base }));
  assert.ok(asFact.issues.some((i) => /solo puede registrar "internal_estimate"/.test(i.message)));
});

test('las estadísticas de uso solo se aceptan como observed_data con muestra', () => {
  const usage = { kind: 'usage', agents: ['Ellen'], metric: 'usage_rate', value: 40, unit: 'percent' };
  const r1 = run(submission({}, [usage]));
  assert.ok(r1.issues.some((i) => /observed_data/.test(i.message)));
  const r2 = run(submission({}, [{ ...usage, evidence: { evidenceType: 'observed_data', sample: { description: 'd' } } }]));
  assert.deepEqual(r2.issues, []);
  const r3 = run(submission({}, [{ ...usage, value: 140, evidence: { evidenceType: 'observed_data', sample: { description: 'd' } } }]));
  assert.ok(r3.issues.some((i) => /porcentaje/.test(i.message)));
});

test('la URL debe pertenecer al dominio de la fuente', () => {
  const { issues } = run(submission({ url: 'https://otro-sitio.example.org/x' }));
  assert.ok(issues.some((i) => /no pertenece al dominio/.test(i.message)));
});

test('Drive Disc: valida estadísticas por ranura', () => {
  const dd = { kind: 'drive_disc', agent: 'Ellen', fourPiece: ['Polar Metal'], twoPiece: [], mainStats: { slot4: ['ice_dmg'], slot6: ['crit_rate'] } };
  const { issues } = run(submission({}, [dd]));
  assert.equal(issues.length, 2);
});

test('equipo: miembros repetidos y sustitutos dentro del equipo son errores', () => {
  const { issues } = run(submission({}, [{ kind: 'team', stance: 'recommended', members: [
    { agent: 'Ellen', role: 'main_dps' },
    { agent: 'Lycaon', role: 'stunner', substitutes: [{ agent: 'Ellen', quality: 'workable' }] },
    { agent: 'Ellen', role: 'support' },
  ] }]));
  assert.ok(issues.some((i) => /repetidos/.test(i.message)));
  assert.ok(issues.some((i) => /ya forma parte/.test(i.message)));
});

test('datos contradictorios en el mismo envío se rechazan; duplicados exactos se funden', () => {
  const t0 = { kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'T0' };
  assert.equal(run(submission({}, [t0, t0])).drafts.length, 1);
  const r = run(submission({}, [t0, { ...t0, tier: 'T1' }]));
  assert.ok(r.issues.some((i) => /contradice/.test(i.message)));
});

test('el orden de miembros no cambia la identidad del equipo', () => {
  const m = [{ agent: 'Ellen', role: 'main_dps' }, { agent: 'Lycaon', role: 'stunner' }, { agent: 'Soukaku', role: 'support' }];
  const a = run(submission({}, [{ kind: 'team', stance: 'recommended', members: m }]));
  const b = run(submission({}, [{ kind: 'team', stance: 'recommended', members: [m[2], m[0], m[1]] }]));
  assert.equal(a.drafts[0]!.slotKey, b.drafts[0]!.slotKey);
});

test('equipo flexible: miembros + picks deben sumar 2 o 3 y sin solapes', () => {
  const ok = run(submission({}, [{ kind: 'team', stance: 'showcase', members: [{ agent: 'Zhu Yuan', role: 'main_dps' }],
    flex: [{ pick: 2, options: ['Nicole', 'Qingyi', 'Astra Yao'] }] }]));
  assert.deepEqual(ok.issues, []);
  assert.match(ok.drafts[0]!.slotKey, /^team:zhu-yuan\[2:astra-yao\|nicole\|qingyi\]:general$/);
  const tooBig = run(submission({}, [{ kind: 'team', stance: 'showcase', members: [{ agent: 'Zhu Yuan', role: 'main_dps' }, { agent: 'Nicole', role: 'support' }],
    flex: [{ pick: 2, options: ['Qingyi', 'Astra Yao', 'Soukaku'] }] }]));
  assert.ok(tooBig.issues.some((i) => /4 agentes/.test(i.message)));
  const overlap = run(submission({}, [{ kind: 'team', stance: 'showcase', members: [{ agent: 'Zhu Yuan', role: 'main_dps' }],
    flex: [{ pick: 2, options: ['Zhu Yuan', 'Qingyi', 'Nicole'] }] }]));
  assert.ok(overlap.issues.some((i) => /ya es miembro fijo/.test(i.message)));
});

test('equipo: requisitos y alternativas se resuelven contra el catálogo', () => {
  const r = run(submission({}, [{ kind: 'team', stance: 'recommended',
    members: [{ agent: 'Miyabi', role: 'anomaly' }, { agent: 'Yanagi', role: 'anomaly' }, { agent: 'Astra', role: 'support' }],
    alternates: [{ agent: 'Nicole', quality: 'workable' }],
    requirements: [{ text: 'necesita a Yanagi', agent: 'Yanagi', level: 'required' }],
    limitations: ['débil contra X'] }]));
  assert.deepEqual(r.issues, []);
  const draft = r.drafts[0]!;
  assert.ok(draft.agentRefs.includes('nicole'));
  if (draft.kind === 'team') assert.equal(draft.payload.requirements![0]!.agent, 'yanagi');
});

test('vocabulario editable: rol de tier desconocido → error que apunta a data/game.json', () => {
  const { issues } = run(submission({}, [{ kind: 'tier', agent: 'Ellen', role: 'healer', tier: 'T0' }]));
  assert.ok(issues.some((i) => /data\/game.json/.test(i.message)));
});

test('web_search: ni verificado ni confianza alta', () => {
  const verified = run(submission({ collectionMethod: 'web_search', confidence: 'low', verification: { state: 'verified', reviewedBy: 'x', reviewedAt: '2026-10-26' } }));
  assert.ok(verified.issues.some((i) => /buscador no puede estar verificado/.test(i.message)));
  const high = run(submission({ collectionMethod: 'web_search', confidence: 'high' }));
  assert.ok(high.issues.some((i) => /confianza "high"/.test(i.message)));
  const ok = run(submission({ collectionMethod: 'web_search', confidence: 'low' }));
  assert.equal(ok.drafts[0]!.provenance.collectionMethod, 'web_search');
});
