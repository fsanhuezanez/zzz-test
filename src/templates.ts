/**
 * Plantillas para `new-submission`. Los valores entre << >> son marcadores que
 * hacen fallar la validación hasta que un editor los sustituye.
 */
import type { ClaimKind } from './schema/claims.ts';

const AGENT = '<<agente: id, nombre o alias>>';

export const CLAIM_TEMPLATES: Record<ClaimKind, Record<string, unknown>> = {
  tier: { kind: 'tier', agent: AGENT, role: 'attack', tier: '<<etiqueta exacta de la fuente>>' },
  team: {
    kind: 'team',
    archetype: '<<arquetipo, opcional>>',
    stance: 'recommended',
    members: [
      { agent: AGENT, role: 'main_dps' },
      { agent: AGENT, role: 'stunner', substitutes: [{ agent: AGENT, quality: 'unspecified' }] },
    ],
    flex: [{ pick: 1, role: 'support', options: [AGENT, AGENT] }],
    requirements: [{ text: '<<condición que declara la fuente; borra si no hay>>', level: 'required' }],
    limitations: ['<<debilidad que declara la fuente; borra si no hay>>'],
    bangboo: [{ bangboo: '<<Bangboo>>', rank: 1 }],
  },
  substitute: { kind: 'substitute', agent: AGENT, substitute: AGENT, quality: 'unspecified' },
  synergy: { kind: 'synergy', agents: [AGENT, AGENT], polarity: 'positive', mechanism: '<<mecanismo, con palabras propias>>' },
  rotation: { kind: 'rotation', agents: [AGENT, AGENT, AGENT], steps: ['<<paso resumido>>'] },
  w_engine: { kind: 'w_engine', agent: AGENT, options: [{ wEngine: '<<W-Engine>>', rank: 1 }] },
  drive_disc: {
    kind: 'drive_disc', agent: AGENT, fourPiece: ['<<set 4 piezas>>'], twoPiece: ['<<set 2 piezas>>'],
    mainStats: { slot4: ['crit_rate'], slot5: ['atk_pct'], slot6: ['atk_pct'] },
    substats: ['crit_rate', 'crit_dmg', 'atk_pct'],
  },
  bangboo: { kind: 'bangboo', agent: AGENT, options: [{ bangboo: '<<Bangboo>>', rank: 1 }] },
  investment: { kind: 'investment', agent: AGENT, aspect: 'mindscape', mindscape: 0, priority: 'medium', priorityLabel: '<<texto original, opcional>>' },
  f2p_option: { kind: 'f2p_option', agent: AGENT, category: 'w_engine', entities: ['<<W-Engine F2P>>'] },
  usage: {
    kind: 'usage', agents: [AGENT], metric: 'usage_rate', value: 0, unit: 'percent',
    evidence: { evidenceType: 'observed_data', sample: { description: '<<qué muestra declara la fuente>>' } },
  },
};

/** Plantillas predefinidas para lo más habitual. */
export const PRESETS: Record<string, ClaimKind[]> = {
  team: ['team', 'substitute'],
  build: ['w_engine', 'drive_disc', 'f2p_option', 'investment', 'bangboo'],
  tier: ['tier'],
  all: ['team', 'substitute', 'w_engine', 'drive_disc', 'f2p_option', 'investment', 'bangboo', 'synergy', 'rotation'],
};

export function submissionTemplate(args: { sourceId: string; url: string; patch: string; date: string; collectedBy: string; kinds: ClaimKind[] }) {
  return {
    $schema: '../../../schemas/editorial-submission.schema.json',
    sourceId: args.sourceId,
    url: args.url,
    title: '<<título de la página consultada>>',
    accessedAt: args.date,
    pageUpdatedAt: '<<fecha de actualización que muestra la página; borra si no la muestra>>',
    declaredPatch: args.patch,
    collectedBy: args.collectedBy,
    collectionMethod: 'manual_entry',
    evidenceType: 'explicit_recommendation',
    confidence: 'medium',
    verification: { state: 'unverified' },
    mode: 'general',
    claims: args.kinds.map((k) => CLAIM_TEMPLATES[k]),
  };
}
