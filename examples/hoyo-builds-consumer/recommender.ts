/**
 * Ejemplo de recomendador para Hoyo Builds. Solo usa el paquete exportado
 * (export/zzz-meta.json + zzz-meta.types.ts), igual que lo haría la app real.
 *
 * Reglas:
 *  1. Parte de EQUIPOS publicados por fuentes, nunca de la suma de tiers.
 *  2. Un hueco que la cuenta no cubre solo se rellena con lo que la evidencia
 *     documenta: sustituto de la misma fuente, afirmación de sustitución
 *     compatible o alternativa citada por la fuente. Si no, el equipo queda
 *     "bloqueado" y se dice qué falta.
 *  3. El orden es transparente (no es una puntuación): verificado antes que
 *     pendiente, vigente antes que antiguo, "ranked/recommended" antes que
 *     "showcase", más confianza, no económico antes que económico, más fuentes
 *     distintas que documentan el núcleo original, menos sustituciones.
 *  4. Requisitos y limitaciones se muestran siempre: decide la persona.
 */
import type {
  Evidence, GameMode, SubstituteQuality, Team, TeamStance, ZzzMetaExport,
} from '../../export/zzz-meta.types.ts';

export interface Roster {
  name?: string;
  agents: string[];
  wEngines?: string[];
  bangboo?: string[];
}

export interface Slot {
  agent: string;
  /** Agente original al que sustituye, si es sustituto. */
  replaces?: string;
  via: 'owned' | 'same_source_substitute' | 'substitute_claim' | 'alternate' | 'flex';
  quality?: SubstituteQuality;
  evidence?: Evidence;
}

export interface TeamOption {
  lineup: string[];
  mode: GameMode;
  slots: Slot[];
  backing: Team[];
  sources: string[];
  /** Fuentes distintas que documentan el núcleo original (antes de sustituir). */
  coreSources: number;
  budget: boolean;
  substitutions: number;
  notes: string[];
}

export interface Blocked {
  teamId: string;
  sourceId: string;
  core: string[];
  missing: string[];
}

const STANCE: Record<TeamStance, number> = { ranked: 3, recommended: 2, showcase: 1 };
const CONFIDENCE = { high: 3, medium: 2, low: 1 } as const;
const QUALITY: Record<SubstituteQuality, number> = { near_equivalent: 4, workable: 3, unspecified: 2, significant_downgrade: 1 };

