/**
 * Comprobaciones de integridad de una base ya generada (más allá del esquema):
 * referencias al catálogo, coherencia entre ficheros y hash de contenido.
 */
import type { Claim } from '../schema/claims.ts';
import { canonicalJson, sha256 } from './canonical.ts';
import { CatalogIndex, type EntityType } from './catalog.ts';
import type { StoredDatabase } from './store.ts';

function entityRefs(c: Claim): [EntityType, string][] {
  const refs: [EntityType, string][] = c.agentRefs.map((id) => ['agent', id]);
  switch (c.kind) {
    case 'team':
      c.payload.bangboo?.forEach((b) => refs.push(['bangboo', b.bangboo]));
      break;
    case 'w_engine':
      c.payload.options.forEach((o) => refs.push(['wEngine', o.wEngine]));
      break;
    case 'drive_disc':
      [...c.payload.fourPiece, ...c.payload.twoPiece].forEach((d) => refs.push(['driveDisc', d]));
      break;
    case 'bangboo':
      c.payload.options.forEach((o) => refs.push(['bangboo', o.bangboo]));
      break;
    case 'f2p_option': {
      const type = ({ agent: 'agent', team: 'agent', w_engine: 'wEngine', bangboo: 'bangboo', drive_disc: 'driveDisc' } as const)[c.payload.category];
      [...c.payload.entities, ...(c.payload.replaces ? [c.payload.replaces] : [])].forEach((id) => refs.push([type, id]));
      break;
    }
    default:
      break;
  }
  return refs;
}

export function checkIntegrity(db: StoredDatabase): string[] {
  const problems: string[] = [];
  let catalog: CatalogIndex;
  try {
    catalog = new CatalogIndex(db.catalog);
  } catch (err) {
    return [(err as Error).message];
  }
  const v = db.manifest.dataVersion;
  for (const [name, fileVersion] of [['claims/consensus', db.consensus.dataVersion], ['index', db.index.dataVersion], ['changelog', db.changelog.toVersion]] as const) {
    if (fileVersion !== v) problems.push(`${name}: dataVersion ${fileVersion} ≠ manifest ${v}`);
  }

  const sourceIds = new Set(db.sources.map((s) => s.id));
  const claimIds = new Set<string>();
  for (const c of db.claims) {
    if (claimIds.has(c.id)) problems.push(`claim duplicado ${c.id}`);
    claimIds.add(c.id);
    if (!sourceIds.has(c.sourceId)) problems.push(`${c.id}: fuente desconocida "${c.sourceId}"`);
    if (c.provenance.sourceId !== c.sourceId) problems.push(`${c.id}: provenance.sourceId no coincide`);
    for (const [type, id] of entityRefs(c)) {
      if (!catalog.has(type, id)) problems.push(`${c.id}: referencia a ${type} inexistente "${id}"`);
    }
    if (c.status === 'superseded' && !c.supersededBy) problems.push(`${c.id}: superseded sin supersededBy`);
  }
  for (const c of db.claims) {
    if (c.supersededBy && !claimIds.has(c.supersededBy)) problems.push(`${c.id}: supersededBy apunta a un claim inexistente`);
  }
  for (const t of [...db.consensus.tiers, ...db.consensus.teams]) {
    for (const id of t.derivedFrom) if (!claimIds.has(id)) problems.push(`${t.id}: derivedFrom apunta a ${id}, inexistente`);
  }
  for (const [agent, entry] of Object.entries(db.index.agents)) {
    if (!catalog.has('agent', agent)) problems.push(`index: agente desconocido ${agent}`);
    for (const id of entry.claimIds) if (!claimIds.has(id)) problems.push(`index/${agent}: claim inexistente ${id}`);
  }

  const m = db.manifest.counts;
  if (m.claims !== db.claims.length) problems.push(`manifest.counts.claims=${m.claims}, hay ${db.claims.length}`);
  if (m.agents !== db.catalog.agents.length) problems.push('manifest.counts.agents no coincide');
  const expected = sha256(canonicalJson({
    gamePatch: db.manifest.gamePatch,
    catalog: db.catalog,
    sources: db.sources,
    claims: db.claims,
    consensus: { tiers: db.consensus.tiers, teams: db.consensus.teams },
  }));
  if (expected !== db.manifest.contentHash) problems.push('contentHash no coincide con el contenido: la base fue editada a mano o está corrupta');
  return problems;
}
