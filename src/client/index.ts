/**
 * Cliente de solo lectura para consumidores (p. ej. Hoyo Builds).
 *
 *   import { loadDatabase } from 'zzz-meta-knowledge';
 *   const db = await loadDatabase('node_modules/zzz-meta-knowledge/db');
 *   db.claims({ kind: 'team', agent: 'ellen' });
 *
 * En navegador o edge, carga los JSON por tu cuenta y usa `MetaDatabase.fromFiles`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent, Bangboo, DriveDisc, WEngine } from '../schema/catalog.ts';
import type { Claim, ClaimKind, ClaimOf, ClaimStatus } from '../schema/claims.ts';
import type { Confidence, EvidenceType } from '../schema/common.ts';
import type { AgentIndexFile, ConsensusFile, Manifest, TierConsensus } from '../schema/database.ts';
import type { Source } from '../schema/sources.ts';
import { DB_FILES } from '../core/store.ts';
import { assertValid } from '../core/validate.ts';
import { AgentCatalogFile, BangbooCatalogFile, DriveDiscCatalogFile, WEngineCatalogFile } from '../schema/catalog.ts';
import { AgentIndexFile as AgentIndexSchema, ClaimsFile, ConsensusFile as ConsensusSchema, Manifest as ManifestSchema } from '../schema/database.ts';
import { SourceRegistryFile } from '../schema/sources.ts';

export type * from '../schema/index.ts';

/** Versión mayor del formato que entiende este cliente. */
export const SUPPORTED_SCHEMA_MAJOR = 1;

export interface RawFiles {
  manifest: unknown;
  agents: unknown;
  wEngines: unknown;
  driveDiscs: unknown;
  bangboo: unknown;
  sources: unknown;
  claims: unknown;
  consensus: unknown;
  index: unknown;
}

export interface ClaimQuery<K extends ClaimKind = ClaimKind> {
  kind?: K;
  agent?: string;
  sourceId?: string;
  /** Por defecto solo "current". */
  status?: ClaimStatus[];
  evidenceTypes?: EvidenceType[];
  minConfidence?: Confidence;
  /** Excluir claims con flag "unverified". */
  verifiedOnly?: boolean;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export class MetaDatabase {
  readonly manifest: Manifest;
  readonly agents: Map<string, Agent>;
  readonly wEngines: Map<string, WEngine>;
  readonly driveDiscs: Map<string, DriveDisc>;
  readonly bangboo: Map<string, Bangboo>;
  readonly sources: Map<string, Source>;
  readonly allClaims: readonly Claim[];
  readonly consensus: ConsensusFile;
  private readonly index: AgentIndexFile;
  private readonly byId: Map<string, Claim>;

  private constructor(files: RawFiles, validate: boolean) {
    const v = <T>(schema: Parameters<typeof assertValid>[0], value: unknown, label: string): T =>
      (validate ? assertValid(schema, value, label) : value) as T;
    this.manifest = v<Manifest>(ManifestSchema, files.manifest, 'manifest.json');
    const major = Number(this.manifest.schemaVersion.split('.')[0]);
    if (major !== SUPPORTED_SCHEMA_MAJOR) {
      throw new Error(`schemaVersion ${this.manifest.schemaVersion} incompatible con este cliente (soporta ${SUPPORTED_SCHEMA_MAJOR}.x)`);
    }
    const toMap = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
    this.agents = toMap(v<{ items: Agent[] }>(AgentCatalogFile, files.agents, 'agents').items);
    this.wEngines = toMap(v<{ items: WEngine[] }>(WEngineCatalogFile, files.wEngines, 'w-engines').items);
    this.driveDiscs = toMap(v<{ items: DriveDisc[] }>(DriveDiscCatalogFile, files.driveDiscs, 'drive-discs').items);
    this.bangboo = toMap(v<{ items: Bangboo[] }>(BangbooCatalogFile, files.bangboo, 'bangboo').items);
    this.sources = toMap(v<{ sources: Source[] }>(SourceRegistryFile, files.sources, 'sources').sources);
    this.allClaims = v<{ items: Claim[] }>(ClaimsFile, files.claims, 'claims').items;
    this.consensus = v<ConsensusFile>(ConsensusSchema, files.consensus, 'consensus');
    this.index = v<AgentIndexFile>(AgentIndexSchema, files.index, 'index');
    this.byId = new Map(this.allClaims.map((c) => [c.id, c]));
  }

  static fromFiles(files: RawFiles, options: { validate?: boolean } = {}): MetaDatabase {
    return new MetaDatabase(files, options.validate ?? true);
  }

  get isFixture(): boolean {
    return this.manifest.isFixture;
  }

  claim(id: string): Claim | undefined {
    return this.byId.get(id);
  }

  claims<K extends ClaimKind = ClaimKind>(query: ClaimQuery<K> = {}): ClaimOf<K>[] {
    const status = query.status ?? ['current'];
    const pool = query.agent
      ? (this.index.agents[query.agent]?.claimIds ?? []).map((id) => this.byId.get(id)!).filter(Boolean)
      : this.allClaims;
    return pool.filter((c): c is ClaimOf<K> =>
      (!query.kind || c.kind === query.kind)
      && (!query.sourceId || c.sourceId === query.sourceId)
      && status.includes(c.status)
      && (!query.evidenceTypes || query.evidenceTypes.includes(c.provenance.evidenceType))
      && (!query.minConfidence || CONFIDENCE_RANK[c.provenance.confidence] >= CONFIDENCE_RANK[query.minConfidence])
      && (!query.verifiedOnly || !c.flags.includes('unverified')));
  }

  tierConsensus(agent: string): TierConsensus[] {
    return this.consensus.tiers.filter((t) => t.agent === agent);
  }

  /** Texto de atribución obligatorio para mostrar un claim. */
  attribution(claim: Claim): string {
    const s = this.sources.get(claim.sourceId);
    return `${s?.attribution ?? claim.sourceId} — ${claim.provenance.url} (consultado ${claim.provenance.accessedAt}${claim.provenance.declaredPatch ? `, parche ${claim.provenance.declaredPatch}` : ', parche no declarado'})`;
  }

  agentName(id: string): string {
    return this.agents.get(id)?.name ?? id;
  }
}

export async function loadDatabase(dir: string, options: { validate?: boolean } = {}): Promise<MetaDatabase> {
  const read = async (rel: string) => JSON.parse(await readFile(join(dir, rel), 'utf8')) as unknown;
  return MetaDatabase.fromFiles({
    manifest: await read(DB_FILES.manifest),
    agents: await read(DB_FILES.agents),
    wEngines: await read(DB_FILES.wEngines),
    driveDiscs: await read(DB_FILES.driveDiscs),
    bangboo: await read(DB_FILES.bangboo),
    sources: await read(DB_FILES.sources),
    claims: await read(DB_FILES.claims),
    consensus: await read(DB_FILES.consensus),
    index: await read(DB_FILES.index),
  }, options);
}
