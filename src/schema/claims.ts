/**
 * Afirmaciones competitivas ("claims"). Cada claim es atómico, atribuido a una
 * única fuente y lleva su procedencia completa.
 *
 * Los payloads se definen una sola vez y se instancian dos veces:
 *  - entrada editorial: las referencias a entidades aceptan nombre, alias o id;
 *  - salida (base generada): las referencias ya son ids canónicos del catálogo.
 */
import { Type, type Static, type TSchema, type TProperties } from '@sinclair/typebox';
import {
  ClaimContext, Confidence, DiscriminatedUnion, Excerpt, GameMode, IsoDate, Note, Obj, Patch,
  Provenance, Sample, Slug, Stat, StringEnum, SubstituteQuality, TeamRole, TierRole, Url, Verification,
} from './common.ts';

export const CLAIM_KINDS = [
  'tier', 'team', 'substitute', 'synergy', 'rotation', 'w_engine', 'drive_disc',
  'bangboo', 'investment', 'f2p_option', 'usage',
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

const Str = (max: number) => Type.String({ minLength: 1, maxLength: max });
const Rank = Type.Integer({ minimum: 1, maximum: 20, description: 'Orden de preferencia declarado por la fuente (1 = preferida).' });
const InputRef = Type.String({ minLength: 1, maxLength: 80, description: 'Id, nombre o alias de una entidad del catálogo.' });

function payloads<R extends TSchema>(ref: R) {
  return {
    tier: {
      agent: ref,
      role: TierRole,
      tier: Type.String({ minLength: 1, maxLength: 16, description: 'Etiqueta tal y como la publica la fuente (p. ej. "T0.5", "S").' }),
      tierScale: Type.Optional(Slug),
    },
    team: {
      name: Type.Optional(Str(80)),
      archetype: Type.Optional(Str(80)),
      members: Type.Array(Obj({
        agent: ref,
        role: TeamRole,
        substitutes: Type.Optional(Type.Array(Obj({
          agent: ref,
          quality: SubstituteQuality,
          note: Type.Optional(Str(200)),
        }), { maxItems: 6 })),
      }), { minItems: 2, maxItems: 3 }),
      bangboo: Type.Optional(Type.Array(Obj({ bangboo: ref, rank: Rank }), { maxItems: 5 })),
      rating: Type.Optional(Obj({ label: Str(16), scale: Type.Optional(Slug) }, { description: 'Valoración del equipo si la fuente la publica.' })),
    },
    substitute: {
      agent: ref,
      substitute: ref,
      quality: SubstituteQuality,
      withAgents: Type.Optional(Type.Array(ref, { maxItems: 2, description: 'Compañeros de equipo con los que la fuente valida la sustitución.' })),
      archetype: Type.Optional(Str(80)),
    },
    synergy: {
      agents: Type.Array(ref, { minItems: 2, maxItems: 3 }),
      polarity: Type.Union([Type.Literal('positive'), Type.Literal('negative'), Type.Literal('conditional')]),
      mechanism: Str(200),
    },
    rotation: {
      agents: Type.Array(ref, { minItems: 1, maxItems: 3 }),
      steps: Type.Array(Str(120), { minItems: 1, maxItems: 12, description: 'Pasos resumidos con palabras propias; no copiar guías.' }),
      notation: Type.Optional(Str(200)),
    },
    w_engine: {
      agent: ref,
      options: Type.Array(Obj({
        wEngine: ref,
        rank: Rank,
        f2p: Type.Optional(Type.Boolean({ description: 'Solo si la fuente lo señala como opción F2P.' })),
        note: Type.Optional(Str(200)),
      }), { minItems: 1, maxItems: 10 }),
    },
    drive_disc: {
      agent: ref,
      fourPiece: Type.Array(ref, { minItems: 1, maxItems: 4, description: 'Sets de 4 piezas en orden de preferencia.' }),
      twoPiece: Type.Array(ref, { maxItems: 6 }),
      mainStats: Obj({
        slot4: Type.Optional(Type.Array(Stat, { minItems: 1, maxItems: 4 })),
        slot5: Type.Optional(Type.Array(Stat, { minItems: 1, maxItems: 4 })),
        slot6: Type.Optional(Type.Array(Stat, { minItems: 1, maxItems: 4 })),
      }),
      substats: Type.Optional(Type.Array(Stat, { maxItems: 8, description: 'Prioridad de subestadísticas en orden.' })),
    },
    bangboo: {
      agent: Type.Optional(ref),
      team: Type.Optional(Type.Array(ref, { minItems: 2, maxItems: 3 })),
      options: Type.Array(Obj({ bangboo: ref, rank: Rank, note: Type.Optional(Str(200)) }), { minItems: 1, maxItems: 6 }),
    },
    investment: {
      agent: ref,
      aspect: StringEnum(['mindscape', 'signature_w_engine', 'skills', 'core_skill', 'general']),
      priority: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
      priorityLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 32, description: 'Etiqueta original de la fuente, si difiere de la normalizada.' })),
      mindscape: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
      note: Type.Optional(Str(200)),
    },
    f2p_option: {
      agent: Type.Optional(ref),
      category: StringEnum(['agent', 'w_engine', 'bangboo', 'drive_disc', 'team']),
      entities: Type.Array(ref, { minItems: 1, maxItems: 3 }),
      replaces: Type.Optional(ref),
      note: Type.Optional(Str(200)),
    },
    usage: {
      agents: Type.Array(ref, { minItems: 1, maxItems: 3, description: 'Un agente o un equipo completo.' }),
      metric: StringEnum(['usage_rate', 'pick_rate', 'clear_rate', 'other']),
      metricLabel: Type.Optional(Str(60)),
      value: Type.Number({ minimum: 0 }),
      unit: Type.Union([Type.Literal('percent'), Type.Literal('ratio'), Type.Literal('count')]),
    },
  } satisfies Record<ClaimKind, TProperties>;
}

