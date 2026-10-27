import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkIntegrity } from '../src/core/integrity.ts';
import { readDatabase } from '../src/core/store.ts';
import { readJson, sandbox, submission, update, writeJson } from './helpers.ts';

test('publica una base válida, íntegra y marcada como fixture', async () => {
  const box = await sandbox();
  const r = await update(box);
  assert.equal(r.exitCode, 0, r.markdown);
  assert.equal(r.report.outcome, 'published');
  const db = (await readDatabase(box.out))!;
  assert.equal(db.manifest.dataVersion, '3.3-r1');
  assert.equal(db.manifest.isFixture, true);
  assert.deepEqual(checkIntegrity(db), []);

  const byStatus = db.manifest.counts.claimsByStatus;
  assert.equal(byStatus.superseded, 1, 'Ellen 3.2 reemplazado por 3.3');
  assert.equal(byStatus.stale, 1, 'Burnice solo tiene dato de 3.2');
  assert.ok(r.report.pendingReview!.drafts.some((d) => d.endsWith('.draft.json')));
  assert.ok(r.report.pendingReview!.preRelease.length >= 1);
  await stat(join(box.reports, '3.3-r1.md'));
  await stat(join(box.reports, 'latest.json'));
  const bundle = await readJson(join(box.exportDir, 'zzz-meta.json'));
  assert.equal(bundle.meta.dataVersion, '3.3-r1');
  assert.equal(bundle.meta.isFixture, true);
  await stat(join(box.exportDir, 'zzz-meta.types.ts'));
});

test('las fuentes ficticias no pueden publicarse sin permiso explícito', async () => {
  const box = await sandbox();
  const r = await update(box, { allowFixtures: false });
  assert.equal(r.report.outcome, 'failed');
  assert.match(r.report.errors[0]!.message, /ficticias/);
  await assert.rejects(stat(box.out));
});

test('el fallo de una actualización no toca db/ ni export/', async () => {
  const box = await sandbox();
  await update(box);
  const before = await readFile(join(box.exportDir, 'zzz-meta.json'), 'utf8');
  await writeJson(join(box.data, 'editorial/3.3/broken.json'), submission({}, [{ kind: 'team', stance: 'recommended', members: [{ agent: 'Nadie', role: 'main_dps' }, { agent: 'Ellen', role: 'support' }] }]));
  const r = await update(box);
  assert.equal(r.exitCode, 1);
  assert.equal(await readFile(join(box.exportDir, 'zzz-meta.json'), 'utf8'), before);
});

test('consenso entre fuentes: acuerdo, discrepancia y nunca con una sola fuente', async () => {
  const box = await sandbox();
  await update(box);
  const db = (await readDatabase(box.out))!;
  const ellen = db.consensus.tiers.find((t) => t.agent === 'ellen')!;
  const miyabi = db.consensus.tiers.find((t) => t.agent === 'miyabi')!;
  assert.equal(ellen.agreement, 'agree'); // T0 (1.0) vs S (0.8)
  assert.equal(miyabi.agreement, 'mixed'); // T0 (1.0) vs A (0.6)
  assert.equal(ellen.evidenceType, 'cross_source_consensus');
  assert.equal(ellen.collectionMethod, 'derived');
  assert.equal(db.consensus.tiers.some((t) => t.agent === 'lycaon'), false, 'una sola fuente no es consenso');
  assert.equal(db.consensus.teams.length, 1);
  assert.deepEqual(db.consensus.teams[0]!.members, ['ellen', 'lycaon', 'soukaku']);
  assert.equal(db.manifest.counts.liveClaimsByReview.pending > 0, true);
  // Las estimaciones internas no entran en el consenso ni en claims de fuentes externas.
  const internal = db.claims.filter((c) => c.sourceId === 'maintainer');
  assert.ok(internal.every((c) => c.provenance.evidenceType === 'internal_estimate'));
});

test('sin cambios → no hay nueva revisión ni se reescribe la base', async () => {
  const box = await sandbox();
  await update(box);
  const before = await readFile(join(box.out, 'manifest.json'), 'utf8');
  const r = await update(box, { now: new Date('2026-10-27T18:00:00Z') });
  assert.equal(r.report.outcome, 'unchanged');
  assert.equal(await readFile(join(box.out, 'manifest.json'), 'utf8'), before);
});

