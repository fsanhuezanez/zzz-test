/**
 * Ejemplo de recomendador para Hoyo Builds: combina la evidencia competitiva
 * con el roster real de una cuenta.
 *
 * Principios:
 *  1. La unidad de recomendación es el EQUIPO citado por una fuente, no la suma
 *     de tiers individuales. Un agente T0 no mejora un equipo que ninguna
 *     fuente avala.
 *  2. Un hueco solo se rellena con sustitutos que alguna fuente (o una
 *     estimación interna, con menor peso) declara para ese equipo/agente.
 *  3. Los tiers individuales solo desempatan y se muestran como contexto.
 *  4. Cada sugerencia lleva la evidencia y la atribución que la sostienen.
 *
 * Los pesos son heurísticas de ESTE ejemplo, no datos: ajústalos en tu app.
 */
import type { MetaDatabase } from '../../src/client/index.ts';
import type { ClaimOf, Confidence, EvidenceType, GameMode, SubstituteQuality } from '../../src/client/index.ts';

export interface Roster {
  agents: string[];
  wEngines?: string[];
  bangboo?: string[];
}

export interface Slot {
  original: string;
  chosen: string;
  role: string;
  substitution?: { quality: SubstituteQuality; basis: 'team_claim' | 'substitute_claim'; claimId: string; evidenceType: EvidenceType };
}

export interface EvidenceRef {
  claimId: string;
  sourceId: string;
  evidenceType: EvidenceType;
  confidence: Confidence;
  status: string;
  flags: string[];
  attribution: string;
  weight: number;
}

export interface TeamSuggestion {
  members: string[];
  slots: Slot[];
  mode: GameMode;
  score: number;
  independentSources: number;
  evidence: EvidenceRef[];
  tierContext: { agent: string; tier: string; sourceId: string }[];
  warnings: string[];
}

export interface NearMiss {
  teamClaimId: string;
  members: string[];
  missing: string[];
  attribution: string;
}

const EVIDENCE_WEIGHT: Record<EvidenceType, number> = {
  explicit_recommendation: 1,
  observed_data: 1,
  cross_source_consensus: 1,
  internal_estimate: 0.4,
};
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.75, low: 0.5 };
const STATUS_WEIGHT: Record<string, number> = { current: 1, stale: 0.5 };
const SUBSTITUTE_FACTOR: Record<SubstituteQuality, number> = {
  near_equivalent: 0.9, workable: 0.75, unspecified: 0.65, significant_downgrade: 0.5,
};
const UNVERIFIED_FACTOR = 0.85;
const NEGATIVE_SYNERGY_FACTOR = 0.8;
/** Peso máximo del contexto de tiers: suficiente para desempatar, nunca para decidir. */
const TIER_TIEBREAK = 0.02;

function claimWeight(c: ClaimOf<'team'> | ClaimOf<'substitute'>): number {
  const p = c.provenance;
  return EVIDENCE_WEIGHT[p.evidenceType] * CONFIDENCE_WEIGHT[p.confidence] * (STATUS_WEIGHT[c.status] ?? 0)
    * (c.flags.includes('unverified') ? UNVERIFIED_FACTOR : 1);
}

