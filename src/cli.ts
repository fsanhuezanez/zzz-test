#!/usr/bin/env node
/**
 * CLI de zzz-meta-knowledge.
 *
 *   update [--patch X.Y] [--dry-run]   Valida envíos, publica db/, exporta y escribe el informe.
 *   validate                            Esquema + integridad de db/ y coherencia de export/.
 *   report                              Muestra el último informe.
 *   export                              Regenera export/ desde db/ sin recalcular.
 *   new-submission --source id          Crea un borrador editorial (*.draft.json).
 *   new-patch X.Y --date AAAA-MM-DD     Añade un parche al calendario.
 *   export-schemas                      Regenera /schemas a partir de src/schema.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CLAIM_KINDS, type ClaimKind } from './schema/claims.ts';
import { PUBLISHED_SCHEMAS } from './schema/index.ts';
import { PatchCalendarFile } from './schema/sources.ts';
import { prettyJson } from './core/canonical.ts';
import { checkIntegrity } from './core/integrity.ts';
import { comparePatch, parsePatch, toIsoDate } from './core/patch.ts';
import { readDatabase } from './core/store.ts';
import { assertValid } from './core/validate.ts';
import { EXPORT_FILE, loadInputs, runUpdate, writeExport } from './pipeline.ts';
import { PRESETS, submissionTemplate } from './templates.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    patch: { type: 'string' },
    data: { type: 'string', default: 'data' },
    out: { type: 'string', default: 'db' },
    db: { type: 'string' },
    reports: { type: 'string', default: 'reports' },
    export: { type: 'string', default: 'export' },
    schemas: { type: 'string', default: 'schemas' },
    now: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'allow-fixtures': { type: 'boolean', default: false },
    source: { type: 'string' },
    template: { type: 'string', default: 'team' },
    kinds: { type: 'string' },
    by: { type: 'string', default: process.env.USER ?? 'editor' },
    url: { type: 'string' },
    date: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const USAGE = `Uso: npm run <comando> -- [opciones]

  update [--patch X.Y] [--dry-run]       valida, publica db/, exporta a export/ y escribe reports/
  validate                               comprueba db/ y export/
  report                                 muestra reports/latest.md
  export                                 regenera export/ desde db/
  new-submission --source <id> [--template team|build|tier|all] [--kinds a,b] [--url URL] [--by nombre]
  new-patch <X.Y> --date AAAA-MM-DD [--url fuente-de-la-fecha]
  schemas                                regenera schemas/

Opciones avanzadas: --data data --out db --reports reports --export export --now ISO --allow-fixtures
`;

async function latestPatch(dataDir: string): Promise<string> {
  const { calendar } = await loadInputs(dataDir);
  const last = calendar.at(-1);
  if (!last) throw new Error('data/patches.json está vacío; indica --patch');
  return last.patch;
}

async function main(): Promise<number> {
  const [command, arg] = positionals;
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
        dataDir: values.data, outDir: values.out, reportsDir: values.reports, exportDir: values.export,
        schemasDir: values.schemas, patch, now, dryRun: values['dry-run'], allowFixtures: values['allow-fixtures'],
      });
      process.stdout.write(result.markdown + '\n');
      return result.exitCode;
    }
    case 'validate': {
      const dir = values.db ?? values.out;
      const db = await readDatabase(dir);
      if (!db) {
        process.stderr.write(`No hay base en ${dir}. Ejecuta: npm run update\n`);
        return 1;
      }
      const problems = checkIntegrity(db);
      try {
        const exported = JSON.parse(await readFile(join(values.export, EXPORT_FILE), 'utf8')) as { meta?: { dataVersion?: string } };
        if (exported.meta?.dataVersion !== db.manifest.dataVersion) {
          problems.push(`${values.export}/${EXPORT_FILE} es de ${exported.meta?.dataVersion}, la base es ${db.manifest.dataVersion}: ejecuta npm run export`);
        }
      } catch {
        problems.push(`falta ${values.export}/${EXPORT_FILE}: ejecuta npm run export`);
      }
      if (problems.length) {
        process.stderr.write(`✖ ${dir} (${db.manifest.dataVersion}) tiene ${problems.length} problema(s):\n` + problems.map((p) => `  - ${p}`).join('\n') + '\n');
        return 1;
      }
      const { counts } = db.manifest;
      process.stdout.write(
        `✔ ${dir} válida — ${db.manifest.dataVersion} · ${counts.claims} claims · `
        + `vigentes/antiguos: ${counts.liveClaimsByReview.verified} verificados, ${counts.liveClaimsByReview.pending} pendientes`
        + `${db.manifest.isFixture ? ' · ⚠ DATOS DE PRUEBA' : ''}\n`,
      );
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
    case 'export': {
      const dir = values.db ?? values.out;
      const db = await readDatabase(dir);
      if (!db) throw new Error(`No hay base en ${dir}`);
      await writeExport(db, values.export);
      process.stdout.write(`Exportado ${db.manifest.dataVersion} a ${values.export}/\n`);
      return 0;
    }
    case 'new-submission': {
      if (!values.source) throw new Error('--source es obligatorio');
      const { sources } = await loadInputs(values.data);
      const source = sources.find((s) => s.id === values.source);
      if (!source) throw new Error(`Fuente "${values.source}" no registrada. Disponibles: ${sources.map((s) => s.id).join(', ')}`);
      const patch = values.patch ?? (await latestPatch(values.data));
      const preset = PRESETS[values.template];
      if (!values.kinds && !preset) throw new Error(`Plantilla desconocida "${values.template}". Disponibles: ${Object.keys(PRESETS).join(', ')}`);
      const kinds = (values.kinds ? values.kinds.split(',').map((k) => k.trim()) : preset!) as ClaimKind[];
      const unknown = kinds.filter((k) => !CLAIM_KINDS.includes(k));
      if (unknown.length) throw new Error(`Tipos desconocidos: ${unknown.join(', ')}. Válidos: ${CLAIM_KINDS.join(', ')}`);
      const date = toIsoDate(new Date());
      const label = values.kinds ? kinds.join('-') : values.template;
      const file = join(values.data, 'editorial', patch, `${source.id}-${date}-${label}.draft.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, prettyJson(submissionTemplate({
        sourceId: source.id, url: values.url ?? source.homepage, patch, date, collectedBy: values.by, kinds,
      })), { flag: 'wx' });
      process.stdout.write(`Borrador creado: ${file}\n`
        + `1. Abre la página en tu navegador y rellena SOLO lo que dice, con palabras propias. Borra los bloques que no uses.\n`
        + `2. Quita ".draft" del nombre y ejecuta: npm run update -- --dry-run\n`
        + `3. Cuando otra persona lo compruebe en la página: verification = verified (reviewedBy, reviewedAt).\n`
        + `Atribución: ${source.attribution}\n`);
      return 0;
    }
    case 'new-patch': {
      if (!arg) throw new Error('Indica el parche: npm run new-patch -- 3.4 --date 2026-12-02');
      parsePatch(arg);
      if (!values.date || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error('--date AAAA-MM-DD es obligatorio');
      const path = join(values.data, 'patches.json');
      const calendar = assertValid(PatchCalendarFile, JSON.parse(await readFile(path, 'utf8')), path);
      if (calendar.patches.some((p) => p.patch === arg)) throw new Error(`El parche ${arg} ya está en ${path}`);
      calendar.patches.push({ patch: arg, releaseDate: values.date, source: values.url ?? 'https://zenless.hoyoverse.com/', verified: false });
      calendar.patches.sort((a, b) => comparePatch(a.patch, b.patch));
      assertValid(PatchCalendarFile, calendar, path);
      await writeFile(path, JSON.stringify(calendar, null, 2) + '\n');
      process.stdout.write(`Parche ${arg} (${values.date}) añadido a ${path} como no verificado.\n`
        + `Siguiente: npm run update -- --patch ${arg}. Los datos del parche anterior pasarán a "stale".\n`);
      return 0;
    }
    case 'export-schemas': {
      const dir = resolve(values.schemas);
      await mkdir(dir, { recursive: true });
      for (const [name, schema] of Object.entries(PUBLISHED_SCHEMAS)) {
        await writeFile(join(dir, name), prettyJson({ $schema: 'http://json-schema.org/draft-07/schema#', ...schema, $id: name }));
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
