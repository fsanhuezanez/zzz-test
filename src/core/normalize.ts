/**
 * Normalización: envío (editorial o feed automatizado) → claims canónicos.
 *
 * Aquí se aplican las reglas semánticas que un JSON Schema no expresa bien:
 * referencias al catálogo, coherencia entre tipo de fuente y tipo de evidencia,
 * escalas de tier, ranuras de Drive Disc, URL dentro del dominio de la fuente…
 */
import type { Claim, ClaimFlag, ClaimKind, EditorialSubmission, InputClaim } from '../schema/claims.ts';
import type { CollectionMethod, Provenance, Stat } from '../schema/common.ts';
import type { Source } from '../schema/sources.ts';
import { CatalogIndex, ResolveError, type EntityType } from './catalog.ts';
import { shortHash } from './canonical.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Claim antes del ciclo de vida (estado, flags finales y fechas los asigna lifecycle.ts). */
export type DraftClaim = DistributiveOmit<Claim, 'status' | 'flags' | 'firstSeenAt' | 'supersededBy'> & {
  retracted: boolean;
  initialFlags: ClaimFlag[];
  origin: string;
};

export interface InputIssue {
  file: string;
  path: string;
  message: string;
}

const SLOT_RULES: Record<'slot4' | 'slot5' | 'slot6', Stat[]> = {
  slot4: ['hp_pct', 'atk_pct', 'def_pct', 'crit_rate', 'crit_dmg', 'anomaly_proficiency'],
  slot5: ['hp_pct', 'atk_pct', 'def_pct', 'pen_ratio', 'physical_dmg', 'fire_dmg', 'ice_dmg', 'electric_dmg', 'ether_dmg'],
  slot6: ['hp_pct', 'atk_pct', 'def_pct', 'anomaly_mastery', 'impact', 'energy_regen'],
};
const SUBSTATS: Stat[] = ['hp', 'atk', 'def', 'hp_pct', 'atk_pct', 'def_pct', 'crit_rate', 'crit_dmg', 'pen', 'anomaly_proficiency'];

const F2P_CATEGORY_TYPE: Record<string, EntityType> = {
  agent: 'agent', team: 'agent', w_engine: 'wEngine', bangboo: 'bangboo', drive_disc: 'driveDisc',
};

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function slugText(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const sorted = (ids: string[]) => [...ids].sort();

export interface NormalizeContext {
  catalog: CatalogIndex;
  sources: Map<string, Source>;
  method: CollectionMethod;
  origin: string;
}

export function normalizeSubmission(sub: EditorialSubmission, ctx: NormalizeContext): { drafts: DraftClaim[]; issues: InputIssue[] } {
  const issues: InputIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ file: ctx.origin, path, message });
  const source = ctx.sources.get(sub.sourceId);
  if (!source) {
    issue('/sourceId', `fuente "${sub.sourceId}" no registrada en data/sources.json`);
    return { drafts: [], issues };
  }
  if (!source.automation.allowedMethods.includes(ctx.method)) {
    issue('/sourceId', `la política de "${source.id}" no permite el método "${ctx.method}" (permitidos: ${source.automation.allowedMethods.join(', ')})`);
    return { drafts: [], issues };
  }

  const drafts: DraftClaim[] = [];
  const seenSlots = new Map<string, string>();

  sub.claims.forEach((input, index) => {
    const base = `/claims/${index}`;
    try {
      const draft = normalizeClaim(sub, input, source, ctx, (p, m) => issue(`${base}${p}`, m));
      if (!draft) return;
      const previous = seenSlots.get(draft.slotKey);
      if (previous && previous !== draft.id) {
        issue(base, `contradice otro claim del mismo envío para "${draft.slotKey}"; separa la información en envíos distintos o corrígela`);
        return;
      }
      if (previous === draft.id) return; // duplicado exacto dentro del envío
      seenSlots.set(draft.slotKey, draft.id);
      drafts.push(draft);
    } catch (err) {
      if (err instanceof ResolveError) issue(base, err.message);
      else throw err;
    }
  });
  return { drafts, issues };
}

