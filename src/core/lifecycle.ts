/**
 * Ciclo de vida de los claims: deduplicación, reemplazo (superseded),
 * caducidad (stale) y flags de revisión.
 */
import type { Claim, ClaimFlag, ClaimStatus } from '../schema/claims.ts';
import type { PatchCalendarFile, Source } from '../schema/sources.ts';
import { CatalogIndex, type EntityType } from './catalog.ts';
import type { DraftClaim } from './normalize.ts';
import { comparePatch, daysBetween, toIsoDate } from './patch.ts';

export interface LifecycleContext {
  currentPatch: string;
  now: Date;
  sources: Map<string, Source>;
  calendar: PatchCalendarFile['patches'];
  catalog: CatalogIndex;
  /** firstSeenAt de la base anterior, para conservar la fecha de primera aparición. */
  previousFirstSeen: Map<string, string>;
}

/** Parche vigente en una fecha según el calendario (null si el calendario no lo cubre). */
export function patchAtDate(calendar: PatchCalendarFile['patches'], isoDate: string): string | null {
  const candidates = calendar.filter((p) => p.releaseDate <= isoDate).sort((a, b) => comparePatch(b.patch, a.patch));
  return candidates[0]?.patch ?? null;
}

/** Parche declarado o, si no lo hay, el vigente cuando se actualizó la página (o cuando se consultó). */
function effectivePatch(draft: DraftClaim, calendar: PatchCalendarFile['patches']): string | null {
  const p = draft.provenance;
  return p.declaredPatch ?? patchAtDate(calendar, p.pageUpdatedAt ?? p.accessedAt);
}

/** Orden "más reciente primero": parche efectivo, luego fecha de consulta, luego id (desempate estable). */
function newerFirst(calendar: PatchCalendarFile['patches']) {
  return (a: DraftClaim, b: DraftClaim): number => {
    const pa = effectivePatch(a, calendar) ?? '0.0';
    const pb = effectivePatch(b, calendar) ?? '0.0';
    const byPatch = comparePatch(pb, pa);
    if (byPatch !== 0) return byPatch;
    if (a.provenance.accessedAt !== b.provenance.accessedAt) return a.provenance.accessedAt < b.provenance.accessedAt ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  };
}

/** Mismo id = mismo dato. Se conserva la copia consultada más recientemente. */
export function dedupe(drafts: DraftClaim[]): DraftClaim[] {
  const byId = new Map<string, DraftClaim>();
  for (const d of drafts) {
    const prev = byId.get(d.id);
    if (!prev || d.provenance.accessedAt > prev.provenance.accessedAt) byId.set(d.id, d);
  }
  return [...byId.values()];
}

const ENTITY_FIELDS: Record<string, EntityType> = { agent: 'agent', substitute: 'agent', wEngine: 'wEngine', bangboo: 'bangboo' };

export function catalogRefs(claim: DraftClaim | Claim): [EntityType, string][] {
  const refs: [EntityType, string][] = claim.agentRefs.map((id) => ['agent', id]);
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      const type = ENTITY_FIELDS[k];
      if (type && typeof v === 'string') refs.push([type, v]);
      else walk(v);
    }
  };
  walk(claim.payload);
  if (claim.kind === 'drive_disc') {
    for (const id of [...claim.payload.fourPiece, ...claim.payload.twoPiece]) refs.push(['driveDisc', id]);
  }
  if (claim.kind === 'f2p_option' && claim.payload.category !== 'agent' && claim.payload.category !== 'team') {
    const type = ({ w_engine: 'wEngine', bangboo: 'bangboo', drive_disc: 'driveDisc' } as const)[claim.payload.category];
    for (const id of [...claim.payload.entities, ...(claim.payload.replaces ? [claim.payload.replaces] : [])]) refs.push([type, id]);
  }
  return refs;
}

export function applyLifecycle(drafts: DraftClaim[], ctx: LifecycleContext): Claim[] {
  const unique = dedupe(drafts);
  const groups = new Map<string, DraftClaim[]>();
  for (const d of unique) {
    // Mismo dato = misma fuente, misma página y mismo hueco. Dos páginas de una fuente pueden coexistir.
    const key = `${d.sourceId}|${d.provenance.url}|${d.slotKey}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const out: Claim[] = [];
  const order = newerFirst(ctx.calendar);
  for (const group of groups.values()) {
    group.sort(order);
    const head = group[0]!;
    group.forEach((draft, i) => {
      const flags = new Set<ClaimFlag>();
      const p = draft.provenance;
      const source = ctx.sources.get(draft.sourceId)!;
      const eff = effectivePatch(draft, ctx.calendar);

      if (p.verification.state !== 'verified') flags.add('unverified');
      if (p.declaredPatch === null) flags.add('patch_undeclared');
      if (eff && comparePatch(eff, ctx.currentPatch) < 0) flags.add('older_patch');
      if (daysBetween(p.accessedAt, ctx.now) > source.maxAgeDays) flags.add('access_too_old');
      const release = p.declaredPatch ? ctx.calendar.find((c) => c.patch === p.declaredPatch)?.releaseDate : undefined;
      if ((release && p.accessedAt < release) || (p.declaredPatch && comparePatch(p.declaredPatch, ctx.currentPatch) > 0)) {
        flags.add('pre_release');
      }
      if (p.collectionMethod === 'web_search') flags.add('via_search');
      if (catalogRefs(draft).some(([type, id]) => !ctx.catalog.isVerified(type, id))) flags.add('unverified_catalog_refs');

      let status: ClaimStatus;
      if (i > 0) status = 'superseded';
      else if (draft.retracted) status = 'retracted';
      else if (flags.has('older_patch') || flags.has('access_too_old')) status = 'stale';
      else status = 'current';

      const { retracted: _r, origin: _o, ...rest } = draft;
      out.push({
        ...rest,
        status,
        flags: [...flags].sort(),
        firstSeenAt: ctx.previousFirstSeen.get(draft.id) ?? toIsoDate(ctx.now),
        ...(i > 0 ? { supersededBy: head.id } : {}),
      } as Claim);
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
