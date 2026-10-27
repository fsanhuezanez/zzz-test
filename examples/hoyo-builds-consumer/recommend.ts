/**
 * Uso: node examples/hoyo-builds-consumer/recommend.ts [ruta-db] [ruta-roster] [modo]
 * Por defecto usa la base de PRUEBA (examples/fixture-db) y el roster de ejemplo.
 */
import { readFile } from 'node:fs/promises';
import { loadDatabase } from '../../src/client/index.ts';
import type { GameMode } from '../../src/client/index.ts';
import { bestDisjointPair, gearFor, recommendTeams, type Roster } from './recommender.ts';

const [dbDir = 'examples/fixture-db', rosterPath = 'examples/hoyo-builds-consumer/roster.example.json', mode = 'shiyu_defense'] = process.argv.slice(2);

const db = await loadDatabase(dbDir);
const roster = JSON.parse(await readFile(rosterPath, 'utf8')) as Roster;
const name = (id: string) => db.agentName(id);

console.log(`Base ${db.manifest.dataVersion} (parche ${db.manifest.gamePatch})${db.isFixture ? ' — ⚠ DATOS FICTICIOS DE PRUEBA' : ''}`);
console.log(`Roster: ${roster.agents.map(name).join(', ')}\n`);

const { suggestions, nearMisses } = recommendTeams(db, roster, { mode: mode as GameMode });
if (!suggestions.length) console.log('Ningún equipo avalado por la evidencia actual es formable con este roster.');
for (const s of suggestions) {
  console.log(`▶ ${s.members.map(name).join(' / ')}  score=${s.score}  fuentes=${s.independentSources}`);
  for (const slot of s.slots) {
    if (slot.substitution) {
      console.log(`    · ${name(slot.chosen)} sustituye a ${name(slot.original)} (${slot.substitution.quality}, ${slot.substitution.basis}, ${slot.substitution.evidenceType})`);
    }
  }
  for (const e of s.evidence) console.log(`    ✓ ${e.attribution} [${e.evidenceType}, ${e.confidence}${e.flags.length ? `, ${e.flags.join(',')}` : ''}]`);
  for (const w of s.warnings) console.log(`    ! ${w}`);
}

if (nearMisses.length) {
  console.log('\nEquipos avalados pero no formables (faltan agentes sin sustituto documentado):');
  for (const n of nearMisses) console.log(`  ✗ ${n.members.map(name).join(' / ')} — falta: ${n.missing.map(name).join(', ')}`);
}

const pair = bestDisjointPair(suggestions);
if (pair) console.log(`\nMejor pareja sin solapamiento: [${pair[0].members.map(name).join(', ')}] + [${pair[1].members.map(name).join(', ')}]`);

const agentsInSuggestions = [...new Set(suggestions.flatMap((s) => s.members))];
for (const agent of agentsInSuggestions) {
  const gear = gearFor(db, agent, roster);
  if (!gear.wEngines.length && !gear.driveDiscs.length && !gear.f2p.length) continue;
  console.log(`\nEquipamiento documentado para ${name(agent)}:`);
  for (const w of gear.wEngines) {
    const opts = w.options.map((o) => `${o.rank}. ${o.name}${o.f2p ? ' (F2P)' : ''}${o.owned === true ? ' ✔ en cuenta' : ''}`);
    console.log(`  W-Engine: ${opts.join('  ')}\n    ↳ ${w.attribution}`);
  }
  for (const d of gear.driveDiscs) {
    console.log(`  Drive Disc: 4p ${d.fourPiece.map((id) => db.driveDiscs.get(id)?.name ?? id).join(' > ')} · 2p ${d.twoPiece.map((id) => db.driveDiscs.get(id)?.name ?? id).join(', ')}\n    ↳ ${d.attribution}`);
  }
}
