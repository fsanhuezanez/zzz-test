import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkIntegrity } from '../src/core/integrity.ts';
import { readDatabase } from '../src/core/store.ts';
import type { Source } from '../src/schema/sources.ts';
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
  assert.ok(r.report.pendingReview.drafts.some((d) => d.endsWith('.draft.json')));
  assert.ok(r.report.pendingReview.preRelease.length >= 1);
  await stat(join(box.reports, '3.3-r1.md'));
  await stat(join(box.reports, 'latest.json'));
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

test('fallo de un feed automatizado → se conservan sus datos anteriores marcados carried_over', async () => {
  const box = await sandbox();
  const registryPath = join(box.data, 'sources.json');
  const registry = await readJson<{ sources: Source[] }>(registryPath);
  registry.sources.push({
    id: 'example-feed', name: 'Feed ficticio', kind: 'fixture', homepage: 'https://feed.example.com/',
    attribution: 'Feed ficticio de pruebas.',
    automation: { status: 'allowed', basis: 'Permiso ficticio de pruebas.', checkedAt: '2026-10-27', evidenceUrls: ['https://feed.example.com/permiso'], allowedMethods: ['automated_feed'] },
    adapter: { type: 'http_json_feed', url: 'https://feed.example.com/zzz.json', method: 'automated_feed', minIntervalMs: 1000, timeoutMs: 5000, respectRobotsTxt: true },
    defaultTierScale: 't', tierScales: [{ id: 't', labels: [{ label: 'A', score: 1 }, { label: 'B', score: 0 }], confirmed: true }], maxAgeDays: 30,
  });
  await writeJson(registryPath, registry);
  const feed = submission({ sourceId: 'example-feed', url: 'https://feed.example.com/zzz.json' }, [{ kind: 'tier', agent: 'Ellen', role: 'attack', tier: 'A' }]);
  const okFetch = async (url: string) => ({
    ok: true, status: 200,
    text: async () => (url.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /private\n' : JSON.stringify(feed)),
  });
  const noSleep = async () => {};

  const first = await update(box, { http: { fetch: okFetch, sleep: noSleep } });
  assert.equal(first.exitCode, 0, first.markdown);
  const firstDb = (await readDatabase(box.out))!;
  const fed = firstDb.claims.filter((c) => c.sourceId === 'example-feed');
  assert.equal(fed.length, 1);
  assert.equal(fed[0]!.provenance.collectionMethod, 'automated_feed');

  const failingFetch = async () => { throw new Error('ECONNRESET'); };
  const second = await update(box, { http: { fetch: failingFetch, sleep: noSleep } });
  assert.equal(second.exitCode, 0);
  assert.ok(second.report.warnings.some((w) => /example-feed.*ECONNRESET/.test(w)));
  const db = (await readDatabase(box.out))!;
  const carried = db.claims.filter((c) => c.sourceId === 'example-feed');
  assert.equal(carried.length, 1);
  assert.equal(carried[0]!.id, fed[0]!.id);
  assert.ok(carried[0]!.flags.includes('carried_over'));
  assert.equal(db.manifest.sources.find((s) => s.id === 'example-feed')!.updateOutcome, 'carried_over');

  // Si la política cambia a "disallowed", el feed no se consulta y sus datos se marcan.
  registry.sources.at(-1)!.automation.status = 'disallowed';
  await writeJson(registryPath, registry);
  let called = false;
  const spyFetch = async () => { called = true; throw new Error('no debería llamarse'); };
  const third = await update(box, { http: { fetch: spyFetch, sleep: noSleep } });
  assert.equal(called, false);
  const db3 = (await readDatabase(box.out))!;
  const flagged = db3.claims.find((c) => c.sourceId === 'example-feed')!;
  assert.ok(flagged.flags.includes('source_policy_changed'));
  assert.ok(third.report.pendingReview.sourcePolicyChanged.length === 1);
});

test('el feed no puede publicar datos en nombre de otra fuente', async () => {
  const box = await sandbox();
  const registryPath = join(box.data, 'sources.json');
  const registry = await readJson<{ sources: Source[] }>(registryPath);
  registry.sources.push({
    id: 'example-feed', name: 'Feed', kind: 'fixture', homepage: 'https://feed.example.com/', attribution: 'x',
    automation: { status: 'allowed', basis: 'x', checkedAt: '2026-10-27', evidenceUrls: ['https://feed.example.com/p'], allowedMethods: ['automated_feed'] },
    adapter: { type: 'http_json_feed', url: 'https://feed.example.com/zzz.json', method: 'automated_feed', minIntervalMs: 1000, timeoutMs: 5000, respectRobotsTxt: true },
    tierScales: [], maxAgeDays: 30,
  });
  await writeJson(registryPath, registry);
  const fetchOther = async (url: string) => ({ ok: !url.endsWith('robots.txt'), status: url.endsWith('robots.txt') ? 404 : 200, text: async () => JSON.stringify(submission()) });
  const r = await update(box, { http: { fetch: fetchOther, sleep: async () => {} } });
  assert.equal(r.report.outcome, 'failed');
  assert.ok(r.report.errors.some((e) => /no puede publicar datos de "example-guide-a"/.test(e.message)));
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
