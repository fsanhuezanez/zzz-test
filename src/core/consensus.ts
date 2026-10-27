/**
 * Datos derivados entre fuentes. Nunca se mezclan con los claims atribuidos:
 * viven en derived/consensus.json, marcados como cross_source_consensus + derived,
 * y referencian los claims de los que salen.
 */
import type { Claim, ClaimOf } from '../schema/claims.ts';
import type { TeamConsensus, TierConsensus } from '../schema/database.ts';
import { shortHash } from './canonical.ts';

/** Diferencia máxima de score normalizado para considerar que las fuentes coinciden. */
export const AGREEMENT_THRESHOLD = 0.2;

export const CONSENSUS_METHOD =
  'Solo claims "current" atribuidos a fuentes externas y declarados para el parche actual (se excluyen estimaciones internas). ' +
  'Tiers: se agrupan por agente+rol+modo del parche actual y se exige ≥2 fuentes distintas; score = media de las posiciones normalizadas de cada escala; ' +
  `agreement = "agree" si max-min ≤ ${AGREEMENT_THRESHOLD}. Equipos: misma composición y modo citada por ≥2 fuentes distintas. ` +
  'Es una agregación aproximada: las escalas de cada fuente no son equivalentes.';

function eligible(claim: Claim, patch: string): boolean {
  return claim.status === 'current'
    && claim.provenance.evidenceType !== 'internal_estimate'
    && claim.provenance.declaredPatch === patch;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function buildConsensus(claims: Claim[], patch: string): { tiers: TierConsensus[]; teams: TeamConsensus[] } {
  const tierGroups = new Map<string, ClaimOf<'tier'>[]>();
  const teamGroups = new Map<string, ClaimOf<'team'>[]>();
  for (const c of claims) {
    if (!eligible(c, patch)) continue;
    if (c.kind === 'tier') {
      const key = `${c.payload.agent}|${c.payload.role}|${c.context.mode}`;
      tierGroups.set(key, [...(tierGroups.get(key) ?? []), c]);
    } else if (c.kind === 'team') {
      const flex = (c.payload.flex ?? []).map((f) => `[${f.pick}:${[...f.options].sort().join('|')}]`).join('');
      const key = `${c.payload.members.map((m) => m.agent).sort().join('+')}${flex}|${c.context.mode}`;
      teamGroups.set(key, [...(teamGroups.get(key) ?? []), c]);
    }
  }

  const tiers: TierConsensus[] = [];
  for (const group of tierGroups.values()) {
    // Una entrada por fuente: la consultada más recientemente.
    const bySource = new Map<string, ClaimOf<'tier'>>();
    for (const c of group) {
      const prev = bySource.get(c.sourceId);
      if (!prev || c.provenance.accessedAt > prev.provenance.accessedAt) bySource.set(c.sourceId, c);
    }
    if (bySource.size < 2) continue;
    const entries = [...bySource.values()]
      .map((c) => ({ sourceId: c.sourceId, claimId: c.id, tier: c.payload.tier, score: c.payload.score }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const scores = entries.map((e) => e.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const first = group[0]!;
    tiers.push({
      id: `cns_tier_${shortHash({ agent: first.payload.agent, role: first.payload.role, mode: first.context.mode, patch })}`,
      agent: first.payload.agent,
      role: first.payload.role,
      mode: first.context.mode,
      patch,
      entries,
      meanScore: round(scores.reduce((a, b) => a + b, 0) / scores.length),
      minScore: min,
      maxScore: max,
      agreement: max - min <= AGREEMENT_THRESHOLD ? 'agree' : 'mixed',
      evidenceType: 'cross_source_consensus',
      collectionMethod: 'derived',
      derivedFrom: entries.map((e) => e.claimId),
    });
  }

  const teams: TeamConsensus[] = [];
  for (const group of teamGroups.values()) {
    const sources = [...new Set(group.map((c) => c.sourceId))].sort();
    if (sources.length < 2) continue;
    const first = group[0]!;
    const members = first.payload.members.map((m) => m.agent).sort();
    const flex = (first.payload.flex ?? []).map((f) => ({ pick: f.pick, options: [...f.options].sort() }));
    teams.push({
      id: `cns_team_${shortHash({ members, flex, mode: first.context.mode, patch })}`,
      members,
      ...(flex.length ? { flex } : {}),
      mode: first.context.mode,
      patch,
      sources,
      evidenceType: 'cross_source_consensus',
      collectionMethod: 'derived',
      derivedFrom: group.map((c) => c.id).sort(),
    });
  }

  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  return { tiers: tiers.sort(byId), teams: teams.sort(byId) };
}
