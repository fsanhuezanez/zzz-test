/**
 * Ficheros de la base generada (/db) y artefactos de cambio.
 */
import { Type, type Static } from '@sinclair/typebox';
import { GameMode, IsoDate, IsoDateTime, Obj, Patch, Slug, StringEnum, TierRole } from './common.ts';
import { Claim } from './claims.ts';

/** Versión del formato. Mayor = cambio incompatible para consumidores. */
export const SCHEMA_VERSION = '1.0.0';

export const DataVersion = Type.String({ pattern: '^[0-9]+\\.[0-9]+-r[0-9]+$', description: '"<parche>-r<revisión>", p. ej. "3.3-r2".' });

export const SourceSummary = Obj({
  id: Slug,
  name: Type.String(),
  attribution: Type.String(),
  automationStatus: StringEnum(['allowed', 'disallowed', 'unknown']),
  updateOutcome: StringEnum(['collected', 'no_input'], { description: 'collected: hay envíos válidos de esta fuente; no_input: sin datos.' }),
  lastAccessedAt: Type.Union([IsoDate, Type.Null()]),
  claimCount: Type.Integer({ minimum: 0 }),
  currentClaimCount: Type.Integer({ minimum: 0 }),
});
export type SourceSummary = Static<typeof SourceSummary>;

export const Manifest = Obj({
  $schema: Type.Optional(Type.String()),
  schemaVersion: Type.String(),
  dataVersion: DataVersion,
  gamePatch: Patch,
  revision: Type.Integer({ minimum: 1 }),
  previousDataVersion: Type.Union([DataVersion, Type.Null()]),
  generatedAt: IsoDateTime,
  contentHash: Type.String({ pattern: '^[0-9a-f]{64}$', description: 'sha256 del contenido (sin marcas de tiempo). Igual hash = misma base.' }),
  isFixture: Type.Boolean({ description: 'true si contiene fuentes ficticias de prueba. Nunca consumir en producción.' }),
  counts: Obj({
    agents: Type.Integer(), wEngines: Type.Integer(), driveDiscs: Type.Integer(), bangboo: Type.Integer(),
    claims: Type.Integer(),
    claimsByStatus: Obj({ current: Type.Integer(), stale: Type.Integer(), superseded: Type.Integer(), retracted: Type.Integer() }),
    liveClaimsByReview: Obj({ verified: Type.Integer(), pending: Type.Integer() }, { description: 'Claims current/stale según revisión humana.' }),
    tierConsensus: Type.Integer(),
    teamConsensus: Type.Integer(),
  }),
  sources: Type.Array(SourceSummary),
  files: Obj({
    agents: Type.String(), wEngines: Type.String(), driveDiscs: Type.String(), bangboo: Type.String(),
    sources: Type.String(), claims: Type.String(), consensus: Type.String(), vocabulary: Type.String(),
  }),
}, { $id: 'manifest.schema.json', title: 'Manifest' });
export type Manifest = Static<typeof Manifest>;

export const ClaimsFile = Obj({
  $schema: Type.Optional(Type.String()),
  dataVersion: DataVersion,
  items: Type.Array(Claim),
}, { $id: 'claims-file.schema.json' });
export type ClaimsFile = Static<typeof ClaimsFile>;

const DerivedMarker = {
  evidenceType: Type.Literal('cross_source_consensus'),
  collectionMethod: Type.Literal('derived'),
  derivedFrom: Type.Array(Type.String(), { minItems: 2 }),
};

export const TierConsensus = Obj({
  id: Type.String({ pattern: '^cns_tier_[0-9a-f]{12}$' }),
  agent: Slug,
  role: TierRole,
  mode: GameMode,
  patch: Patch,
  entries: Type.Array(Obj({ sourceId: Slug, claimId: Type.String(), tier: Type.String(), score: Type.Number() }), { minItems: 2 }),
  meanScore: Type.Number({ minimum: 0, maximum: 1 }),
  minScore: Type.Number({ minimum: 0, maximum: 1 }),
  maxScore: Type.Number({ minimum: 0, maximum: 1 }),
  agreement: StringEnum(['agree', 'mixed'], { description: 'agree si max-min ≤ umbral; mixed si las fuentes discrepan.' }),
  ...DerivedMarker,
});
export type TierConsensus = Static<typeof TierConsensus>;

export const TeamConsensus = Obj({
  id: Type.String({ pattern: '^cns_team_[0-9a-f]{12}$' }),
  members: Type.Array(Slug, { minItems: 1, maxItems: 3 }),
  flex: Type.Optional(Type.Array(Obj({ pick: Type.Integer(), options: Type.Array(Slug) }))),
  mode: GameMode,
  patch: Patch,
  sources: Type.Array(Slug, { minItems: 2 }),
  ...DerivedMarker,
});
export type TeamConsensus = Static<typeof TeamConsensus>;

export const ConsensusFile = Obj({
  $schema: Type.Optional(Type.String()),
  dataVersion: DataVersion,
  method: Type.String(),
  tiers: Type.Array(TierConsensus),
  teams: Type.Array(TeamConsensus),
}, { $id: 'consensus-file.schema.json' });
export type ConsensusFile = Static<typeof ConsensusFile>;

const ClaimRef = Obj({ id: Type.String(), kind: Type.String(), sourceId: Slug, slotKey: Type.String() });

export const Changelog = Obj({
  $schema: Type.Optional(Type.String()),
  fromVersion: Type.Union([DataVersion, Type.Null()]),
  toVersion: DataVersion,
  generatedAt: IsoDateTime,
  claims: Obj({
    added: Type.Array(ClaimRef),
    removed: Type.Array(ClaimRef),
    changed: Type.Array(Obj({
      sourceId: Slug, kind: Type.String(), slotKey: Type.String(),
      fromId: Type.String(), toId: Type.String(),
      fields: Type.Array(Type.String()),
    })),
    refreshed: Type.Array(ClaimRef, { description: 'Mismo dato reconsultado o re-verificado (cambia solo la procedencia).' }),
    statusChanged: Type.Array(Obj({
      id: Type.String(),
      from: Type.String(), to: Type.String(),
      flagsAdded: Type.Array(Type.String()), flagsRemoved: Type.Array(Type.String()),
    })),
  }),
  catalog: Obj({
    added: Type.Array(Type.String()),
    removed: Type.Array(Type.String()),
    changed: Type.Array(Type.String()),
  }),
}, { $id: 'changelog.schema.json' });
export type Changelog = Static<typeof Changelog>;