/** Reglas condicionales adicionales por tipo. */
const KIND_RULES: Partial<Record<ClaimKind, object>> = {
  bangboo: { anyOf: [{ required: ['agent'] }, { required: ['team'] }] },
};

// ---------------------------------------------------------------------------
// Salida: claim normalizado en la base generada
// ---------------------------------------------------------------------------

export const ClaimStatus = StringEnum(
  ['current', 'stale', 'superseded', 'retracted'],
  { description: 'current: vigente; stale: antiguo; superseded: reemplazado por un dato más nuevo de la misma fuente; retracted: retirado.' },
);
export type ClaimStatus = Static<typeof ClaimStatus>;

export const CLAIM_FLAGS = [
  'unverified', // sin segunda revisión humana
  'patch_undeclared', // la fuente no declara parche
  'older_patch', // declarado para un parche anterior al actual
  'access_too_old', // consultado hace más de maxAgeDays de la fuente
  'pre_release', // consultado antes del lanzamiento del parche declarado (beta/filtración/preview)
  'carried_over', // la actualización de su fuente falló y se conserva el último valor válido
  'source_policy_changed', // recogido automáticamente pero la política actual de la fuente ya no lo permite
  'unverified_catalog_refs', // referencia entidades de catálogo aún sin verificar
] as const;
export type ClaimFlag = (typeof CLAIM_FLAGS)[number];

const basePayloads = payloads(Slug);
const P = {
  ...basePayloads,
  tier: {
    ...basePayloads.tier,
    tierScale: Slug,
    score: Type.Number({ minimum: 0, maximum: 1, description: 'Posición normalizada en la escala de la fuente (1 = mejor). La calcula este proyecto a partir de la escala registrada.' }),
  },
};

