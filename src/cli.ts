#!/usr/bin/env node
/**
 * CLI de zzz-meta-knowledge.
 *
 *   update --patch 3.3            Recoge, normaliza, valida y publica la base.
 *   validate [--db db]            Valida esquema + integridad de una base.
 *   report [--reports reports]    Muestra el último informe.
 *   new-submission --source id    Crea un borrador editorial (*.draft.json).
 *   export-schemas                Regenera /schemas a partir de src/schema.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CLAIM_KINDS, type ClaimKind } from './schema/claims.ts';
import { PUBLISHED_SCHEMAS } from './schema/index.ts';
import { prettyJson } from './core/canonical.ts';
import { checkIntegrity } from './core/integrity.ts';
import { toIsoDate } from './core/patch.ts';
import { readDatabase } from './core/store.ts';
import { loadInputs, runUpdate } from './pipeline.ts';
import { submissionTemplate } from './templates.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    patch: { type: 'string' },
    data: { type: 'string', default: 'data' },
    out: { type: 'string', default: 'db' },
    db: { type: 'string' },
    reports: { type: 'string', default: 'reports' },
    schemas: { type: 'string', default: 'schemas' },
    now: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    source: { type: 'string' },
    kinds: { type: 'string', default: 'tier,team' },
    by: { type: 'string', default: process.env.USER ?? 'editor' },
    url: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const USAGE = `Uso: zzz-meta <comando> [opciones]

Comandos:
  update --patch <X.Y> [--data data] [--out db] [--reports reports] [--now ISO] [--dry-run]
  validate [--db db]
  report [--reports reports]
  new-submission --source <id> --patch <X.Y> [--kinds tier,team] [--url URL] [--by nombre]
  export-schemas [--schemas schemas]
`;

async function latestPatch(dataDir: string): Promise<string> {
  const { calendar } = await loadInputs(dataDir);
  const last = calendar.at(-1);
  if (!last) throw new Error('data/patches.json está vacío; indica --patch');
  return last.patch;
}

async function main(): Promise<number> {
  const [command] = positionals;
  if (!command || values.help) {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }

  switch (command) {
    case 'update': {
      const patch = values.patch ?? (await latestPatch(values.data));
      const now = values.now ? new Date(values.now) : new Date();
      if (Number.isNaN(now.getTime())) throw new Error(`--now inválido: ${values.now}`);
      const result = await runUpdate({
        dataDir: values.data, outDir: values.out, reportsDir: values.reports,
        schemasDir: values.schemas, patch, now, dryRun: values['dry-run'],
      });
      process.stdout.write(result.markdown + '\n');
      return result.exitCode;
    }
    case 'validate': {
      const dir = values.db ?? values.out;
      const db = await readDatabase(dir);
      if (!db) {
        process.stderr.write(`No hay base en ${dir}. Ejecuta: npm run update -- --patch X.Y\n`);
        return 1;
      }
      const problems = checkIntegrity(db);
      if (problems.length) {
        process.stderr.write(`✖ ${dir} (${db.manifest.dataVersion}) tiene ${problems.length} problema(s):\n` + problems.map((p) => `  - ${p}`).join('\n') + '\n');
        return 1;
      }
      const { counts } = db.manifest;
      process.stdout.write(`✔ ${dir} válida — ${db.manifest.dataVersion} · ${counts.claims} claims (${counts.claimsByStatus.current} vigentes) · ${counts.agents} agentes${db.manifest.isFixture ? ' · ⚠ DATOS DE PRUEBA' : ''}\n`);
      return 0;
    }
    case 'report': {
      try {
        process.stdout.write(await readFile(join(values.reports, 'latest.md'), 'utf8'));
        return 0;
      } catch {
        process.stderr.write(`No hay informes en ${values.reports}.\n`);
        return 1;
      }
    }
    case 'new-submission': {
      if (!values.source) throw new Error('--source es obligatorio');
      const { sources } = await loadInputs(values.data);
      const source = sources.find((s) => s.id === values.source);
      if (!source) throw new Error(`Fuente "${values.source}" no registrada. Disponibles: ${sources.map((s) => s.id).join(', ')}`);
      const patch = values.patch ?? (await latestPatch(values.data));
      const kinds = values.kinds.split(',').map((k) => k.trim()) as ClaimKind[];
      const unknown = kinds.filter((k) => !CLAIM_KINDS.includes(k));
      if (unknown.length) throw new Error(`Tipos desconocidos: ${unknown.join(', ')}. Válidos: ${CLAIM_KINDS.join(', ')}`);
      const date = toIsoDate(new Date());
      const file = join(values.data, 'editorial', patch, `${source.id}-${date}-${kinds.join('-')}.draft.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, prettyJson(submissionTemplate({
        sourceId: source.id, url: values.url ?? source.homepage, patch, date, collectedBy: values.by, kinds,
      })), { flag: 'wx' });
      process.stdout.write(`Borrador creado: ${file}\n` +
        `1. Abre la página de ${source.name} en tu navegador y rellena los datos con palabras propias.\n` +
        `2. Renombra el fichero quitando ".draft" cuando esté completo.\n` +
        `3. Ejecuta: npm run update -- --patch ${patch} --dry-run\n` +
        `Atribución requerida: ${source.attribution}\n`);
      return 0;
    }
    case 'export-schemas': {
      const dir = resolve(values.schemas);
      await mkdir(dir, { recursive: true });
      for (const [name, schema] of Object.entries(PUBLISHED_SCHEMAS)) {
        const value = { $schema: 'http://json-schema.org/draft-07/schema#', ...schema, $id: name };
        await writeFile(join(dir, name), prettyJson(value));
      }
      process.stdout.write(`${Object.keys(PUBLISHED_SCHEMAS).length} esquemas escritos en ${dir}\n`);
      return 0;
    }
    default:
      process.stderr.write(`Comando desconocido "${command}".\n${USAGE}`);
      return 1;
  }
}

main().then((code) => process.exit(code), (err: unknown) => {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
});
