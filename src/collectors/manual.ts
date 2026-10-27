/**
 * Recolector editorial: lee los envíos manuales de data/editorial/**.json.
 * Se ignoran ficheros que empiezan por "_" y borradores "*.draft.json".
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CollectedSubmission } from './types.ts';

export interface ManualScan {
  submissions: CollectedSubmission[];
  drafts: string[];
  parseErrors: { file: string; message: string }[];
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.isFile() && e.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

export async function scanEditorial(editorialDir: string, baseDir: string): Promise<ManualScan> {
  const scan: ManualScan = { submissions: [], drafts: [], parseErrors: [] };
  for (const file of await walk(editorialDir)) {
    const rel = relative(baseDir, file);
    const name = file.split(/[\\/]/).pop()!;
    if (name.startsWith('_')) continue;
    if (name.endsWith('.draft.json')) {
      scan.drafts.push(rel);
      continue;
    }
    try {
      scan.submissions.push({ origin: rel, method: 'manual_entry', data: JSON.parse(await readFile(file, 'utf8')) });
    } catch (err) {
      scan.parseErrors.push({ file: rel, message: `JSON inválido: ${(err as Error).message}` });
    }
  }
  return scan;
}
