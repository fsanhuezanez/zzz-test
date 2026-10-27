/**
 * Uso: node examples/hoyo-builds-consumer/recommend.ts [export.json] [roster.json] [modo]
 * Por defecto usa el paquete de PRUEBA (examples/fixture-export) y el roster de ejemplo.
 * Para tus datos reales: node examples/hoyo-builds-consumer/recommend.ts export/zzz-meta.json mi-roster.json shiyu_defense
 */
import { readFile } from 'node:fs/promises';
import type { Evidence, GameMode, ZzzMetaExport } from '../../export/zzz-meta.types.ts';
import { bestDisjointPair, buildsFor, recommendTeams, type Roster } from './recommender.ts';

const [exportPath = 'examples/fixture-export/zzz-meta.json', rosterPath = 'examples/hoyo-builds-consumer/roster.example.json', mode = 'shiyu_defense'] = process.argv.slice(2);

const data = JSON.parse(await readFile(exportPath, 'utf8')) as ZzzMetaExport;
const roster = JSON.parse(await readFile(rosterPath, 'utf8')) as Roster;
const names = new Map([...data.agents, ...data.wEngines, ...data.driveDiscs, ...data.bangboo].map((a) => [a.id, a.name]));
const name = (id: string) => names.get(id) ?? id;
const tag = (e: Evidence) => `${e.sourceName}, ${e.review === 'verified' ? 'verificado' : 'PENDIENTE'}${e.collectionMethod === 'web_search' ? ' vía buscador' : ''}, ${e.confidence}, parche ${e.declaredPatch ?? '¿?'}`;

console.log(`Paquete ${data.meta.dataVersion} (parche ${data.meta.gamePatch})${data.meta.isFixture ? ' — ⚠ DATOS FICTICIOS' : ''}`);
console.log(`Datos: ${data.meta.counts.verified} verificados · ${data.meta.counts.pending} pendientes`);
console.log(`Roster ${roster.name ?? ''}: ${roster.agents.map(name).join(', ')}\n`);

const { options, blocked } = recommendTeams(data, roster, { mode: mode as GameMode });
if (!options.length) console.log('Ningún equipo documentado es formable con este roster.');
for (const o of options) {
  console.log(`▶ ${o.lineup.map(name).join(' / ')}${o.budget ? '  [económico]' : ''}  (núcleo documentado por ${o.coreSources} fuente(s), ${o.substitutions} sustitución(es))`);
  for (const s of o.slots) {
    if (s.replaces) console.log(`    · ${name(s.agent)} en lugar de ${name(s.replaces)} — ${s.via}, ${s.quality}`);
  }
  for (const t of o.backing) console.log(`    ✓ ${t.stance}${t.rating ? ` ${t.rating.label}` : ''} — ${tag(t.evidence)}\n      ${t.evidence.url}`);
  for (const n of o.notes) console.log(`    ! ${n}`);
}

const close = blocked.filter((b) => b.missing.length === 1);
if (close.length) {
  console.log('\nEquipos documentados a los que solo os falta 1 agente (sin sustituto documentado):');
  for (const b of close) console.log(`  ✗ ${b.core.map(name).join(' / ')} (${b.sourceId}) — falta: ${b.missing.map(name).join(', ')}`);
}
if (blocked.length > close.length) console.log(`(${blocked.length - close.length} equipos más necesitan 2 o más agentes que no tenéis.)`);

const pair = bestDisjointPair(options);
if (pair) console.log(`\nPareja sin repetir agentes: [${pair[0].lineup.map(name).join(', ')}] + [${pair[1].lineup.map(name).join(', ')}]`);

for (const agent of [...new Set(options.flatMap((o) => o.lineup))]) {
  const b = buildsFor(data, agent, roster);
  if (!b || (!b.wEngines.length && !b.driveDiscs.length)) continue;
  console.log(`\nBuild documentada de ${name(agent)}:`);
  for (const w of b.wEngines) {
    console.log(`  W-Engine: ${w.options.map((o) => `${o.rank}. ${name(o.wEngine)}${o.f2p ? ' (F2P)' : ''}${o.owned ? ' ✔ tienes' : ''}`).join('  ')} — ${tag(w.evidence)}`);
  }
  for (const d of b.driveDiscs) {
    console.log(`  Discos: 4p ${d.fourPiece.map(name).join(' > ')} · 2p ${d.twoPiece.map(name).join(', ')} · principal 4/5/6: ${d.mainStats.slot4?.join('|')} / ${d.mainStats.slot5?.join('|')} / ${d.mainStats.slot6?.join('|')} — ${tag(d.evidence)}`);
  }
}
