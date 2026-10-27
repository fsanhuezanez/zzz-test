/**
 * Esquemas internos del pipeline. Los consumidores usan export/zzz-meta.types.ts.
 */
export * from './common.ts';
export * from './catalog.ts';
export * from './claims.ts';
export * from './sources.ts';
export * from './database.ts';

import { AgentCatalogFile, BangbooCatalogFile, DriveDiscCatalogFile, GameVocabularyFile, WEngineCatalogFile } from './catalog.ts';
import { Claim, EditorialSubmission } from './claims.ts';
import { Changelog, ClaimsFile, ConsensusFile, Manifest } from './database.ts';
import { PatchCalendarFile, SourceRegistryFile } from './sources.ts';

/** Esquemas publicados en /schemas (nombre de fichero → esquema). */
export const PUBLISHED_SCHEMAS = {
  'manifest.schema.json': Manifest,
  'claim.schema.json': Claim,
  'claims-file.schema.json': ClaimsFile,
  'consensus-file.schema.json': ConsensusFile,
  'changelog.schema.json': Changelog,
  'agent-catalog.schema.json': AgentCatalogFile,
  'w-engine-catalog.schema.json': WEngineCatalogFile,
  'drive-disc-catalog.schema.json': DriveDiscCatalogFile,
  'bangboo-catalog.schema.json': BangbooCatalogFile,
  'game-vocabulary.schema.json': GameVocabularyFile,
  'source-registry.schema.json': SourceRegistryFile,
  'patch-calendar.schema.json': PatchCalendarFile,
  'editorial-submission.schema.json': EditorialSubmission,
} as const;