test('un cambio de valor se detecta como "changed" y sube la revisión', async () => {
  const box = await sandbox();
  await update(box);
  const file = join(box.data, 'editorial/3.3/stats-b-shiyu.json');
  const sub = await readJson(file);
  sub.claims[0].tier = 'SS';
  sub.accessedAt = '2026-10-27';
  await writeJson(file, sub);
  const r = await update(box);
  assert.equal(r.report.dataVersion, '3.3-r2');
  const changed = r.report.changes!.claims.changed;
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.slotKey, 'tier:ellen:attack:shiyu_defense');
  assert.deepEqual(changed[0]!.fields, ['payload.score', 'payload.tier']);
  const db = (await readDatabase(box.out))!;
  assert.equal(db.manifest.previousDataVersion, '3.3-r1');
  assert.equal(db.changelog.fromVersion, '3.3-r1');
});

test('entrada inválida → la actualización falla y se conserva la última versión válida', async () => {
  const box = await sandbox();
  await update(box);
  const before = await readFile(join(box.out, 'claims.json'), 'utf8');
  await writeJson(join(box.data, 'editorial/3.3/broken.json'), submission({}, [{ kind: 'tier', agent: 'Personaje Inexistente', role: 'attack', tier: 'T0' }]));
  const r = await update(box);
  assert.equal(r.exitCode, 1);
  assert.match(r.markdown, /Errores que corregir/);
  assert.equal(r.report.outcome, 'failed');
  assert.match(r.report.errors[0]!.message, /desconocido/);
  assert.equal(await readFile(join(box.out, 'claims.json'), 'utf8'), before);
  const reports = await readdir(box.reports);
  assert.ok(reports.some((f) => f.startsWith('failed-3.3')));
  assert.equal((await readJson(join(box.reports, 'latest.json'))).outcome, 'failed');
});

test('JSON mal formado también falla sin tocar la base', async () => {
  const box = await sandbox();
  await update(box);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(box.data, 'editorial/3.3/bad.json'), '{ "sourceId": ');
  const r = await update(box);
  assert.equal(r.report.outcome, 'failed');
  assert.equal((await readDatabase(box.out))!.manifest.dataVersion, '3.3-r1');
});

test('dry run no escribe nada', async () => {
  const box = await sandbox();
  const r = await update(box, { dryRun: true });
  assert.equal(r.report.outcome, 'dry_run');
  await assert.rejects(stat(box.out));
  await assert.rejects(stat(box.reports));
});

test('borrar un envío se refleja como eliminado en el changelog', async () => {
  const box = await sandbox();
  await update(box);
  await rm(join(box.data, 'editorial/3.3/maintainer-estimates.json'));
  const r = await update(box);
  assert.equal(r.report.changes!.claims.removed.length, 1);
  assert.equal((await readJson(join(box.exportDir, 'zzz-meta.json'))).meta.dataVersion, '3.3-r2');
  assert.equal(r.report.changes!.claims.removed[0]!.sourceId, 'maintainer');
});

test('nuevo parche → revisión 1 y los datos del parche anterior pasan a stale', async () => {
  const box = await sandbox();
  await update(box);
  const cal = await readJson(join(box.data, 'patches.json'));
  cal.patches.push({ patch: '3.4', releaseDate: '2026-12-02', source: 'https://example.com/', verified: false });
  await writeJson(join(box.data, 'patches.json'), cal);
  const r = await update(box, { patch: '3.4', now: new Date('2026-12-03T00:00:00Z') });
  assert.equal(r.report.dataVersion, '3.4-r1');
  const db = (await readDatabase(box.out))!;
  assert.equal(db.manifest.counts.claimsByStatus.current, 0);
  assert.ok(r.report.changes!.claims.statusChanged.length > 0);
});

test('validate detecta una base editada a mano', async () => {
  const box = await sandbox();
  await update(box);
  const path = join(box.out, 'claims.json');
  const claims = await readJson(path);
  claims.items[0].provenance.confidence = 'low';
  await writeJson(path, claims);
  const problems = checkIntegrity((await readDatabase(box.out))!);
  assert.ok(problems.some((p) => /contentHash/.test(p)));
});

test('el informe agrupa lo pendiente por página y marca lo que viene de buscador', async () => {
  const box = await sandbox();
  const r = await update(box);
  const pages = r.report.pendingReview!.pagesToVerify;
  const lead = pages.find((p) => p.url === 'https://stats-b.example.com/zzz/teams')!;
  assert.equal(lead.viaSearch, true);
  assert.match(r.markdown, /🔎 https:\/\/stats-b\.example\.com\/zzz\/teams/);
  assert.ok(r.report.pendingReview!.summary.viaSearch >= 1);
});
