/**
 * Construye el paquete de exportación para Hoyo Builds a partir de la base.
 * Solo incluye datos "current" y "stale" (los reemplazados y retirados quedan
 * en db/claims.json como historial).
 */
import type { Catalog } from '../schema/catalog.ts';
import type { Claim, ClaimOf } from '../schema/claims.ts';
import type { Manifest } from '../schema/database.ts';
import type { Source } from '../schema/sources.ts';
import type {
  AgentBuilds, Composition, Evidence, GameMode, Team, ZzzMetaExport,
} from './types.ts';

const NOTICE =
  'Evidencia atribuida, no veredictos. "pending" = no comprobado en la página original; "via_search" = tomado de un resumen de buscador. '
  + 'Un tier individual no es un ranking de equipos, y un equipo documentado (showcase) no es necesariamente superior. '
  + 'Muestra siempre la fuente y el enlace.';

function evidence(c: Claim, sources: Map<string, Source>): Evidence {
  const p = c.provenance;
  return {
    claimId: c.id,
    sourceId: c.sourceId,
    sourceName: sources.get(c.sourceId)?.name ?? c.sourceId,
    url: p.url,
    accessedAt: p.accessedAt,
    ...(p.pageUpdatedAt ? { pageUpdatedAt: p.pageUpdatedAt } : {}),
    declaredPatch: p.declaredPatch,
    evidenceType: p.evidenceType as Evidence['evidenceType'],
    confidence: p.confidence,
    collectionMethod: p.collectionMethod as Evidence['collectionMethod'],
    review: p.verification.state === 'verified' ? 'verified' : 'pending',
    status: c.status as Evidence['status'],
    flags: c.flags.filter((f) => f !== 'unverified'),
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.rationale ? { rationale: p.rationale } : {}),
  };
}

const live = (c: Claim) => c.status === 'current' || c.status === 'stale';
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
const review = (state: string) => (state === 'verified' ? 'verified' as const : 'pending' as const);

function emptyBuilds(): AgentBuilds {
  return { wEngines: [], driveDiscs: [], bangboo: [], investment: [], f2p: [] };
}

