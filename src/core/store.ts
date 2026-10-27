/**
 * Lectura y escritura de la base generada.
 *
 * La escritura es atómica a nivel de directorio: se genera todo en
 * `<db>.staging`, se valida y solo entonces se intercambia con `<db>`.
 * Si algo falla antes del intercambio, la última versión válida queda intacta.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { TSchema } from '@sinclair/typebox';
import {
  AgentCatalogFile, BangbooCatalogFile, DriveDiscCatalogFile, GameVocabularyFile, WEngineCatalogFile, type Catalog, type GameVocabulary,
} from '../schema/catalog.ts';
import type { Claim } from '../schema/claims.ts';
import {
  Changelog, ClaimsFile, ConsensusFile, Manifest,
  type Changelog as ChangelogT, type ConsensusFile as Consensus, type Manifest as ManifestT,
} from '../schema/database.ts';
import { SourceRegistryFile, type Source } from '../schema/sources.ts';
import { prettyJson } from './canonical.ts';
import { assertValid } from './validate.ts';

export const DB_FILES = {
  manifest: 'manifest.json',
  agents: 'catalog/agents.json',
  wEngines: 'catalog/w-engines.json',
  driveDiscs: 'catalog/drive-discs.json',
  bangboo: 'catalog/bangboo.json',
  sources: 'sources.json',
  claims: 'claims.json',
  consensus: 'derived/consensus.json',
  vocabulary: 'game.json',
  changelog: 'changelog.json',
} as const;

const FILE_SCHEMAS: Record<keyof typeof DB_FILES, [TSchema, string]> = {
  manifest: [Manifest, 'manifest.schema.json'],
  agents: [AgentCatalogFile, 'agent-catalog.schema.json'],
  wEngines: [WEngineCatalogFile, 'w-engine-catalog.schema.json'],
  driveDiscs: [DriveDiscCatalogFile, 'drive-disc-catalog.schema.json'],
  bangboo: [BangbooCatalogFile, 'bangboo-catalog.schema.json'],
  sources: [SourceRegistryFile, 'source-registry.schema.json'],
  claims: [ClaimsFile, 'claims-file.schema.json'],
  consensus: [ConsensusFile, 'consensus-file.schema.json'],
  vocabulary: [GameVocabularyFile, 'game-vocabulary.schema.json'],
  changelog: [Changelog, 'changelog.schema.json'],
};

export interface StoredDatabase {
  manifest: ManifestT;
  catalog: Catalog;
  sources: Source[];
  claims: Claim[];
  consensus: Consensus;
  vocabulary: GameVocabulary;
  changelog: ChangelogT;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Quita la clave `$schema` (depende de la ubicación del fichero, no del contenido). */
export function withoutSchema<T extends { $schema?: string }>(value: T): Omit<T, '$schema'> {
  const { $schema: _schema, ...rest } = value;
  return rest;
}

/** Devuelve null si no hay base. Lanza si existe pero es inválida. */
export async function readDatabase(dir: string): Promise<StoredDatabase | null> {
  if (!(await exists(join(dir, DB_FILES.manifest)))) return null;
  const load = async <K extends keyof typeof DB_FILES>(key: K) => {
    const [schema] = FILE_SCHEMAS[key];
    return assertValid(schema, await readJson(join(dir, DB_FILES[key])), `${dir}/${DB_FILES[key]}`);
  };
  const manifest = (await load('manifest')) as ManifestT;
  return {
    manifest,
    catalog: {
      agents: ((await load('agents')) as { items: Catalog['agents'] }).items,
      wEngines: ((await load('wEngines')) as { items: Catalog['wEngines'] }).items,
      driveDiscs: ((await load('driveDiscs')) as { items: Catalog['driveDiscs'] }).items,
      bangboo: ((await load('bangboo')) as { items: Catalog['bangboo'] }).items,
    },
    sources: ((await load('sources')) as { sources: Source[] }).sources,
    claims: ((await load('claims')) as { items: Claim[] }).items,
    consensus: (await load('consensus')) as Consensus,
    vocabulary: withoutSchema((await load('vocabulary')) as GameVocabulary),
    changelog: (await load('changelog')) as ChangelogT,
  };
}

export type DatabaseContent = Omit<StoredDatabase, 'manifest'> & { manifest: ManifestT };

/** Serializa cada fichero con su `$schema` relativo y lo valida antes de escribir. */
export function serializeDatabase(db: DatabaseContent, outDir: string, schemasDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const wrap: Record<keyof typeof DB_FILES, unknown> = {
    manifest: db.manifest,
    agents: { items: db.catalog.agents },
    wEngines: { items: db.catalog.wEngines },
    driveDiscs: { items: db.catalog.driveDiscs },
    bangboo: { items: db.catalog.bangboo },
    sources: { sources: db.sources },
    claims: { dataVersion: db.manifest.dataVersion, items: db.claims },
    consensus: db.consensus,
    vocabulary: db.vocabulary,
    changelog: db.changelog,
  };
  for (const key of Object.keys(DB_FILES) as (keyof typeof DB_FILES)[]) {
    const rel = DB_FILES[key];
    const [schema, schemaFile] = FILE_SCHEMAS[key];
    const schemaRef = relative(dirname(resolve(outDir, rel)), resolve(schemasDir, schemaFile)).split('\\').join('/');
    const value = { ...(wrap[key] as object), $schema: schemaRef };
    assertValid(schema, value, rel);
    files.set(rel, prettyJson(value));
  }
  return files;
}

export async function writeDatabaseAtomic(outDir: string, files: Map<string, string>): Promise<void> {
  const target = resolve(outDir);
  const staging = `${target}.staging`;
  const backup = `${target}.prev`;
  await rm(staging, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const path = join(staging, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  // Releer y validar lo escrito: protege frente a escrituras truncadas.
  const check = await readDatabase(staging);
  if (!check) throw new Error('la base en staging no tiene manifest');

  await rm(backup, { recursive: true, force: true });
  const hadPrevious = await exists(target);
  if (hadPrevious) await rename(target, backup);
  try {
    await rename(staging, target);
  } catch (err) {
    if (hadPrevious) await rename(backup, target);
    throw err;
  }
  await rm(backup, { recursive: true, force: true });
}
