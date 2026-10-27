/**
 * Orquestación de `update`: recoger → normalizar → ciclo de vida → derivar →
 * validar → comparar → publicar (atómico) → informar.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  AgentCatalogFile, BangbooCatalogFile, DriveDiscCatalogFile, WEngineCatalogFile, type Catalog,
} from './schema/catalog.ts';
import { EditorialSubmission, type Claim } from './schema/claims.ts';
import { SCHEMA_VERSION, type AgentIndexFile, type Manifest, type SourceSummary } from './schema/database.ts';
import { PatchCalendarFile, SourceRegistryFile, type Source } from './schema/sources.ts';
import { canonicalJson, prettyJson, sha256 } from './core/canonical.ts';
import { CatalogIndex } from './core/catalog.ts';
import { buildConsensus, CONSENSUS_METHOD } from './core/consensus.ts';
import { changelogIsEmpty, diffDatabases } from './core/diff.ts';
import { applyLifecycle } from './core/lifecycle.ts';
import { normalizeSubmission, type DraftClaim, type InputIssue } from './core/normalize.ts';
import { parsePatch } from './core/patch.ts';
import { buildPendingReview, renderMarkdown, type UpdateReport } from './core/report.ts';
import { DB_FILES, readDatabase, serializeDatabase, writeDatabaseAtomic, type StoredDatabase } from './core/store.ts';
import { check, SchemaValidationError } from './core/validate.ts';
import { collectHttpFeed, type HttpFeedOptions } from './collectors/http-feed.ts';
import { scanEditorial } from './collectors/manual.ts';
import type { CollectorResult } from './collectors/types.ts';

export interface UpdateOptions {
  /** Directorio con sources.json, patches.json, catalog/ y editorial/. */
  dataDir: string;
  /** Directorio de la base generada. */
  outDir: string;
  reportsDir: string;
  schemasDir: string;
  patch: string;
  now?: Date;
  dryRun?: boolean;
  http?: HttpFeedOptions;
}

export interface UpdateResult {
  report: UpdateReport;
  markdown: string;
  exitCode: number;
}

interface LoadedInputs {
  sources: Source[];
  calendar: PatchCalendarFile['patches'];
  catalog: Catalog;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadInputs(dataDir: string): Promise<LoadedInputs> {
  const registry = check(SourceRegistryFile, await readJsonFile(join(dataDir, 'sources.json')));
  if (!registry.ok) throw new SchemaValidationError('data/sources.json', registry.issues);
  const calendar = check(PatchCalendarFile, await readJsonFile(join(dataDir, 'patches.json')));
  if (!calendar.ok) throw new SchemaValidationError('data/patches.json', calendar.issues);

  const loadCatalog = async <T>(schema: Parameters<typeof check>[0], file: string): Promise<T[]> => {
    const r = check(schema, await readJsonFile(join(dataDir, 'catalog', file)));
    if (!r.ok) throw new SchemaValidationError(`data/catalog/${file}`, r.issues);
    return (r.value as { items: T[] }).items;
  };
  const catalog: Catalog = {
    agents: await loadCatalog(AgentCatalogFile, 'agents.json'),
    wEngines: await loadCatalog(WEngineCatalogFile, 'w-engines.json'),
    driveDiscs: await loadCatalog(DriveDiscCatalogFile, 'drive-discs.json'),
    bangboo: await loadCatalog(BangbooCatalogFile, 'bangboo.json'),
  };

  const ids = new Set<string>();
  for (const s of registry.value.sources) {
    if (ids.has(s.id)) throw new Error(`data/sources.json: fuente duplicada "${s.id}"`);
    ids.add(s.id);
    if (s.defaultTierScale && !s.tierScales.some((t) => t.id === s.defaultTierScale)) {
      throw new Error(`data/sources.json: "${s.id}" declara defaultTierScale "${s.defaultTierScale}" inexistente`);
    }
  }
  const sortById = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return {
    sources: sortById(registry.value.sources),
    calendar: [...calendar.value.patches].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)),
    catalog: {
      agents: sortById(catalog.agents), wEngines: sortById(catalog.wEngines),
      driveDiscs: sortById(catalog.driveDiscs), bangboo: sortById(catalog.bangboo),
    },
  };
}