function normalizeClaim(
  sub: EditorialSubmission,
  input: InputClaim,
  source: Source,
  ctx: NormalizeContext,
  issue: (path: string, message: string) => void,
): DraftClaim | null {
  const { catalog } = ctx;
  const agent = (ref: string) => catalog.resolve('agent', ref);
  const ev = input.evidence ?? {};
  const evidenceType = ev.evidenceType ?? sub.evidenceType;
  const confidence = ev.confidence ?? sub.confidence;
  const url = ev.url ?? sub.url;
  let ok = true;
  const fail = (path: string, message: string) => {
    ok = false;
    issue(path, message);
  };

  // --- coherencia fuente / evidencia (no presentar inferencias como hechos) ---
  if (source.kind === 'internal' && evidenceType !== 'internal_estimate') {
    fail('/evidence/evidenceType', `la fuente interna "${source.id}" solo puede registrar "internal_estimate"`);
  }
  if (source.kind !== 'internal' && evidenceType === 'internal_estimate') {
    fail('/evidence/evidenceType', `"internal_estimate" es una estimación propia: regístrala con la fuente interna, no atribuida a "${source.id}"`);
  }
  if (evidenceType === 'internal_estimate' && confidence === 'high') {
    fail('/evidence/confidence', 'una estimación propia no puede tener confianza "high"');
  }
  if (evidenceType === 'internal_estimate' && !ev.rationale) {
    fail('/evidence/rationale', 'una estimación propia necesita "rationale" explicando el razonamiento');
  }
  if (evidenceType === 'observed_data' && !ev.sample) {
    fail('/evidence/sample', '"observed_data" requiere describir la muestra que publica la fuente ("sample")');
  }
  if (input.kind === 'usage' && evidenceType !== 'observed_data') {
    fail('/evidence/evidenceType', 'las estadísticas de uso solo se aceptan como "observed_data" de una fuente externa; no se estiman');
  }
  if (source.kind !== 'internal' && hostOf(url) !== hostOf(source.homepage) && !hostOf(url).endsWith(`.${hostOf(source.homepage)}`)) {
    fail('/evidence/url', `la URL ${url} no pertenece al dominio de la fuente (${hostOf(source.homepage)}); la atribución debe apuntar a la página consultada`);
  }

  const mode = input.mode ?? sub.mode ?? 'general';
  const context = {
    mode,
    ...(input.modeDetail ? { modeDetail: input.modeDetail } : {}),
    ...(input.conditions?.length ? { conditions: input.conditions } : {}),
  };
  const ctxKey = `${mode}${input.modeDetail ? `/${slugText(input.modeDetail)}` : ''}`;

  let payload: Record<string, unknown>;
  let slotKey: string;
  let agentRefs: string[];

  switch (input.kind) {
    case 'tier': {
      const id = agent(input.agent);
      const scaleId = input.tierScale ?? source.defaultTierScale;
      const scale = source.tierScales.find((s) => s.id === scaleId);
      if (!scale) {
        fail('/tierScale', `la fuente "${source.id}" no tiene la escala "${scaleId ?? '(ninguna por defecto)'}"`);
        return null;
      }
      const label = scale.labels.find((l) => l.label.toLowerCase() === input.tier.toLowerCase());
      if (!label) {
        fail('/tier', `etiqueta "${input.tier}" fuera de la escala "${scale.id}" (${scale.labels.map((l) => l.label).join(', ')}). Si la fuente cambió su escala, actualiza data/sources.json`);
        return null;
      }
      payload = { agent: id, role: input.role, tier: label.label, tierScale: scale.id, score: label.score };
      slotKey = `tier:${id}:${input.role}:${ctxKey}`;
      agentRefs = [id];
      break;
    }
    case 'team': {
      const members = input.members.map((m, i) => {
        const id = agent(m.agent);
        const subs = (m.substitutes ?? []).map((s) => ({ agent: agent(s.agent), quality: s.quality, ...(s.note ? { note: s.note } : {}) }));
        if (subs.some((s) => s.agent === id)) fail(`/members/${i}/substitutes`, 'un agente no puede ser sustituto de sí mismo');
        return { agent: id, role: m.role, ...(subs.length ? { substitutes: subs } : {}) };
      });
      const ids = members.map((m) => m.agent);
      if (new Set(ids).size !== ids.length) fail('/members', 'agentes repetidos en el equipo');
      members.forEach((m, i) => {
        if (m.substitutes?.some((s) => ids.includes(s.agent))) fail(`/members/${i}/substitutes`, 'el sustituto ya forma parte del equipo');
      });
      const bangboo = input.bangboo?.map((b) => ({ bangboo: catalog.resolve('bangboo', b.bangboo), rank: b.rank }));
      payload = {
        ...(input.name ? { name: input.name } : {}),
        ...(input.archetype ? { archetype: input.archetype } : {}),
        members,
        ...(bangboo?.length ? { bangboo } : {}),
        ...(input.rating ? { rating: input.rating } : {}),
      };
      slotKey = `team:${sorted(ids).join('+')}:${ctxKey}`;
      agentRefs = [...ids, ...members.flatMap((m) => m.substitutes?.map((s) => s.agent) ?? [])];
      break;
    }
    case 'substitute': {
      const replaced = agent(input.agent);
      const substitute = agent(input.substitute);
      const withAgents = (input.withAgents ?? []).map(agent);
      if (replaced === substitute) fail('/substitute', 'el sustituto es el mismo agente');
      payload = {
        agent: replaced, substitute, quality: input.quality,
        ...(withAgents.length ? { withAgents: sorted(withAgents) } : {}),
        ...(input.archetype ? { archetype: input.archetype } : {}),
      };
      slotKey = `substitute:${replaced}:${substitute}:${sorted(withAgents).join('+') || '-'}:${ctxKey}`;
      agentRefs = [replaced, substitute, ...withAgents];
      break;
    }
    case 'synergy': {
      const ids = sorted(input.agents.map(agent));
      if (new Set(ids).size !== ids.length) fail('/agents', 'agentes repetidos');
      payload = { agents: ids, polarity: input.polarity, mechanism: input.mechanism };
      slotKey = `synergy:${ids.join('+')}:${ctxKey}`;
      agentRefs = ids;
      break;
    }
    case 'rotation': {
      const ids = input.agents.map(agent);
      payload = { agents: ids, steps: input.steps, ...(input.notation ? { notation: input.notation } : {}) };
      slotKey = `rotation:${sorted(ids).join('+')}:${ctxKey}`;
      agentRefs = ids;
      break;
    }
    case 'w_engine': {
      const id = agent(input.agent);
      const options = input.options.map((o) => ({
        wEngine: catalog.resolve('wEngine', o.wEngine), rank: o.rank,
        ...(o.f2p !== undefined ? { f2p: o.f2p } : {}),
        ...(o.note ? { note: o.note } : {}),
      }));
      checkUnique(options.map((o) => o.wEngine), '/options', 'W-Engine repetido', fail);
      payload = { agent: id, options: options.sort((a, b) => a.rank - b.rank) };
      slotKey = `w_engine:${id}:${ctxKey}`;
      agentRefs = [id];
      break;
    }
    case 'drive_disc': {
      const id = agent(input.agent);
      const fourPiece = input.fourPiece.map((d) => catalog.resolve('driveDisc', d));
      const twoPiece = input.twoPiece.map((d) => catalog.resolve('driveDisc', d));
      for (const slot of ['slot4', 'slot5', 'slot6'] as const) {
        for (const stat of input.mainStats[slot] ?? []) {
          if (!SLOT_RULES[slot].includes(stat)) fail(`/mainStats/${slot}`, `"${stat}" no puede ser estadística principal de la ranura ${slot.slice(4)}`);
        }
      }
      for (const stat of input.substats ?? []) {
        if (!SUBSTATS.includes(stat)) fail('/substats', `"${stat}" no es una subestadística posible`);
      }
      payload = { agent: id, fourPiece, twoPiece, mainStats: input.mainStats, ...(input.substats ? { substats: input.substats } : {}) };
      slotKey = `drive_disc:${id}:${ctxKey}`;
      agentRefs = [id];
      break;
    }
    case 'bangboo': {
      const id = input.agent ? agent(input.agent) : undefined;
      const team = input.team?.map(agent);
      const options = input.options.map((o) => ({ bangboo: catalog.resolve('bangboo', o.bangboo), rank: o.rank, ...(o.note ? { note: o.note } : {}) }));
      checkUnique(options.map((o) => o.bangboo), '/options', 'Bangboo repetido', fail);
      payload = { ...(id ? { agent: id } : {}), ...(team ? { team } : {}), options: options.sort((a, b) => a.rank - b.rank) };
      slotKey = `bangboo:${id ?? sorted(team ?? []).join('+')}:${ctxKey}`;
      agentRefs = [...(id ? [id] : []), ...(team ?? [])];
      break;
    }
    case 'investment': {
      const id = agent(input.agent);
      payload = {
        agent: id, aspect: input.aspect, priority: input.priority,
        ...(input.priorityLabel ? { priorityLabel: input.priorityLabel } : {}),
        ...(input.mindscape !== undefined ? { mindscape: input.mindscape } : {}),
        ...(input.note ? { note: input.note } : {}),
      };
      if (input.aspect === 'mindscape' && input.mindscape === undefined) fail('/mindscape', 'aspect "mindscape" requiere indicar el nivel (0-6)');
      slotKey = `investment:${id}:${input.aspect}:${input.mindscape ?? '-'}`;
      agentRefs = [id];
      break;
    }
    case 'f2p_option': {
      const id = input.agent ? agent(input.agent) : undefined;
      const type = F2P_CATEGORY_TYPE[input.category]!;
      const entities = input.entities.map((e) => catalog.resolve(type, e));
      const replaces = input.replaces ? catalog.resolve(type, input.replaces) : undefined;
      payload = {
        ...(id ? { agent: id } : {}), category: input.category, entities,
        ...(replaces ? { replaces } : {}), ...(input.note ? { note: input.note } : {}),
      };
      slotKey = `f2p_option:${id ?? '-'}:${input.category}:${sorted(entities).join('+')}:${ctxKey}`;
      agentRefs = [...(id ? [id] : []), ...(type === 'agent' ? [...entities, ...(replaces ? [replaces] : [])] : [])];
      break;
    }
    case 'usage': {
      const ids = sorted(input.agents.map(agent));
      if (input.unit === 'percent' && input.value > 100) fail('/value', 'un porcentaje no puede superar 100');
      if (input.unit === 'ratio' && input.value > 1) fail('/value', 'un ratio no puede superar 1');
      payload = { agents: ids, metric: input.metric, ...(input.metricLabel ? { metricLabel: input.metricLabel } : {}), value: input.value, unit: input.unit };
      slotKey = `usage:${ids.join('+')}:${input.metric}${input.metricLabel ? `/${slugText(input.metricLabel)}` : ''}:${ctxKey}`;
      agentRefs = ids;
      break;
    }
  }
  if (!ok) return null;

  const provenance: Provenance = {
    sourceId: source.id,
    url,
    accessedAt: sub.accessedAt,
    declaredPatch: sub.declaredPatch,
    evidenceType,
    confidence,
    collectionMethod: ctx.method,
    collectedBy: sub.collectedBy,
    verification: sub.verification,
    ...(ev.excerpt ? { excerpt: ev.excerpt } : {}),
    ...(ev.notes ? { notes: ev.notes } : {}),
    ...(ev.rationale ? { rationale: ev.rationale } : {}),
    ...(ev.sample ? { sample: ev.sample } : {}),
  };
  const kind: ClaimKind = input.kind;
  const id = `clm_${kind}_${shortHash({ sourceId: source.id, slotKey, declaredPatch: sub.declaredPatch, payload, context, evidenceType })}`;
  return {
    id,
    kind,
    sourceId: source.id,
    slotKey,
    agentRefs: [...new Set(agentRefs)].sort(),
    payload,
    context,
    provenance,
    retracted: input.retracted === true,
    initialFlags: [],
    origin: ctx.origin,
  } as unknown as DraftClaim;
}

function checkUnique(values: string[], path: string, message: string, fail: (p: string, m: string) => void) {
  if (new Set(values).size !== values.length) fail(path, message);
}