function outputBranch<K extends ClaimKind, T extends TProperties>(kind: K, payload: T) {
  const rule = KIND_RULES[kind] ?? {};
  return Obj({
    id: Type.String({ pattern: '^clm_[a-z0-9_]+_[0-9a-f]{12}$' }),
    kind: Type.Literal(kind),
    sourceId: Slug,
    slotKey: Type.String({ minLength: 1, description: 'Clave de "hueco": misma fuente + mismo slotKey = mismo dato en distintas versiones.' }),
    agentRefs: Type.Array(Slug, { uniqueItems: true, description: 'Todos los agentes mencionados, para indexar.' }),
    payload: Obj(payload, rule),
    context: ClaimContext,
    provenance: Provenance,
    status: ClaimStatus,
    flags: Type.Array(StringEnum([...CLAIM_FLAGS]), { uniqueItems: true }),
    firstSeenAt: IsoDate,
    supersededBy: Type.Optional(Type.String()),
  });
}

export const Claim = DiscriminatedUnion([
  outputBranch('tier', P.tier), outputBranch('team', P.team), outputBranch('substitute', P.substitute),
  outputBranch('synergy', P.synergy), outputBranch('rotation', P.rotation), outputBranch('w_engine', P.w_engine),
  outputBranch('drive_disc', P.drive_disc), outputBranch('bangboo', P.bangboo), outputBranch('investment', P.investment),
  outputBranch('f2p_option', P.f2p_option), outputBranch('usage', P.usage),
], { $id: 'claim.schema.json', title: 'Claim' });
export type Claim = Static<typeof Claim>;
export type ClaimOf<K extends ClaimKind> = Extract<Claim, { kind: K }>;

// ---------------------------------------------------------------------------
// Entrada: envío editorial manual (un fichero = una consulta a una fuente)
// ---------------------------------------------------------------------------

const InputEvidence = Obj({
  evidenceType: Type.Optional(Type.Union([Type.Literal('explicit_recommendation'), Type.Literal('observed_data'), Type.Literal('internal_estimate')])),
  confidence: Type.Optional(Confidence),
  url: Type.Optional(Url),
  excerpt: Type.Optional(Excerpt),
  notes: Type.Optional(Note),
  rationale: Type.Optional(Note),
  sample: Type.Optional(Sample),
}, { description: 'Sobrescribe para este claim los valores por defecto del envío.' });

const I = payloads(InputRef);

function inputBranch<K extends ClaimKind, T extends TProperties>(kind: K, payload: T) {
  const rule = KIND_RULES[kind] ?? {};
  return Obj({
    kind: Type.Literal(kind),
    ...payload,
    mode: Type.Optional(GameMode),
    modeDetail: Type.Optional(Str(100)),
    conditions: Type.Optional(Type.Array(Str(100), { maxItems: 6 })),
    evidence: Type.Optional(InputEvidence),
    retracted: Type.Optional(Type.Boolean({ description: 'Marca el dato como retirado por la fuente.' })),
  }, rule);
}

export const InputClaim = DiscriminatedUnion([
  inputBranch('tier', I.tier), inputBranch('team', I.team), inputBranch('substitute', I.substitute),
  inputBranch('synergy', I.synergy), inputBranch('rotation', I.rotation), inputBranch('w_engine', I.w_engine),
  inputBranch('drive_disc', I.drive_disc), inputBranch('bangboo', I.bangboo), inputBranch('investment', I.investment),
  inputBranch('f2p_option', I.f2p_option), inputBranch('usage', I.usage),
], { title: 'InputClaim' });
export type InputClaim = Static<typeof InputClaim>;

export const EditorialSubmission = Obj({
  $schema: Type.Optional(Type.String()),
  sourceId: Slug,
  url: Url,
  title: Type.Optional(Str(160)),
  accessedAt: IsoDate,
  declaredPatch: Type.Union([Patch, Type.Null()]),
  collectedBy: Str(80),
  evidenceType: Type.Union([Type.Literal('explicit_recommendation'), Type.Literal('observed_data'), Type.Literal('internal_estimate')]),
  confidence: Confidence,
  verification: Verification,
  mode: Type.Optional(GameMode),
  notes: Type.Optional(Note),
  claims: Type.Array(InputClaim, { minItems: 1, maxItems: 500 }),
}, { $id: 'editorial-submission.schema.json', title: 'EditorialSubmission' });
export type EditorialSubmission = Static<typeof EditorialSubmission>;