function emptyPending(): UpdateReport['pendingReview'] {
  return {
    unverifiedClaims: [], patchUndeclared: [], preRelease: [], carriedOver: [], sourcePolicyChanged: [],
    sourcesWithoutCurrentData: [], agentsWithoutCurrentClaims: [], unverifiedCatalogEntries: [],
    unconfirmedTierScales: [], unverifiedPatchDates: [], drafts: [],
  };
}

function buildIndex(claims: Claim[], tierConsensus: { id: string; agent: string }[], catalog: Catalog, dataVersion: string): AgentIndexFile {
  const agents: AgentIndexFile['agents'] = {};
  for (const a of catalog.agents) agents[a.id] = { claimIds: [], currentClaimIds: [], tierConsensusIds: [] };
  for (const c of claims) {
    for (const id of c.agentRefs) {
      const entry = agents[id];
      if (!entry) continue;
      entry.claimIds.push(c.id);
      if (c.status === 'current') entry.currentClaimIds.push(c.id);
    }
  }
  for (const t of tierConsensus) agents[t.agent]?.tierConsensusIds.push(t.id);
  return { dataVersion, agents };
}

function summarizeSources(sources: Source[], claims: Claim[], outcomes: Map<string, SourceSummary['updateOutcome']>): SourceSummary[] {
  return sources.map((s) => {
    const own = claims.filter((c) => c.sourceId === s.id);
    const dates = own.map((c) => c.provenance.accessedAt).sort();
    return {
      id: s.id,
      name: s.name,
      attribution: s.attribution,
      automationStatus: s.automation.status,
      updateOutcome: outcomes.get(s.id) ?? 'no_input',
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
  const failed = (prev: StoredDatabase | null, partial: Partial<UpdateReport> = {}): Promise<UpdateResult> => finish({
    outcome: 'failed', gamePatch: options.patch, dataVersion: prev?.manifest.dataVersion ?? null,
    previousDataVersion: prev?.manifest.dataVersion ?? null, generatedAt, errors, warnings,
    sources: prev?.manifest.sources ?? [], changes: null, stale: [], pendingReview: emptyPending(), ...partial,
  });

  // 1. Base anterior (punto de comparación y de rescate).
  let prev: StoredDatabase | null = null;
  try {
    prev = await readDatabase(options.outDir);
  } catch (err) {
    warnings.push(`La base existente en ${options.outDir} es inválida y no se usará como referencia: ${(err as Error).message}`);
  }

  // 2. Entradas: registro, calendario y catálogo.
  let inputs: LoadedInputs;
  let catalogIndex: CatalogIndex;
  try {
    inputs = await loadInputs(options.dataDir);
    catalogIndex = new CatalogIndex(inputs.catalog);
  } catch (err) {
    errors.push({ file: options.dataDir, path: '', message: (err as Error).message });
    return failed(prev);
  }
  const sourceMap = new Map(inputs.sources.map((s) => [s.id, s]));

  // 3. Recogida: editorial + feeds autorizados.
  const scan = await scanEditorial(join(options.dataDir, 'editorial'), options.dataDir);
  for (const e of scan.parseErrors) errors.push({ file: e.file, path: '', message: e.message });
  const results: CollectorResult[] = [];
  for (const source of inputs.sources) {
    if (source.adapter) results.push(await collectHttpFeed(source, options.http));
  }

  const drafts: DraftClaim[] = [];
  const outcomes = new Map<string, SourceSummary['updateOutcome']>();
  const handle = (origin: string, method: Parameters<typeof normalizeSubmission>[1]['method'], data: unknown, expectedSource?: string) => {
    const parsed = check(EditorialSubmission, data);
    if (!parsed.ok) {
      for (const i of parsed.issues) errors.push({ file: origin, path: i.path, message: i.message });
      return;
    }
    if (expectedSource && parsed.value.sourceId !== expectedSource) {
      errors.push({ file: origin, path: '/sourceId', message: `el feed de "${expectedSource}" no puede publicar datos de "${parsed.value.sourceId}"` });
      return;
    }
    const accessed = Date.parse(`${parsed.value.accessedAt}T00:00:00Z`);
    if (accessed > now.getTime()) {
      errors.push({ file: origin, path: '/accessedAt', message: `fecha de consulta en el futuro (${parsed.value.accessedAt})` });
      return;
    }
    const { drafts: d, issues } = normalizeSubmission(parsed.value, { catalog: catalogIndex, sources: sourceMap, method, origin });
    errors.push(...issues);
    drafts.push(...d);
    if (d.length) outcomes.set(parsed.value.sourceId, 'collected');
  };

  for (const s of scan.submissions) handle(s.origin, s.method, s.data);
  for (const r of results) {
    if (r.failure) {
      // 4. Conservar el último valor válido de la fuente que falló.
      const carried = (prev?.claims ?? []).filter((c) => c.sourceId === r.sourceId && c.provenance.collectionMethod !== 'manual_entry');
      warnings.push(`Fuente "${r.sourceId}": ${r.failure}. Se conservan ${carried.length} claims de la versión anterior.`);
      for (const c of carried) {
        const { status: _s, flags, firstSeenAt: _f, supersededBy: _b, ...rest } = c;
        drafts.push({
          ...rest,
          retracted: c.status === 'retracted',
          initialFlags: [...new Set([...flags.filter((f) => f === 'carried_over'), 'carried_over' as const])],
          origin: `carry-over:${prev?.manifest.dataVersion}`,
        } as DraftClaim);
      }
      if (carried.length && !outcomes.has(r.sourceId)) outcomes.set(r.sourceId, 'carried_over');
      continue;
    }
    for (const s of r.submissions) handle(s.origin, s.method, s.data, r.sourceId);
  }

  if (errors.length) return failed(prev);

  // 5. Ciclo de vida y derivados.
  const claims = applyLifecycle(drafts, {
    currentPatch: options.patch,
    now,
    sources: sourceMap,
    calendar: inputs.calendar,
    catalog: catalogIndex,
    previousFirstSeen: new Map((prev?.claims ?? []).map((c) => [c.id, c.firstSeenAt])),
  });
  const consensus = buildConsensus(claims, options.patch);
  const summaries = summarizeSources(inputs.sources, claims, outcomes);
  const isFixture = inputs.sources.some((s) => s.kind === 'fixture');

  // 6. Versionado por contenido: mismo hash = sin nueva revisión.
  const contentHash = sha256(canonicalJson({ gamePatch: options.patch, catalog: inputs.catalog, sources: inputs.sources, claims, consensus }));
  const samePatch = prev?.manifest.gamePatch === options.patch;
  const unchanged = samePatch && prev?.manifest.contentHash === contentHash;
  const revision = unchanged ? prev!.manifest.revision : samePatch ? prev!.manifest.revision + 1 : 1;
  const dataVersion = `${options.patch}-r${revision}`;

  const changelog = diffDatabases(prev && { dataVersion: prev.manifest.dataVersion, claims: prev.claims, catalog: prev.catalog }, { dataVersion, claims, catalog: inputs.catalog }, generatedAt);
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
    return finish(report);
  }

  const count = (s: Claim['status']) => claims.filter((c) => c.status === s).length;
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    dataVersion,
    gamePatch: options.patch,
    revision,
    previousDataVersion: prev?.manifest.dataVersion ?? null,
    generatedAt,
    contentHash,
    isFixture,
    counts: {
      agents: inputs.catalog.agents.length, wEngines: inputs.catalog.wEngines.length,
      driveDiscs: inputs.catalog.driveDiscs.length, bangboo: inputs.catalog.bangboo.length,
      claims: claims.length,
      claimsByStatus: { current: count('current'), stale: count('stale'), superseded: count('superseded'), retracted: count('retracted') },
      tierConsensus: consensus.tiers.length,
      teamConsensus: consensus.teams.length,
    },
    sources: summaries,
    files: {
      agents: DB_FILES.agents, wEngines: DB_FILES.wEngines, driveDiscs: DB_FILES.driveDiscs, bangboo: DB_FILES.bangboo,
      sources: DB_FILES.sources, claims: DB_FILES.claims, consensus: DB_FILES.consensus, index: DB_FILES.index,
    },
  };

  // 7. Serializar + validar todo; publicar solo si todo es válido.
  let files: Map<string, string>;
  try {
    files = serializeDatabase({
      manifest,
      catalog: inputs.catalog,
      sources: inputs.sources,
      claims,
      consensus: { dataVersion, method: CONSENSUS_METHOD, ...consensus },
      index: buildIndex(claims, consensus.tiers, inputs.catalog, dataVersion),
      changelog,
    }, options.outDir, options.schemasDir);
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
  }
  return finish(report);
}
