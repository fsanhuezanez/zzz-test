import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDatabase } from '../src/client/index.ts';
import { bestDisjointPair, recommendTeams } from '../examples/hoyo-builds-consumer/recommender.ts';
import { sandbox, update } from './helpers.ts';

const box = await sandbox();
await update(box);
const db = await loadDatabase(box.out);

test('el cliente valida y consulta por agente, tipo y estado', () => {
  assert.equal(db.isFixture, true);
  const ellenTiers = db.claims({ kind: 'tier', agent: 'ellen' });
  assert.equal(ellenTiers.length, 2, 'solo vigentes por defecto');
  assert.equal(db.claims({ kind: 'tier', agent: 'ellen', status: ['superseded'] }).length, 1);
  assert.equal(db.claims({ kind: 'tier', agent: 'ellen', verifiedOnly: true }).length, 1);
  assert.match(db.attribution(ellenTiers[0]!), /consultado 2026-10-2\d, parche 3\.3/);
});

test('un agente de tier alto no genera equipos que ninguna fuente avala', () => {
  const roster = { agents: ['miyabi', 'ellen', 'soukaku', 'qingyi', 'astra-yao'] };
  const { suggestions, nearMisses } = recommendTeams(db, roster, { mode: 'shiyu_defense' });
  assert.ok(suggestions.every((s) => !s.members.includes('miyabi')), 'Miyabi es T0 pero su equipo necesita a Yanagi');
  assert.ok(nearMisses.some((n) => n.missing.includes('yanagi')));
});

test('los sustitutos solo salen de la evidencia y penalizan', () => {
  const full = recommendTeams(db, { agents: ['ellen', 'lycaon', 'soukaku'] }, { mode: 'shiyu_defense' }).suggestions[0]!;
  const sub = recommendTeams(db, { agents: ['ellen', 'qingyi', 'soukaku'] }, { mode: 'shiyu_defense' }).suggestions[0]!;
  assert.deepEqual(full.members, ['ellen', 'lycaon', 'soukaku']);
  assert.equal(full.independentSources, 2);
  assert.deepEqual(sub.members, ['ellen', 'qingyi', 'soukaku']);
  assert.equal(sub.slots.find((s) => s.chosen === 'qingyi')!.substitution!.quality, 'workable');
  assert.ok(sub.score < full.score);
});

test('las estimaciones internas pesan menos y se advierten', () => {
  const { suggestions } = recommendTeams(db, { agents: ['ellen', 'anby', 'soukaku'] }, { mode: 'shiyu_defense' });
  const anby = suggestions.find((s) => s.members.includes('anby'))!;
  assert.ok(anby.warnings.some((w) => /estimación interna/.test(w)));
  assert.ok(anby.score < 0.5);
});

test('mejor pareja sin solapamiento para modos de dos equipos', () => {
  const roster = { agents: ['ellen', 'qingyi', 'soukaku', 'nicole', 'astra-yao', 'anby', 'zhu-yuan', 'miyabi'] };
  const { suggestions } = recommendTeams(db, roster, { mode: 'shiyu_defense' });
  const pair = bestDisjointPair(suggestions)!;
  assert.ok(pair);
  assert.equal(pair[0].members.some((m) => pair[1].members.includes(m)), false);
});
