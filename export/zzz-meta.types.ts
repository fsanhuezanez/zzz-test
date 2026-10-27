/**
 * Tipos del paquete de exportación para Hoyo Builds (export/zzz-meta.json).
 *
 * Este fichero NO importa nada: se copia tal cual a export/zzz-meta.types.ts
 * para que el proyecto consumidor lo use sin depender de este repositorio.
 *
 * Principio: la base describe la evidencia; no decide qué equipo es mejor para
 * cada cuenta. El orden y la selección final son responsabilidad del consumidor.
 */

/** verified = una segunda persona lo comprobó en la página original. pending = falta comprobarlo. */
export type ReviewState = 'verified' | 'pending';
export type ClaimStatus = 'current' | 'stale';
export type EvidenceType = 'explicit_recommendation' | 'observed_data' | 'internal_estimate';
export type Confidence = 'high' | 'medium' | 'low';
export type CollectionMethod = 'manual_entry' | 'web_search';
export type GameMode = 'general' | 'shiyu_defense' | 'deadly_assault' | 'lost_void' | 'other';
export type TeamRole = 'main_dps' | 'sub_dps' | 'stunner' | 'support' | 'anomaly' | 'defense' | 'flex';
export type SubstituteQuality = 'near_equivalent' | 'workable' | 'significant_downgrade' | 'unspecified';
/** ranked: la fuente lo clasifica en un ranking de equipos. recommended: lo recomienda. showcase: solo lo muestra. */
export type TeamStance = 'ranked' | 'recommended' | 'showcase';

/** Procedencia resumida de una recomendación. */
export interface Evidence {
  claimId: string;
  sourceId: string;
  sourceName: string;
  url: string;
  accessedAt: string;
  pageUpdatedAt?: string;
  /** Parche que declara la fuente; null si no lo declara. */
  declaredPatch: string | null;
  evidenceType: EvidenceType;
  confidence: Confidence;
  collectionMethod: CollectionMethod;
  review: ReviewState;
  status: ClaimStatus;
  /** p. ej. "via_search", "patch_undeclared", "older_patch", "pre_release". */
  flags: string[];
  notes?: string;
  rationale?: string;
}

export interface Substitute {
  agent: string;
  quality: SubstituteQuality;
  note?: string;
}

export interface TeamMember {
  agent: string;
  role: TeamRole;
  /** Sustitutos que la MISMA fuente da para este hueco. */
  substitutes: Substitute[];
}

export interface FlexSlot {
  /** Cuántos agentes elegir de `options`. */
  pick: number;
  role?: TeamRole;
  options: string[];
}

export interface Requirement {
  text: string;
  agent?: string;
  level: 'required' | 'recommended';
}

/** Un equipo tal como lo publica UNA fuente. */
export interface Team {
  id: string;
  mode: GameMode;
  modeDetail?: string;
  conditions: string[];
  name?: string;
  archetype?: string;
  stance: TeamStance;
  /** La fuente lo presenta como opción económica / F2P. */
  budget: boolean;
  rating?: { label: string; scale?: string };
  members: TeamMember[];
  flex: FlexSlot[];
  /** Alternativas que la fuente cita sin indicar a quién reemplazan. */
  alternates: Substitute[];
  requirements: Requirement[];
  limitations: string[];
  bangboo: { bangboo: string; rank: number }[];
  evidence: Evidence;
}

/** Afirmación general de sustitución ("X puede reemplazar a Y junto a Z"). */
export interface SubstituteClaim {
  agent: string;
  substitute: string;
  quality: SubstituteQuality;
  withAgents: string[];
  archetype?: string;
  mode: GameMode;
  evidence: Evidence;
}

/**
 * Agrupa los equipos de distintas fuentes con el mismo núcleo y modo.
 * `support` resume el respaldo; no es una puntuación.
 */
export interface Composition {
  key: string;
  mode: GameMode;
  core: string[];
  flex: FlexSlot[];
  teamIds: string[];
  support: {
    sources: string[];
    verifiedSources: string[];
    stances: TeamStance[];
    hasCurrentEvidence: boolean;
  };
}

export interface WEngineRecommendation {
  options: { wEngine: string; rank: number; f2p?: boolean; note?: string }[];
  mode: GameMode;
  evidence: Evidence;
}

export interface DriveDiscRecommendation {
  fourPiece: string[];
  twoPiece: string[];
  mainStats: { slot4?: string[]; slot5?: string[]; slot6?: string[] };
  substats: string[];
  statTargets: { stat: string; min: number; note?: string }[];
  mode: GameMode;
  evidence: Evidence;
}

export interface BangbooRecommendation {
  options: { bangboo: string; rank: number; note?: string }[];
  team?: string[];
  mode: GameMode;
  evidence: Evidence;
}

export interface InvestmentRecommendation {
  aspect: 'mindscape' | 'signature_w_engine' | 'skills' | 'core_skill' | 'general';
  priority: 'high' | 'medium' | 'low';
  priorityLabel?: string;
  mindscape?: number;
  note?: string;
  evidence: Evidence;
}

export interface F2POption {
  category: 'agent' | 'w_engine' | 'bangboo' | 'drive_disc' | 'team';
  entities: string[];
  replaces?: string;
  note?: string;
  evidence: Evidence;
}

export interface AgentBuilds {
  wEngines: WEngineRecommendation[];
  driveDiscs: DriveDiscRecommendation[];
  bangboo: BangbooRecommendation[];
  investment: InvestmentRecommendation[];
  f2p: F2POption[];
}

/** Valoración INDIVIDUAL de un agente. No es un ranking de equipos. */
export interface TierEntry {
  agent: string;
  role: string;
  tier: string;
  tierScale: string;
  /** Posición dentro de la escala de esa fuente (1 = mejor). No comparable entre fuentes. */
  scoreInScale: number;
  mode: GameMode;
  evidence: Evidence;
}

export interface Synergy {
  agents: string[];
  polarity: 'positive' | 'negative' | 'conditional';
  mechanism: string;
  mode: GameMode;
  evidence: Evidence;
}

export interface Rotation {
  agents: string[];
  steps: string[];
  notation?: string;
  mode: GameMode;
  evidence: Evidence;
}

export interface CatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  review: ReviewState;
}

export interface AgentEntry extends CatalogEntry {
  rarity?: string;
  attribute?: string;
  specialty?: string;
  faction?: string;
}

export interface SourceEntry {
  id: string;
  name: string;
  homepage: string;
  attribution: string;
  automation: 'allowed' | 'disallowed' | 'unknown';
}

export interface ZzzMetaExport {
  meta: {
    format: 'zzz-meta-export';
    formatVersion: 1;
    dataVersion: string;
    gamePatch: string;
    generatedAt: string;
    contentHash: string;
    /** true = contiene fuentes ficticias de prueba. Nunca usar para recomendar. */
    isFixture: boolean;
    counts: { teams: number; verified: number; pending: number; stale: number };
    notice: string;
  };
  sources: SourceEntry[];
  agents: AgentEntry[];
  wEngines: CatalogEntry[];
  driveDiscs: CatalogEntry[];
  bangboo: CatalogEntry[];
  teams: Team[];
  compositions: Composition[];
  substitutes: SubstituteClaim[];
  builds: Record<string, AgentBuilds>;
  tiers: TierEntry[];
  synergies: Synergy[];
  rotations: Rotation[];
}
