/**
 * Orquestación de `update`: leer envíos → normalizar → ciclo de vida → derivar →
 * validar → comparar → publicar (atómico) → exportar → informar.
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  AgentCatalogFile, BangbooCatalogFile, DriveDiscCatalogFile, GameVocabularyFile, WEngineCatalogFile,
  type Catalog, type GameVocabulary,
} from './schema/catalog.ts';
import { EditorialSubmission, type Claim } from './schema/claims.ts';
import { SCHEMA_VERSION, type Manifest, type SourceSummary } from './schema/database.ts';
import { PatchCalendarFile, SourceRegistryFile, type Source } from './schema/sources.ts';
import { canonicalJson, prettyJson, sha256 } from './core/canonical.ts';
import { CatalogIndex } from './core/catalog.ts';
import { buildConsensus, CONSENSUS_METHOD } from './core/consensus.ts';
import { changelogIsEmpty, diffDatabases } from './core/diff.ts';
import { applyLifecycle } from './core/lifecycle.ts';
import { normalizeSubmission, type DraftClaim, type InputIssue } from './core/normalize.ts';
import { comparePatch, parsePatch } from './core/patch.ts';
import { buildPendingReview, renderMarkdown, type UpdateReport } from './core/report.ts';
import { DB_FILES, readDatabase, serializeDatabase, withoutSchema, writeDatabaseAtomic, type StoredDatabase } from './core/store.ts';
import { check, SchemaValidationError } from './core/validate.ts';
import { Vocabulary } from './core/vocabulary.ts';
import { scanEditorial } from './collectors/manual.ts';
import { buildExport } from './export/build.ts';

export const EXPORT_FILE = 'zzz-meta.json';
export const EXPORT_TYPES_FILE = 'zzz-meta.types.ts';
const EXPORT_TYPES_SOURCE = new URL('./export/types.ts', import.meta.url);

export interface UpdateOptions {
  /** Directorio con sources.json, patches.json, game.json, catalog/ y editorial/. */
  dataDir: string;
  /** Directorio de la base generada. */
  outDir: string;
  reportsDir: string;
  schemasDir: string;
  /** Directorio del paquete para Hoyo Builds. null = no exportar. */
  exportDir: string | null;
  patch: string;
  now?: Date;
  dryRun?: boolean;
  /** Las fuentes ficticias solo se aceptan si se pide explícitamente (tests y ejemplo). */
  allowFixtures?: boolean;
}

export interface UpdateResult {
  report: UpdateReport;
  markdown: string;
  exitCode: number;
}

