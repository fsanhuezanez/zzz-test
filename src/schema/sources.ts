/**
 * Registro de fuentes: quién es cada fuente, qué permiten sus condiciones y cómo
 * se normalizan sus escalas de tier. El registro es la única puerta de entrada
 * para habilitar automatización.
 */
import { Type, type Static } from '@sinclair/typebox';
import { CollectionMethod, IsoDate, Note, Obj, Patch, Slug, StringEnum, Url } from './common.ts';

export const TierScale = Obj({
  id: Slug,
  labels: Type.Array(Obj({
    label: Type.String({ minLength: 1, maxLength: 16 }),
    score: Type.Number({ minimum: 0, maximum: 1 }),
  }), { minItems: 2 }),
  confirmed: Type.Boolean({ description: 'true solo cuando un editor ha comprobado las etiquetas contra la página de la fuente.' }),
  notes: Type.Optional(Note),
});
export type TierScale = Static<typeof TierScale>;

export const AutomationPolicy = Obj({
  status: StringEnum(['allowed', 'disallowed', 'unknown'], {
    description: 'allowed: hay permiso explícito o API/feed con licencia; disallowed: las condiciones lo prohíben; unknown: sin información → se trata como disallowed.',
  }),
  basis: Note,
  checkedAt: IsoDate,
  evidenceUrls: Type.Array(Url, { description: 'Términos, robots.txt, correo de permiso, documentación de API...' }),
  allowedMethods: Type.Array(CollectionMethod, { minItems: 1 }),
});
export type AutomationPolicy = Static<typeof AutomationPolicy>;

export const HttpFeedAdapter = Obj({
  type: Type.Literal('http_json_feed'),
  url: Url,
  method: StringEnum(['automated_api', 'automated_feed']),
  minIntervalMs: Type.Integer({ minimum: 1000, description: 'Pausa mínima entre peticiones.' }),
  timeoutMs: Type.Integer({ minimum: 1000, maximum: 120000 }),
  respectRobotsTxt: Type.Literal(true),
});
export type HttpFeedAdapter = Static<typeof HttpFeedAdapter>;

export const Source = Obj({
  id: Slug,
  name: Type.String({ minLength: 1, maxLength: 80 }),
  kind: StringEnum(['community_guide', 'stats_site', 'database', 'official', 'internal', 'fixture']),
  homepage: Url,
  termsUrl: Type.Optional(Url),
  attribution: Type.String({ minLength: 1, maxLength: 200, description: 'Texto de atribución a mostrar junto a sus datos.' }),
  automation: AutomationPolicy,
  adapter: Type.Optional(HttpFeedAdapter),
  defaultTierScale: Type.Optional(Slug),
  tierScales: Type.Array(TierScale),
  maxAgeDays: Type.Integer({ minimum: 1, maximum: 365, description: 'Días tras los que un dato consultado se marca access_too_old.' }),
  notes: Type.Optional(Note),
});
export type Source = Static<typeof Source>;

export const SourceRegistryFile = Obj({
  $schema: Type.Optional(Type.String()),
  sources: Type.Array(Source, { minItems: 1 }),
}, { $id: 'source-registry.schema.json' });
export type SourceRegistryFile = Static<typeof SourceRegistryFile>;

export const PatchCalendarFile = Obj({
  $schema: Type.Optional(Type.String()),
  patches: Type.Array(Obj({
    patch: Patch,
    releaseDate: IsoDate,
    source: Url,
    verified: Type.Boolean(),
  })),
}, { $id: 'patch-calendar.schema.json' });
export type PatchCalendarFile = Static<typeof PatchCalendarFile>;