export function recommendTeams(db: MetaDatabase, roster: Roster, options: { mode: GameMode; includeStale?: boolean }): {
  suggestions: TeamSuggestion[];
  nearMisses: NearMiss[];
} {
  const owned = new Set(roster.agents);
  const status = options.includeStale ? (['current', 'stale'] as const) : (['current'] as const);
  const modeOk = (m: GameMode) => m === options.mode || m === 'general';
  const teams = db.claims({ kind: 'team', status: [...status] }).filter((c) => modeOk(c.context.mode));
  const substituteClaims = db.claims({ kind: 'substitute', status: [...status] }).filter((c) => modeOk(c.context.mode));

  const grouped = new Map<string, TeamSuggestion>();
  const nearMisses: NearMiss[] = [];

  for (const team of teams) {
    const memberIds = team.payload.members.map((m) => m.agent);
    const slots: Slot[] = [];
    const missing: string[] = [];
    let factor = 1;
    const used = new Set<string>();

    for (const member of team.payload.members) {
      if (owned.has(member.agent)) {
        slots.push({ original: member.agent, chosen: member.agent, role: member.role });
        used.add(member.agent);
        continue;
      }
      // Sustitutos declarados en el propio claim de equipo (misma fuente).
      const inline = (member.substitutes ?? [])
        .filter((s) => owned.has(s.agent) && !used.has(s.agent) && !memberIds.includes(s.agent))
        .map((s) => ({ agent: s.agent, quality: s.quality, basis: 'team_claim' as const, claimId: team.id, evidenceType: team.provenance.evidenceType, w: SUBSTITUTE_FACTOR[s.quality] }));
      // Sustituciones generales cuyo contexto (withAgents) encaja con este equipo.
      const general = substituteClaims
        .filter((s) => s.payload.agent === member.agent && owned.has(s.payload.substitute) && !used.has(s.payload.substitute)
          && !memberIds.includes(s.payload.substitute)
          && (s.payload.withAgents ?? []).every((a) => memberIds.includes(a)))
        .map((s) => ({ agent: s.payload.substitute, quality: s.payload.quality, basis: 'substitute_claim' as const, claimId: s.id, evidenceType: s.provenance.evidenceType, w: SUBSTITUTE_FACTOR[s.payload.quality] * claimWeight(s) }));
      const best = [...inline, ...general].sort((a, b) => b.w - a.w)[0];
      if (!best) {
        missing.push(member.agent);
        continue;
      }
      factor *= best.w;
      used.add(best.agent);
      slots.push({
        original: member.agent, chosen: best.agent, role: member.role,
        substitution: { quality: best.quality, basis: best.basis, claimId: best.claimId, evidenceType: best.evidenceType },
      });
    }

    if (missing.length) {
      nearMisses.push({ teamClaimId: team.id, members: memberIds, missing, attribution: db.attribution(team) });
      continue;
    }

    const lineup = slots.map((s) => s.chosen).sort();
    const key = `${lineup.join('+')}|${team.context.mode}`;
    const weight = claimWeight(team) * factor;
    const entry = grouped.get(key) ?? {
      members: lineup, slots, mode: team.context.mode, score: 0, independentSources: 0, evidence: [], tierContext: [], warnings: [],
    };
    entry.evidence.push({
      claimId: team.id, sourceId: team.sourceId, evidenceType: team.provenance.evidenceType, confidence: team.provenance.confidence,
      status: team.status, flags: team.flags, attribution: db.attribution(team), weight: Math.round(weight * 1000) / 1000,
    });
    // Si varias fuentes llegan a la misma alineación, se conserva la que menos sustituye.
    if (slots.filter((s) => s.substitution).length < entry.slots.filter((s) => s.substitution).length) entry.slots = slots;
    grouped.set(key, entry);
  }

  const suggestions = [...grouped.values()].map((s) => {
    // Agregación con rendimientos decrecientes por fuente independiente.
    const bySource = new Map<string, number>();
    for (const e of s.evidence) bySource.set(e.sourceId, Math.max(bySource.get(e.sourceId) ?? 0, e.weight));
    const weights = [...bySource.values()].sort((a, b) => b - a);
    let score = weights.reduce((acc, w, i) => acc + w * (i === 0 ? 1 : 0.35), 0);

    for (const syn of db.claims({ kind: 'synergy' })) {
      if (syn.payload.polarity === 'negative' && syn.payload.agents.every((a) => s.members.includes(a))) {
        score *= NEGATIVE_SYNERGY_FACTOR;
        s.warnings.push(`Sinergia negativa declarada: ${db.attribution(syn)}`);
      }
    }

    const tiers = s.members.flatMap((agent) => db.claims({ kind: 'tier', agent }).filter((t) => modeOk(t.context.mode)));
    s.tierContext = tiers.map((t) => ({ agent: t.payload.agent, tier: t.payload.tier, sourceId: t.sourceId }));
    const meanTier = tiers.length ? tiers.reduce((a, t) => a + t.payload.score, 0) / tiers.length : 0;
    score += TIER_TIEBREAK * meanTier;

    if (s.slots.some((slot) => slot.substitution?.evidenceType === 'internal_estimate')) {
      s.warnings.push('Incluye una sustitución basada en una estimación interna, no en una fuente externa.');
    }
    if (s.evidence.every((e) => e.status !== 'current')) s.warnings.push('Toda la evidencia es de un parche anterior o está caducada.');
    return { ...s, score: Math.round(score * 1000) / 1000, independentSources: bySource.size };
  });

  suggestions.sort((a, b) => b.score - a.score || a.members.join().localeCompare(b.members.join()));
  return { suggestions, nearMisses };
}

/** Para modos con dos equipos (p. ej. Shiyu Defense): mejor par sin agentes repetidos. */
export function bestDisjointPair(suggestions: TeamSuggestion[]): [TeamSuggestion, TeamSuggestion] | null {
  let best: [TeamSuggestion, TeamSuggestion] | null = null;
  let bestScore = -1;
  for (let i = 0; i < suggestions.length; i++) {
    for (let j = i + 1; j < suggestions.length; j++) {
      const a = suggestions[i]!;
      const b = suggestions[j]!;
      if (a.members.some((m) => b.members.includes(m))) continue;
      if (a.score + b.score > bestScore) {
        bestScore = a.score + b.score;
        best = [a, b];
      }
    }
  }
  return best;
}

/** Recomendaciones de equipo (W-Engine, Drive Discs, Bangboo) para un agente, filtradas por lo que se posee. */
export function gearFor(db: MetaDatabase, agent: string, roster: Roster) {
  const wEngines = db.claims({ kind: 'w_engine', agent }).map((c) => ({
    attribution: db.attribution(c),
    options: c.payload.options.map((o) => ({ ...o, name: db.wEngines.get(o.wEngine)?.name ?? o.wEngine, owned: roster.wEngines?.includes(o.wEngine) ?? null })),
  }));
  const driveDiscs = db.claims({ kind: 'drive_disc', agent }).map((c) => ({ attribution: db.attribution(c), ...c.payload }));
  const f2p = db.claims({ kind: 'f2p_option', agent }).map((c) => ({ attribution: db.attribution(c), ...c.payload }));
  return { wEngines, driveDiscs, f2p };
}