export interface LoadedInputs {
  sources: Source[];
  calendar: PatchCalendarFile['patches'];
  catalog: Catalog;
  vocabulary: GameVocabulary;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadChecked<T>(schema: Parameters<typeof check>[0], path: string, label: string): Promise<T> {
  const r = check(schema, await readJsonFile(path));
  if (!r.ok) throw new SchemaValidationError(label, r.issues);
  return r.value as T;
}

export async function loadInputs(dataDir: string): Promise<LoadedInputs> {
  const registry = await loadChecked<SourceRegistryFile>(SourceRegistryFile, join(dataDir, 'sources.json'), 'data/sources.json');
  const calendar = await loadChecked<PatchCalendarFile>(PatchCalendarFile, join(dataDir, 'patches.json'), 'data/patches.json');
  const vocabulary = withoutSchema(await loadChecked<GameVocabulary>(GameVocabularyFile, join(dataDir, 'game.json'), 'data/game.json'));
  const items = async <T>(schema: Parameters<typeof check>[0], file: string) =>
    (await loadChecked<{ items: T[] }>(schema, join(dataDir, 'catalog', file), `data/catalog/${file}`)).items;
  const catalog: Catalog = {
    agents: await items(AgentCatalogFile, 'agents.json'),
    wEngines: await items(WEngineCatalogFile, 'w-engines.json'),
    driveDiscs: await items(DriveDiscCatalogFile, 'drive-discs.json'),
    bangboo: await items(BangbooCatalogFile, 'bangboo.json'),
  };

  const problems: string[] = [];
  const vocab = new Vocabulary(vocabulary);
  for (const a of catalog.agents) {
    if (a.attribute && !vocab.attributes.has(a.attribute)) problems.push(`agente "${a.id}": atributo "${a.attribute}" no está en data/game.json`);
    if (a.specialty && !vocab.specialties.has(a.specialty)) problems.push(`agente "${a.id}": especialidad "${a.specialty}" no está en data/game.json`);
  }
  for (const w of catalog.wEngines) {
    if (w.specialty && !vocab.specialties.has(w.specialty)) problems.push(`W-Engine "${w.id}": especialidad "${w.specialty}" no está en data/game.json`);
  }
  const ids = new Set<string>();
  for (const s of registry.sources) {
    if (ids.has(s.id)) problems.push(`data/sources.json: fuente duplicada "${s.id}"`);
    ids.add(s.id);
    if (s.defaultTierScale && !s.tierScales.some((t) => t.id === s.defaultTierScale)) {
      problems.push(`data/sources.json: "${s.id}" declara defaultTierScale "${s.defaultTierScale}" inexistente`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));

  const sortById = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  return {
    sources: sortById(registry.sources),
    calendar: [...calendar.patches].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)),
    catalog: {
      agents: sortById(catalog.agents), wEngines: sortById(catalog.wEngines),
      driveDiscs: sortById(catalog.driveDiscs), bangboo: sortById(catalog.bangboo),
    },
    vocabulary,
  };
}

function summarizeSources(sources: Source[], claims: Claim[], collected: Set<string>): SourceSummary[] {
  return sources.map((s) => {
    const own = claims.filter((c) => c.sourceId === s.id);
    const dates = own.map((c) => c.provenance.accessedAt).sort();
    return {
      id: s.id,
      name: s.name,
      attribution: s.attribution,
      automationStatus: s.automation.status,
      updateOutcome: collected.has(s.id) ? 'collected' : 'no_input',
      lastAccessedAt: dates.at(-1) ?? null,
      claimCount: own.length,
      currentClaimCount: own.filter((c) => c.status === 'current').length,
    };
  });
}

