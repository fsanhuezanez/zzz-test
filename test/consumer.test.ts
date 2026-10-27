import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { ZzzMetaExport } from '../export/zzz-meta.types.ts';
import { bestDisjointPair, buildsFor, recommendTeams } from '../examples/hoyo-builds-consumer/recommender.ts';
import { readJson, sandbox, update } from './helpers.ts';

const box = await sandbox();
await update(box);
const data = await readJson<ZzzMetaExport>(join(box.exportDir, 'zzz-meta.json'));
const shiyu = { mode: 'shiyu_defense' as const };

test('el paquete expone equipos, composiciones, builds y evidencia', () => {
  assert.equal(data.meta.format, 'zzz-meta-export');
  const team = data.teams.find((t) => t.archetype === 'Frost anomaly')!;
  assert.equal(team.stance, 'recommended');
  assert.equal(team.requirements[0]!.agent, 'yanagi');
  assert.equal(team.limitations.length, 1);
  assert.equal(team.evidence.review, 'verified');
  const ellen = data.compositions.find((c) => c.core.join() === 'ellen,lycaon,soukaku')!;
  assert.deepEqual(ellen.support.sources.sort(), ['example-guide-a', 'example-stats-b']);
  assert.deepEqual(ellen.support.verifiedSources, ['example-guide-a']);
  assert.equal(data.builds.ellen!.wEngines[0]!.options[0]!.wEngine, 'deep-sea-visitor');
  assert.ok(data.tiers.every((t) => typeof t.scoreInScale === 'number'));
  const lead = data.teams.find((t) => t.evidence.collectionMethod === 'web_search')!;
  assert.equal(lead.evidence.review, 'pending');
  assert.ok(lead.evidence.flags.includes('via_search'));
});

test('un agente de tier alto no genera equipos que la evidencia no avala', () => {
  const { options, blocked } = recommendTeams(data, { agents: ['miyabi', 'ellen', 'soukaku', 'qingyi', 'astra-yao'] }, shiyu);
  assert.ok(options.every((o) => !o.lineup.includes('miyabi')), 'Miyabi es T0 pero sus equipos necesitan a Yanagi o Lycaon');
  assert.ok(blocked.some((b) => b.missing.includes('yanagi')));
});

test('los sustitutos solo salen de la evidencia y se prefieren los de la misma fuente', () => {
  const full = recommendTeams(data, { agents: ['ellen', 'lycaon', 'soukaku'] }, shiyu).options[0]!;
  assert.deepEqual(full.lineup, ['ellen', 'lycaon', 'soukaku']);
  assert.equal(full.substitutions, 0);
  assert.equal(full.sources.length, 2);
  const sub = recommendTeams(data, { agents: ['ellen', 'qingyi', 'soukaku'] }, shiyu).options[0]!;
  const slot = sub.slots.find((s) => s.agent === 'qingyi')!;
  assert.equal(slot.replaces, 'lycaon');
  assert.equal(slot.via, 'same_source_substitute');
});

test('las estimaciones internas se usan solo como último recurso y se advierten', () => {
  const { options } = recommendTeams(data, { agents: ['ellen', 'anby', 'soukaku'] }, shiyu);
  const anby = options.find((o) => o.lineup.includes('anby'))!;
  assert.ok(anby.notes.some((n) => /estimación propia/.test(n)));
});

test('equipos flexibles: elige entre las opciones que la cuenta tiene', () => {
  const { options } = recommendTeams(data, { agents: ['zhu-yuan', 'astra-yao', 'soukaku'] }, shiyu);
  const z = options.find((o) => o.lineup.includes('zhu-yuan'))!;
  assert.deepEqual(z.lineup, ['astra-yao', 'soukaku', 'zhu-yuan']);
  assert.ok(z.notes.some((n) => /solo lo muestran/.test(n)));
});

test('solo verificados: excluye lo pendiente si se pide', () => {
  const all = recommendTeams(data, { agents: ['miyabi', 'lycaon', 'soukaku'] }, shiyu).options;
  const verified = recommendTeams(data, { agents: ['miyabi', 'lycaon', 'soukaku'] }, { ...shiyu, includePending: false }).options;
  assert.equal(all.length, 1);
  assert.equal(verified.length, 0);
});

test('pareja sin solapamiento y builds marcando lo que se posee', () => {
  const roster = { agents: ['ellen', 'qingyi', 'soukaku', 'nicole', 'astra-yao', 'anby', 'zhu-yuan', 'lycaon'], wEngines: ['starlight-engine'] };
  const pair = bestDisjointPair(recommendTeams(data, roster, shiyu).options)!;
  assert.equal(pair[0].lineup.some((a) => pair[1].lineup.includes(a)), false);
  const b = buildsFor(data, 'ellen', roster)!;
  assert.equal(b.wEngines[0]!.options.find((o) => o.wEngine === 'starlight-engine')!.owned, true);
});

test('los equipos que la fuente marca como económicos van detrás de los no económicos', () => {
  const { options } = recommendTeams(data, { agents: ['billy', 'anby', 'nicole', 'zhu-yuan', 'qingyi'] }, shiyu);
  const idx = (a: string) => options.findIndex((o) => o.lineup.includes(a));
  assert.ok(options.find((o) => o.lineup.includes('billy'))!.budget);
  assert.ok(idx('zhu-yuan') < idx('billy'));
});
