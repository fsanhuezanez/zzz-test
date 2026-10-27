/**
 * Detección de cambios entre dos versiones de la base.
 *
 * - added / removed: claims nuevos o desaparecidos.
 * - changed: misma fuente y mismo "hueco" (slotKey) con un valor distinto
 *   (p. ej. la fuente movió a un agente de T1 a T0).
 * - refreshed: mismo dato, procedencia renovada (nueva consulta o verificación).
 * - statusChanged: cambia el estado o los flags (p. ej. pasa a stale).
 */
import type { Catalog } from '../schema/catalog.ts';
import type { Claim } from '../schema/claims.ts';
import type { Changelog } from '../schema/database.ts';
import { canonicalJson } from './canonical.ts';

const ref = (c: Claim) => ({ id: c.id, kind: c.kind, sourceId: c.sourceId, slotKey: c.slotKey });

function changedFields(a: Claim, b: Claim): string[] {
  const fields: string[] = [];
  const pa = a.payload as Record<string, unknown>;
  const pb = b.payload as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort()) {
    if (canonicalJson(pa[key]) !== canonicalJson(pb[key])) fields.push(`payload.${key}`);
  }
  if (canonicalJson(a.context) !== canonicalJson(b.context)) fields.push('context');
  if (a.provenance.declaredPatch !== b.provenance.declaredPatch) fields.push('provenance.declaredPatch');
  if (a.provenance.evidenceType !== b.provenance.evidenceType) fields.push('provenance.evidenceType');
  return fields;
}

function catalogEntries(catalog: Catalog): Map<string, string> {
  const map = new Map<string, string>();
  const add = (prefix: string, items: { id: string }[]) => items.forEach((i) => map.set(`${prefix}:${i.id}`, canonicalJson(i)));
  add('agent', catalog.agents);
  add('w-engine', catalog.wEngines);
  add('drive-disc', catalog.driveDiscs);
  add('bangboo', catalog.bangboo);
  return map;
}

export function diffDatabases(
  prev: { dataVersion: string; claims: Claim[]; catalog: Catalog } | null,
  next: { dataVersion: string; claims: Claim[]; catalog: Catalog },
  generatedAt: string,
): Changelog {
  // Solo se comparan las cabezas de cada hueco: los superseded son historial.
  const live = (claims: Claim[]) => claims.filter((c) => c.status !== 'superseded');
  const prevClaims = prev ? live(prev.claims) : [];
  const nextClaims = live(next.claims);
  const prevById = new Map(prevClaims.map((c) => [c.id, c]));
  const nextById = new Map(nextClaims.map((c) => [c.id, c]));

  let added = nextClaims.filter((c) => !prevById.has(c.id));
  let removed = prevClaims.filter((c) => !nextById.has(c.id));

  const changed: Changelog['claims']['changed'] = [];
  const removedBySlot = new Map(removed.map((c) => [`${c.sourceId}|${c.slotKey}`, c]));
  const matched = new Set<string>();
  for (const c of added) {
    const old = removedBySlot.get(`${c.sourceId}|${c.slotKey}`);
    if (!old) continue;
    changed.push({ sourceId: c.sourceId, kind: c.kind, slotKey: c.slotKey, fromId: old.id, toId: c.id, fields: changedFields(old, c) });
    matched.add(old.id).add(c.id);
  }
  added = added.filter((c) => !matched.has(c.id));
  removed = removed.filter((c) => !matched.has(c.id));

  const refreshed: Changelog['claims']['refreshed'] = [];
  const statusChanged: Changelog['claims']['statusChanged'] = [];
  for (const c of nextClaims) {
    const old = prevById.get(c.id);
    if (!old) continue;
    if (old.status !== c.status || canonicalJson(old.flags) !== canonicalJson(c.flags)) {
      statusChanged.push({
        id: c.id, from: old.status, to: c.status,
        flagsAdded: c.flags.filter((f) => !old.flags.includes(f)),
        flagsRemoved: old.flags.filter((f) => !c.flags.includes(f)),
      });
    }
    if (canonicalJson(old.provenance) !== canonicalJson(c.provenance)) refreshed.push(ref(c));
  }

  const prevCat = prev ? catalogEntries(prev.catalog) : new Map<string, string>();
  const nextCat = catalogEntries(next.catalog);
  const sortIds = (ids: string[]) => ids.sort();
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

  return {
    fromVersion: prev?.dataVersion ?? null,
    toVersion: next.dataVersion,
    generatedAt,
    claims: {
      added: added.map(ref).sort(byId),
      removed: removed.map(ref).sort(byId),
      changed: changed.sort((a, b) => a.toId.localeCompare(b.toId)),
      refreshed: refreshed.sort(byId),
      statusChanged: statusChanged.sort(byId),
    },
    catalog: {
      added: sortIds([...nextCat.keys()].filter((k) => !prevCat.has(k))),
      removed: sortIds([...prevCat.keys()].filter((k) => !nextCat.has(k))),
      changed: sortIds([...nextCat.keys()].filter((k) => prevCat.has(k) && prevCat.get(k) !== nextCat.get(k))),
    },
  };
}

export function changelogIsEmpty(log: Changelog): boolean {
  const c = log.claims;
  return [c.added, c.removed, c.changed, c.refreshed, c.statusChanged, log.catalog.added, log.catalog.removed, log.catalog.changed]
    .every((list) => list.length === 0);
}