async function writeReports(reportsDir: string, report: UpdateReport, markdown: string): Promise<void> {
  await mkdir(reportsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
  // Versión publicada o fallo: informe con nombre propio. "Sin cambios": solo latest.
  const named = report.outcome === 'published' && report.dataVersion ? [report.dataVersion]
    : report.outcome === 'failed' ? [`failed-${report.gamePatch}-${stamp}`] : [];
  for (const base of [...named, 'latest']) {
    await writeFile(join(reportsDir, `${base}.json`), prettyJson(report));
    await writeFile(join(reportsDir, `${base}.md`), markdown);
  }
}

/** Escribe el paquete para Hoyo Builds a partir de la base publicada (fichero temporal + rename). */
export async function writeExport(db: StoredDatabase, exportDir: string): Promise<void> {
  await mkdir(exportDir, { recursive: true });
  const bundle = buildExport({ manifest: db.manifest, catalog: db.catalog, sources: db.sources, claims: db.claims });
  const target = join(exportDir, EXPORT_FILE);
  await writeFile(`${target}.tmp`, JSON.stringify(bundle, null, 2) + '\n');
  await rename(`${target}.tmp`, target);
  await copyFile(EXPORT_TYPES_SOURCE, join(exportDir, EXPORT_TYPES_FILE));
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  parsePatch(options.patch);
  const errors: InputIssue[] = [];
  const warnings: string[] = [];

  const finish = async (report: UpdateReport): Promise<UpdateResult> => {
    const markdown = renderMarkdown(report);
    if (!options.dryRun) await writeReports(options.reportsDir, report, markdown);
    return { report, markdown, exitCode: report.outcome === 'failed' ? 1 : 0 };
  };
  const failed = (prev: StoredDatabase | null): Promise<UpdateResult> => finish({
    outcome: 'failed', gamePatch: options.patch, dataVersion: prev?.manifest.dataVersion ?? null,
    previousDataVersion: prev?.manifest.dataVersion ?? null, generatedAt, errors, warnings,
    sources: prev?.manifest.sources ?? [], changes: null, stale: [], pendingReview: null,
  });

  // 1. Base anterior: punto de comparación. Si falla la actualización, queda intacta.
  let prev: StoredDatabase | null = null;
  try {
    prev = await readDatabase(options.outDir);
  } catch (err) {
    warnings.push(`La base existente en ${options.outDir} es inválida y no se usará como referencia: ${(err as Error).message}`);
  }

  // 2. Entradas: registro, calendario, vocabulario y catálogo.
  let inputs: LoadedInputs;
  let catalogIndex: CatalogIndex;
  let vocabulary: Vocabulary;
  try {
    inputs = await loadInputs(options.dataDir);
    catalogIndex = new CatalogIndex(inputs.catalog);
    vocabulary = new Vocabulary(inputs.vocabulary);
  } catch (err) {
    errors.push({ file: options.dataDir, path: '', message: (err as Error).message });
    return failed(prev);
  }
  const fixtures = inputs.sources.filter((s) => s.kind === 'fixture').map((s) => s.id);
  if (fixtures.length && !options.allowFixtures) {
    errors.push({ file: 'sources.json', path: '', message: `contiene fuentes ficticias (${fixtures.join(', ')}); los datos de prueba no pueden mezclarse con la base real` });
    return failed(prev);
  }
  if (!inputs.calendar.some((p) => p.patch === options.patch)) {
    warnings.push(`El parche ${options.patch} no está en patches.json: no se pueden detectar datos previos al lanzamiento. Añádelo con "npm run new-patch".`);
  }
  if (inputs.calendar.length && comparePatch(options.patch, inputs.calendar.at(-1)!.patch) < 0) {
    warnings.push(`Estás generando el parche ${options.patch}, pero el calendario ya llega a ${inputs.calendar.at(-1)!.patch}.`);
  }
  const sourceMap = new Map(inputs.sources.map((s) => [s.id, s]));

  // 3. Envíos editoriales.
  const scan = await scanEditorial(join(options.dataDir, 'editorial'), options.dataDir);
  for (const e of scan.parseErrors) errors.push({ file: e.file, path: '', message: e.message });
  const drafts: DraftClaim[] = [];
  const collected = new Set<string>();
  for (const { origin, data } of scan.submissions) {
    const parsed = check(EditorialSubmission, data);
    if (!parsed.ok) {
      for (const i of parsed.issues) errors.push({ file: origin, path: i.path, message: i.message });
      continue;
    }
    if (Date.parse(`${parsed.value.accessedAt}T00:00:00Z`) > now.getTime()) {
      errors.push({ file: origin, path: '/accessedAt', message: `fecha de consulta en el futuro (${parsed.value.accessedAt})` });
      continue;
    }
    const { drafts: d, issues } = normalizeSubmission(parsed.value, { catalog: catalogIndex, sources: sourceMap, vocabulary, origin });
    errors.push(...issues);
    drafts.push(...d);
    if (d.length) collected.add(parsed.value.sourceId);
  }
  if (errors.length) return failed(prev);

  // 4. Ciclo de vida y derivados.
  const claims = applyLifecycle(drafts, {
    currentPatch: options.patch,
    now,
    sources: sourceMap,
    calendar: inputs.calendar,
    catalog: catalogIndex,
    previousFirstSeen: new Map((prev?.claims ?? []).map((c) => [c.id, c.firstSeenAt])),
  });
  const consensus = buildConsensus(claims, options.patch);
  const summaries = summarizeSources(inputs.sources, claims, collected);

  // 5. Versionado por contenido: mismo hash = sin nueva revisión.
  const contentHash = sha256(canonicalJson({
    gamePatch: options.patch, catalog: inputs.catalog, vocabulary: inputs.vocabulary, sources: inputs.sources, claims, consensus,
  }));
  const samePatch = prev?.manifest.gamePatch === options.patch;
  const unchanged = samePatch && prev?.manifest.contentHash === contentHash;
  const revision = unchanged ? prev!.manifest.revision : samePatch ? prev!.manifest.revision + 1 : 1;
  const dataVersion = `${options.patch}-r${revision}`;

  const changelog = diffDatabases(
    prev && { dataVersion: prev.manifest.dataVersion, claims: prev.claims, catalog: prev.catalog },
    { dataVersion, claims, catalog: inputs.catalog },
    generatedAt,
  );
  const pendingReview = buildPendingReview({ claims, catalog: inputs.catalog, sources: inputs.sources, summaries, calendar: inputs.calendar, drafts: scan.drafts });
  const stale = claims.filter((c) => c.status === 'stale').map((c) => ({ id: c.id, sourceId: c.sourceId, slotKey: c.slotKey, status: c.status, flags: c.flags }));

  const report: UpdateReport = {
    outcome: unchanged ? 'unchanged' : options.dryRun ? 'dry_run' : 'published',
    gamePatch: options.patch, dataVersion, previousDataVersion: prev?.manifest.dataVersion ?? null,
    generatedAt, errors, warnings, sources: summaries,
    changes: unchanged ? null : changelog,
    stale, pendingReview,
  };
  if (unchanged) {
    if (!changelogIsEmpty(changelog)) warnings.push('Hash igual pero diff no vacío: revisar determinismo.');
    if (!options.dryRun && options.exportDir && prev) await writeExport(prev, options.exportDir);
    return finish(report);
  }

  const count = (s: Claim['status']) => claims.filter((c) => c.status === s).length;
  const liveClaims = claims.filter((c) => c.status === 'current' || c.status === 'stale');
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    dataVersion,
    gamePatch: options.patch,
    revision,
    previousDataVersion: prev?.manifest.dataVersion ?? null,
    generatedAt,
    contentHash,
    isFixture: fixtures.length > 0,
    counts: {
      agents: inputs.catalog.agents.length, wEngines: inputs.catalog.wEngines.length,
      driveDiscs: inputs.catalog.driveDiscs.length, bangboo: inputs.catalog.bangboo.length,
      claims: claims.length,
      claimsByStatus: { current: count('current'), stale: count('stale'), superseded: count('superseded'), retracted: count('retracted') },
      liveClaimsByReview: {
        verified: liveClaims.filter((c) => c.provenance.verification.state === 'verified').length,
        pending: liveClaims.filter((c) => c.provenance.verification.state !== 'verified').length,
      },
      tierConsensus: consensus.tiers.length,
      teamConsensus: consensus.teams.length,
    },
    sources: summaries,
    files: {
      agents: DB_FILES.agents, wEngines: DB_FILES.wEngines, driveDiscs: DB_FILES.driveDiscs, bangboo: DB_FILES.bangboo,
      sources: DB_FILES.sources, claims: DB_FILES.claims, consensus: DB_FILES.consensus, vocabulary: DB_FILES.vocabulary,
    },
  };

  // 6. Serializar + validar todo; publicar solo si todo es válido.
  const db: StoredDatabase = {
    manifest,
    catalog: inputs.catalog,
    sources: inputs.sources,
    claims,
    consensus: { dataVersion, method: CONSENSUS_METHOD, ...consensus },
    vocabulary: inputs.vocabulary,
    changelog,
  };
  let files: Map<string, string>;
  try {
    files = serializeDatabase(db, options.outDir, options.schemasDir);
  } catch (err) {
    errors.push({ file: '(salida generada)', path: '', message: (err as Error).message });
    return failed(prev);
  }

  if (!options.dryRun) {
    try {
      await writeDatabaseAtomic(resolve(options.outDir), files);
    } catch (err) {
      errors.push({ file: options.outDir, path: '', message: `escritura fallida, se conserva la versión anterior: ${(err as Error).message}` });
      return failed(prev);
    }
    if (options.exportDir) await writeExport(db, options.exportDir);
  }
  return finish(report);
}
