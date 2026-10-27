/**
 * Tipos y esquemas compartidos. Cada esquema TypeBox es a la vez un JSON Schema
 * (exportado a /schemas) y un tipo estático de TypeScript (Static<...>).
 */
import { Type, type Static, type TSchema, type TObject, type TProperties, type ObjectOptions } from '@sinclair/typebox';

/** Objeto cerrado: rechaza propiedades no declaradas para detectar errores de tipeo. */
export function Obj<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
  return Type.Object(properties, { additionalProperties: false, ...options });
}

/** Unión discriminada por `kind`, emitida como oneOf + discriminator (Ajv la valida con mensajes claros). */
export function DiscriminatedUnion<T extends TSchema[]>(schemas: [...T], options: { $id?: string; title?: string; description?: string } = {}) {
  const union = Type.Union(schemas);
  return Type.Unsafe<Static<typeof union>>({
    ...options,
    type: 'object',
    required: ['kind'],
    discriminator: { propertyName: 'kind' },
    oneOf: schemas,
  });
}

export function StringEnum<T extends string[]>(values: [...T], options: { description?: string } = {}) {
  return Type.Unsafe<T[number]>({ type: 'string', enum: values, ...options });
}

export const Slug = Type.String({
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  maxLength: 64,
  description: 'Identificador estable en kebab-case (p. ej. "zhu-yuan").',
});
export type Slug = Static<typeof Slug>;

export const Patch = Type.String({ pattern: '^[0-9]+\\.[0-9]+$', description: 'Versión del juego, "MAYOR.MENOR" (p. ej. "3.3").' });
export type Patch = Static<typeof Patch>;

export const IsoDate = Type.String({ format: 'date', description: 'Fecha ISO 8601 (AAAA-MM-DD).' });
export const IsoDateTime = Type.String({ format: 'date-time' });
export const Url = Type.String({ format: 'uri', pattern: '^https?://', maxLength: 500 });

/**
 * Código del vocabulario del juego (atributos, especialidades, estadísticas…).
 * Los valores válidos viven en data/game.json, no en el código: así un parche
 * que añade un atributo o especialidad nueva solo requiere editar datos.
 */
export const GameCode = Type.String({ pattern: '^[a-z][a-z0-9_]*$', maxLength: 40 });

export const Attribute = GameCode;
export type Attribute = string;
export const Specialty = GameCode;
export type Specialty = string;
/** Rol evaluado en una tier list (especialidades de data/game.json + roles extra como "sub_dps"). */
export const TierRole = GameCode;
export type TierRole = string;

/** Función de un agente dentro de un equipo concreto (distinta de su especialidad). */
export const TeamRole = StringEnum(['main_dps', 'sub_dps', 'stunner', 'support', 'anomaly', 'defense', 'flex']);
export type TeamRole = Static<typeof TeamRole>;

export const GameMode = StringEnum(['general', 'shiyu_defense', 'deadly_assault', 'lost_void', 'other'], {
  description: 'Modo para el que la fuente declara la evaluación. "general" si no lo especifica.',
});
export type GameMode = Static<typeof GameMode>;

/**
 * Tipo de evidencia (punto 4 de los requisitos):
 * - explicit_recommendation: la fuente lo recomienda explícitamente.
 * - observed_data: dato observado/medido publicado por la fuente (uso, clears...).
 * - cross_source_consensus: derivado por este proyecto al combinar varias fuentes (solo en /derived).
 * - internal_estimate: estimación propia del mantenedor; nunca se presenta como hecho.
 */
export const EvidenceType = StringEnum(['explicit_recommendation', 'observed_data', 'cross_source_consensus', 'internal_estimate']);
export type EvidenceType = Static<typeof EvidenceType>;

export const Confidence = StringEnum(['high', 'medium', 'low']);
export type Confidence = Static<typeof Confidence>;

/**
 * - manual_entry: una persona leyó la página original.
 * - web_search: resumen de un buscador que cita la página; nunca verificado y nunca confianza alta.
 * - derived: calculado por este proyecto (consenso).
 */