/** Clave de orden de una evidencia de equipo (mayor = más respaldo). */
function strength(t: Team): number[] {
  const e = t.evidence;
  return [e.review === 'verified' ? 1 : 0, e.status === 'current' ? 1 : 0, STANCE[t.stance], CONFIDENCE[e.confidence], e.collectionMethod === 'manual_entry' ? 1 : 0];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function recommendTeams(data: ZzzMetaExport, roster: Roster, options: {
  mode: GameMode;
  /** Incluir datos pendientes de verificar (por defecto sí, marcados). */
  includePending?: boolean;
  includeStale?: boolean;
}): { options: TeamOption[]; blocked: Blocked[] } {
  if (data.meta.isFixture) console.warn('⚠ Paquete con datos FICTICIOS de prueba.');
  const owned = new Set(roster.agents);
  const includePending = options.includePending ?? true;
  const usable = (e: Evidence) => (includePending || e.review === 'verified') && (options.includeStale || e.status === 'current');
  const modeOk = (m: GameMode) => m === options.mode || m === 'general';

  const grouped = new Map<string, TeamOption>();
  const blocked: Blocked[] = [];
  const coreSources = new Map<string, number>();
  for (const c of data.compositions) for (const id of c.teamIds) coreSources.set(id, c.support.sources.length);

  for (const team of data.teams.filter((t) => modeOk(t.mode) && usable(t.evidence))) {
    const core = team.members.map((m) => m.agent);
    const used = new Set<string>();
    const slots: Slot[] = [];
    const missing: string[] = [];
    const take = (s: Slot) => {
      used.add(s.agent);
      slots.push(s);
    };
    const free = (a: string) => owned.has(a) && !used.has(a) && !core.includes(a);

    for (const m of team.members) {
      if (owned.has(m.agent)) {
        take({ agent: m.agent, via: 'owned' });
        continue;
      }
      // Candidatos documentados, de más a menos fiable: sustituto de la misma fuente,
      // alternativa citada por la misma fuente, afirmación de sustitución externa
      // y, por último, estimación propia.
      const candidates: (Slot & { rank: number[] })[] = [
        ...m.substitutes.filter((s) => free(s.agent)).map((s) => ({
          agent: s.agent, replaces: m.agent, via: 'same_source_substitute' as const, quality: s.quality, evidence: team.evidence, rank: [3, QUALITY[s.quality]],
        })),
        ...team.alternates.filter((a) => free(a.agent)).map((a) => ({
          agent: a.agent, replaces: m.agent, via: 'alternate' as const, quality: a.quality, evidence: team.evidence, rank: [2, QUALITY[a.quality]],
        })),
        ...data.substitutes
          .filter((s) => s.agent === m.agent && free(s.substitute) && modeOk(s.mode) && usable(s.evidence) && s.withAgents.every((a) => core.includes(a)))
          .map((s) => ({
            agent: s.substitute, replaces: m.agent, via: 'substitute_claim' as const, quality: s.quality, evidence: s.evidence,
            rank: [s.evidence.evidenceType === 'internal_estimate' ? 0 : 2, QUALITY[s.quality]],
          })),
      ].sort((a, b) => compare(a.rank, b.rank));
      const best = candidates[0];
      if (best) {
        const { rank: _rank, ...slot } = best;
        take(slot);
        continue;
      }
      missing.push(m.agent);
    }
    for (const f of team.flex) {
      const picks = f.options.filter((o) => owned.has(o) && !used.has(o)).slice(0, f.pick);
      picks.forEach((agent) => take({ agent, via: 'flex' }));
      if (picks.length < f.pick) missing.push(`${f.pick - picks.length} de [${f.options.join(', ')}]`);
    }

    if (missing.length) {
      blocked.push({ teamId: team.id, sourceId: team.evidence.sourceId, core, missing });
      continue;
    }

    const lineup = slots.map((s) => s.agent).sort();
    const key = `${lineup.join('+')}@${team.mode}`;
    const option = grouped.get(key) ?? { lineup, mode: team.mode, slots, backing: [], sources: [], coreSources: 0, budget: true, substitutions: Infinity, notes: [] };
    option.coreSources = Math.max(option.coreSources, coreSources.get(team.id) ?? 1);
    option.budget &&= team.budget;
    // Los huecos mostrados salen del respaldo con menos sustituciones y, a igualdad, más fuerte.
    const subs = slots.filter((s) => s.replaces).length;
    const strongest = option.backing.length ? [...option.backing].sort((x, y) => compare(strength(x), strength(y)))[0]! : null;
    if (subs < option.substitutions || (subs === option.substitutions && strongest && compare(strength(team), strength(strongest)) < 0)) {
      option.slots = slots;
      option.substitutions = subs;
    }
    option.backing.push(team);
    if (!option.sources.includes(team.evidence.sourceId)) option.sources.push(team.evidence.sourceId);
    for (const r of team.requirements) {
      if (r.agent && !lineup.includes(r.agent)) option.notes.push(`Requisito (${r.level}) no cubierto: ${r.text}`);
      else option.notes.push(`Requisito (${r.level}): ${r.text}`);
    }
    for (const l of team.limitations) option.notes.push(`Limitación: ${l}`);
    grouped.set(key, option);
  }

  const result = [...grouped.values()].map((o) => {
    o.backing.sort((a, b) => compare(strength(a), strength(b)));
    if (o.slots.some((s) => s.evidence?.evidenceType === 'internal_estimate')) o.notes.push('Incluye una sustitución que es estimación propia, no de una fuente.');
    if (o.backing.every((t) => t.evidence.review !== 'verified')) o.notes.push('Ningún respaldo verificado todavía.');
    if (o.backing.every((t) => t.stance === 'showcase')) o.notes.push('Las fuentes solo lo muestran como opción; no lo clasifican ni recomiendan.');
    o.notes = [...new Set(o.notes)];
    return o;
  });
  result.sort((a, b) =>
    compare(strength(a.backing[0]!), strength(b.backing[0]!))
    || Number(a.budget) - Number(b.budget)
    || b.coreSources - a.coreSources
    || b.sources.length - a.sources.length
    || a.substitutions - b.substitutions
    || a.lineup.join().localeCompare(b.lineup.join()));
  return { options: result, blocked };
}

/** Para modos de dos equipos (Shiyu Defense): primera pareja sin agentes repetidos según el orden anterior. */
export function bestDisjointPair(options: TeamOption[]): [TeamOption, TeamOption] | null {
  let best: [TeamOption, TeamOption] | null = null;
  let bestRank = Infinity;
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      if (options[i]!.lineup.some((a) => options[j]!.lineup.includes(a))) continue;
      if (i + j < bestRank) {
        bestRank = i + j;
        best = [options[i]!, options[j]!];
      }
    }
  }
  return best;
}

/** Builds documentadas de un agente, marcando lo que la cuenta ya tiene. */
export function buildsFor(data: ZzzMetaExport, agent: string, roster: Roster) {
  const b = data.builds[agent];
  if (!b) return null;
  return {
    wEngines: b.wEngines.map((w) => ({
      ...w,
      options: w.options.map((o) => ({ ...o, owned: roster.wEngines ? roster.wEngines.includes(o.wEngine) : null })),
    })),
    driveDiscs: b.driveDiscs,
    f2p: b.f2p,
    investment: b.investment,
  };
}
