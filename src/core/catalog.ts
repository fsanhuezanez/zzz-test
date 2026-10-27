/**
 * Catálogo: carga, comprobaciones de integridad y resolución de nombres/alias a ids.
 */
import type { Catalog } from '../schema/catalog.ts';

export type EntityType = 'agent' | 'wEngine' | 'driveDisc' | 'bangboo';

interface Named {
  id: string;
  name: string;
  aliases: string[];
  provenance: { verification: { state: string } };
}

const LABEL: Record<EntityType, string> = {
  agent: 'agente', wEngine: 'W-Engine', driveDisc: 'Drive Disc', bangboo: 'Bangboo',
};

/** Clave de comparación: minúsculas, sin acentos ni signos. "Von Lycaon" → "vonlycaon". */
export function nameKey(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export class ResolveError extends Error {}

export class CatalogIndex {
  readonly catalog: Catalog;
  private readonly keys = new Map<EntityType, Map<string, string>>();
  private readonly byId = new Map<EntityType, Map<string, Named>>();

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    const groups: [EntityType, Named[]][] = [
      ['agent', catalog.agents], ['wEngine', catalog.wEngines], ['driveDisc', catalog.driveDiscs], ['bangboo', catalog.bangboo],
    ];
    const problems: string[] = [];
    for (const [type, items] of groups) {
      const keys = new Map<string, string>();
      const ids = new Map<string, Named>();
      for (const item of items) {
        if (ids.has(item.id)) problems.push(`${LABEL[type]} con id duplicado "${item.id}"`);
        ids.set(item.id, item);
        for (const label of [item.id, item.name, ...item.aliases]) {
          const key = nameKey(label);
          const existing = keys.get(key);
          if (existing && existing !== item.id) problems.push(`alias ambiguo "${label}": ${existing} / ${item.id} (${LABEL[type]})`);
          keys.set(key, item.id);
        }
      }
      this.keys.set(type, keys);
      this.byId.set(type, ids);
    }
    for (const w of catalog.wEngines) {
      if (w.signatureOf && !this.byId.get('agent')!.has(w.signatureOf)) {
        problems.push(`W-Engine "${w.id}" declara signatureOf "${w.signatureOf}", que no existe en el catálogo de agentes`);
      }
    }
    if (problems.length) throw new Error('Catálogo inválido:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  }

  has(type: EntityType, id: string): boolean {
    return this.byId.get(type)!.has(id);
  }

  get(type: EntityType, id: string): Named | undefined {
    return this.byId.get(type)!.get(id);
  }

  isVerified(type: EntityType, id: string): boolean {
    return this.get(type, id)?.provenance.verification.state === 'verified';
  }

  /** Resuelve id, nombre o alias. Lanza ResolveError con sugerencias si no existe. */
  resolve(type: EntityType, ref: string): string {
    const id = this.keys.get(type)!.get(nameKey(ref));
    if (id) return id;
    const key = nameKey(ref);
    const suggestions = [...this.byId.get(type)!.values()]
      .map((e) => ({ e, d: Math.min(...[e.id, e.name, ...e.aliases].map((l) => levenshtein(key, nameKey(l)))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .filter((s) => s.d <= Math.max(3, key.length / 2))
      .map((s) => s.e.name);
    const hint = suggestions.length ? ` ¿Quizá: ${suggestions.join(', ')}?` : '';
    throw new ResolveError(`${LABEL[type]} desconocido "${ref}".${hint} Si es nuevo, añádelo a data/catalog.`);
  }

  allIds(type: EntityType): string[] {
    return [...this.byId.get(type)!.keys()];
  }
}