export const CollectionMethod = StringEnum(['manual_entry', 'web_search', 'derived']);
export type CollectionMethod = Static<typeof CollectionMethod>;

export const Verification = Obj({
  state: StringEnum(['verified', 'unverified']),
  reviewedBy: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  reviewedAt: Type.Optional(IsoDate),
}, {
  description: '"verified" exige una segunda revisión humana contra la fuente (quién y cuándo).',
  if: { properties: { state: { const: 'verified' } } },
  then: { required: ['reviewedBy', 'reviewedAt'] },
});
export type Verification = Static<typeof Verification>;

/** Fragmento corto opcional. Límite estricto para impedir copiar artículos. */
export const Excerpt = Type.String({ minLength: 1, maxLength: 200, description: 'Cita breve (≤200 caracteres) que justifica el dato. Nunca párrafos completos.' });
export const Note = Type.String({ minLength: 1, maxLength: 500 });

export const Sample = Obj({
  description: Type.String({ minLength: 1, maxLength: 300, description: 'Qué muestra declara la fuente (modo, ciclo, servidor, etc.).' }),
  size: Type.Optional(Type.Integer({ minimum: 1, description: 'Tamaño de muestra SOLO si la fuente lo publica.' })),
  period: Type.Optional(Type.String({ maxLength: 100 })),
});

/**
 * Procedencia obligatoria para cada dato (punto 3). Reglas condicionales:
 * - internal_estimate → `rationale` obligatorio y confianza distinta de "high".
 * - observed_data → `sample` obligatorio.
 * - cross_source_consensus → `derivedFrom` obligatorio.
 * - web_search → nunca "verified" ni confianza "high": hay que leer la página para verificarlo.
 */
export const Provenance = Obj({
  sourceId: Slug,
  url: Url,
  accessedAt: IsoDate,
  pageUpdatedAt: Type.Optional(IsoDate),
  declaredPatch: Type.Union([Patch, Type.Null()], { description: 'Parche que declara la fuente; null si no lo declara.' }),
  evidenceType: EvidenceType,
  confidence: Confidence,
  collectionMethod: CollectionMethod,
  collectedBy: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  excerpt: Type.Optional(Excerpt),
  notes: Type.Optional(Note),
  rationale: Type.Optional(Note),
  sample: Type.Optional(Sample),
  derivedFrom: Type.Optional(Type.Array(Type.String(), { minItems: 2 })),
  verification: Verification,
}, {
  allOf: [
    {
      if: { properties: { evidenceType: { const: 'internal_estimate' } } },
      then: { required: ['rationale'], properties: { confidence: { enum: ['medium', 'low'] } } },
    },
    {
      if: { properties: { evidenceType: { const: 'observed_data' } } },
      then: { required: ['sample'] },
    },
    {
      if: { properties: { evidenceType: { const: 'cross_source_consensus' } } },
      then: { required: ['derivedFrom'], properties: { collectionMethod: { const: 'derived' } } },
    },
    {
      if: { properties: { collectionMethod: { const: 'web_search' } } },
      then: { properties: { confidence: { enum: ['medium', 'low'] }, verification: { type: 'object', properties: { state: { const: 'unverified' } } } } },
    },
  ],
});
export type Provenance = Static<typeof Provenance>;

export const ClaimContext = Obj({
  mode: GameMode,
  modeDetail: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Detalle libre del modo (p. ej. "Shiyu nodo 7, mitad 1").' })),
  conditions: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 6, description: 'Condiciones declaradas por la fuente (p. ej. "requiere M2").' })),
});
export type ClaimContext = Static<typeof ClaimContext>;

/** Estadística de Drive Disc. Lista y reglas por ranura en data/game.json. */
export const Stat = GameCode;
export type Stat = string;

/** Calidad declarada de un sustituto. "unspecified" si la fuente no la matiza. */
export const SubstituteQuality = StringEnum(['near_equivalent', 'workable', 'significant_downgrade', 'unspecified']);
export type SubstituteQuality = Static<typeof SubstituteQuality>;
