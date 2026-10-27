/**
 * Punto de entrada de tipos para consumidores TypeScript (`zzz-meta-knowledge/types`).
 */
export * from './common.ts';
export * from './catalog.ts';
export * from './claims.ts';
export * from './sources.ts';
export * from './database.ts';

import { AgentCatalogFile, BangbooCatalogFile, DriveDiscCatalogFile, WEngineCatalogFile } from './catalog.ts';
import { Claim, EditorialSubmission } from './claims.ts';
import { AgentIndexFile, Changelog, ClaimsFile, ConsensusFile, Manifest } from './database.ts';
import { PatchCalendarFile, SourceRegistryFile } from './sources.ts';

/** Esquemas publicados en /schemas (nombre de fichero → esquema). */
export const PUBLISHED_SCHEMAS = {
  'manifest.schema.json': Manifest,
  'claim.schema.json': Claim,
  'claims-file.schema.json': ClaimsFile,
  'consensus-file.schema.json': ConsensusFile,
  'agent-index.schema.json': AgentIndexFile,
  'changelog.schema.json': Changelog,
  'agent-catalog.schema.json': AgentCatalogFile,
  'w-engine-catalog.schema.json': WEngineCatalogFile,
  'drive-disc-catalog.schema.json': DriveDiscCatalogFile,
  'bangboo-catalog.schema.json': BangbooCatalogFile,
  'source-registry.schema.json': SourceRegistryFile,
  'patch-calendar.schema.json': PatchCalendarFile,
  'editorial-submission.schema.json': EditorialSubmission,
} as const;
