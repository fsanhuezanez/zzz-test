/**
 * Comprobaciones de integridad de una base ya generada (más allá del esquema):
 * referencias al catálogo, coherencia entre ficheros y hash de contenido.
 */
import { canonicalJson, sha256 } from './canonical.ts';
import { CatalogIndex } from './catalog.ts';
import { catalogRefs } from './lifecycle.ts';
import type { DraftClaim } from './normalize.ts';
import type { StoredDatabase } from './store.ts';

export function checkIntegrity(db: StoredDatabase): string[] {
  const problems: string[] = [];
  let catalog: CatalogIndex;
  try {
    catalog = new CatalogIndex(db.catalog);
  } catch (err) {
    return [(err as Error).message];
  }
  const v = db.manifest.dataVersion;
  for (const [name, fileVersion] of [['consensus', db.consensus.dataVersion], ['changelog', db.changelog.toVersion]] as const) {
    if (fileVersion !== v) problems.push(`${name}: dataVersion ${fileVersion} ≠ manifest ${v}`);
  }

  const sourceIds = new Set(db.sources.map((s) => s.id));
  const claimIds = new Set<string>();
  for (const c of db.claims) {
    if (claimIds.has(c.id)) problems.push(`claim duplicado ${c.id}`);
    claimIds.add(c.id);
    if (!sourceIds.has(c.sourceId)) problems.push(`${c.id}: fuente desconocida "${c.sourceId}"`);
    if (c.provenance.sourceId !== c.sourceId) problems.push(`${c.id}: provenance.sourceId no coincide`);
    for (const [type, id] of catalogRefs(c)) {
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

  const m = db.manifest.counts;
  if (m.claims !== db.claims.length) problems.push(`manifest.counts.claims=${m.claims}, hay ${db.claims.length}`);
  if (m.agents !== db.catalog.agents.length) problems.push('manifest.counts.agents no coincide');
  const expected = sha256(canonicalJson({
    gamePatch: db.manifest.gamePatch,
    catalog: db.catalog,
    vocabulary: db.vocabulary,
    sources: db.sources,
    claims: db.claims,
    consensus: { tiers: db.consensus.tiers, teams: db.consensus.teams },
  }));
  if (expected !== db.manifest.contentHash) problems.push('contentHash no coincide con el contenido: la base fue editada a mano o está corrupta');
  return problems;
}