export function buildExport(args: { manifest: Manifest; catalog: Catalog; sources: Source[]; claims: Claim[] }): ZzzMetaExport {
  const sources = new Map(args.sources.map((s) => [s.id, s]));
  const claims = args.claims.filter(live);
  const of = <K extends Claim['kind']>(kind: K) => claims.filter((c): c is ClaimOf<K> => c.kind === kind);
  const ev = (c: Claim) => evidence(c, sources);
  const mode = (c: Claim) => c.context.mode as GameMode;

  const teams: Team[] = of('team').map((c) => ({
    id: c.id,
    mode: mode(c),
    ...(c.context.modeDetail ? { modeDetail: c.context.modeDetail } : {}),
    conditions: c.context.conditions ?? [],
    ...(c.payload.name ? { name: c.payload.name } : {}),
    ...(c.payload.archetype ? { archetype: c.payload.archetype } : {}),
    stance: c.payload.stance,
    budget: c.payload.budget === true,
    ...(c.payload.rating ? { rating: c.payload.rating } : {}),
    members: c.payload.members.map((m) => ({ agent: m.agent, role: m.role, substitutes: m.substitutes ?? [] })),
    flex: c.payload.flex ?? [],
    alternates: c.payload.alternates ?? [],
    requirements: c.payload.requirements ?? [],
    limitations: c.payload.limitations ?? [],
    bangboo: c.payload.bangboo ?? [],
    evidence: ev(c),
  })).sort(byId);

  const compositions = new Map<string, Composition>();
  for (const t of teams) {
    const core = t.members.map((m) => m.agent).sort();
    const flex = t.flex.map((f) => ({ ...f, options: [...f.options].sort() }));
    const key = `${core.join('+')}${flex.map((f) => `[${f.pick}:${f.options.join('|')}]`).join('')}@${t.mode}`;
    const entry = compositions.get(key) ?? {
      key, mode: t.mode, core, flex, teamIds: [],
      support: { sources: [], verifiedSources: [], stances: [], hasCurrentEvidence: false },
    };
    entry.teamIds.push(t.id);
    const s = entry.support;
    if (!s.sources.includes(t.evidence.sourceId)) s.sources.push(t.evidence.sourceId);
    if (t.evidence.review === 'verified' && !s.verifiedSources.includes(t.evidence.sourceId)) s.verifiedSources.push(t.evidence.sourceId);
    if (!s.stances.includes(t.stance)) s.stances.push(t.stance);
    if (t.evidence.status === 'current') s.hasCurrentEvidence = true;
    compositions.set(key, entry);
  }

  const builds: Record<string, AgentBuilds> = {};
  const buildsFor = (agent: string) => (builds[agent] ??= emptyBuilds());
  for (const c of of('w_engine')) buildsFor(c.payload.agent).wEngines.push({ options: c.payload.options, mode: mode(c), evidence: ev(c) });
  for (const c of of('drive_disc')) {
    buildsFor(c.payload.agent).driveDiscs.push({
      fourPiece: c.payload.fourPiece, twoPiece: c.payload.twoPiece, mainStats: c.payload.mainStats,
      substats: c.payload.substats ?? [], statTargets: c.payload.statTargets ?? [], mode: mode(c), evidence: ev(c),
    });
  }
  for (const c of of('bangboo')) {
    const targets = c.payload.agent ? [c.payload.agent] : (c.payload.team ?? []);
    for (const a of targets) {
      buildsFor(a).bangboo.push({ options: c.payload.options, ...(c.payload.team ? { team: c.payload.team } : {}), mode: mode(c), evidence: ev(c) });
    }
  }
  for (const c of of('investment')) {
    const { agent, ...rest } = c.payload;
    buildsFor(agent).investment.push({ ...rest, evidence: ev(c) });
  }
  for (const c of of('f2p_option')) {
    const { agent, ...rest } = c.payload;
    const targets = agent ? [agent] : c.payload.category === 'team' ? c.payload.entities : [];
    for (const a of targets) buildsFor(a).f2p.push({ ...rest, evidence: ev(c) });
  }

  const counted = [...teams.map((t) => t.evidence), ...claims.filter((c) => c.kind !== 'team').map(ev)];
  return {
    meta: {
      format: 'zzz-meta-export',
      formatVersion: 1,
      dataVersion: args.manifest.dataVersion,
      gamePatch: args.manifest.gamePatch,
      generatedAt: args.manifest.generatedAt,
      contentHash: args.manifest.contentHash,
      isFixture: args.manifest.isFixture,
      counts: {
        teams: teams.length,
        verified: counted.filter((e) => e.review === 'verified').length,
        pending: counted.filter((e) => e.review === 'pending').length,
        stale: counted.filter((e) => e.status === 'stale').length,
      },
      notice: NOTICE,
    },
    sources: args.sources.map((s) => ({ id: s.id, name: s.name, homepage: s.homepage, attribution: s.attribution, automation: s.automation.status })),
    agents: args.catalog.agents.map((a) => ({
      id: a.id, name: a.name, aliases: a.aliases, review: review(a.provenance.verification.state),
      ...(a.rarity ? { rarity: a.rarity } : {}), ...(a.attribute ? { attribute: a.attribute } : {}),
      ...(a.specialty ? { specialty: a.specialty } : {}), ...(a.faction ? { faction: a.faction } : {}),
    })),
    wEngines: args.catalog.wEngines.map((w) => ({ id: w.id, name: w.name, aliases: w.aliases, review: review(w.provenance.verification.state) })),
    driveDiscs: args.catalog.driveDiscs.map((d) => ({ id: d.id, name: d.name, aliases: d.aliases, review: review(d.provenance.verification.state) })),
    bangboo: args.catalog.bangboo.map((b) => ({ id: b.id, name: b.name, aliases: b.aliases, review: review(b.provenance.verification.state) })),
    teams,
    compositions: [...compositions.values()].sort((a, b) => a.key.localeCompare(b.key)),
    substitutes: of('substitute').map((c) => ({
      agent: c.payload.agent, substitute: c.payload.substitute, quality: c.payload.quality,
      withAgents: c.payload.withAgents ?? [], ...(c.payload.archetype ? { archetype: c.payload.archetype } : {}),
      mode: mode(c), evidence: ev(c),
    })),
    builds,
    tiers: of('tier').map((c) => ({
      agent: c.payload.agent, role: c.payload.role, tier: c.payload.tier, tierScale: c.payload.tierScale,
      scoreInScale: c.payload.score, mode: mode(c), evidence: ev(c),
    })),
    synergies: of('synergy').map((c) => ({ ...c.payload, mode: mode(c), evidence: ev(c) })),
    rotations: of('rotation').map((c) => ({ ...c.payload, mode: mode(c), evidence: ev(c) })),
  };
}
