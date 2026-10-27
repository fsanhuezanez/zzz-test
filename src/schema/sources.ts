/**
 * Registro de fuentes: quién es cada fuente, qué permiten sus condiciones y cómo
 * se normalizan sus escalas de tier.
 */
import { Type, type Static } from '@sinclair/typebox';
import { IsoDate, Note, Obj, Patch, Slug, StringEnum, Url } from './common.ts';

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

/**
 * Lo que permiten las condiciones de la fuente. Este proyecto no automatiza la
 * recogida de ninguna fuente: el registro documenta por qué, y deja constancia
 * de las dudas para revisarlas si la situación cambia.
 */
export const AutomationPolicy = Obj({
  status: StringEnum(['allowed', 'disallowed', 'unknown'], {
    description: 'allowed: permiso explícito o API/feed con licencia; disallowed: las condiciones lo prohíben; unknown: sin información (NO equivale a permiso).',
  }),
  basis: Note,
  checkedAt: IsoDate,
  checkedVia: StringEnum(['browser', 'web_search'], { description: 'Cómo se leyeron las condiciones. web_search = pendiente de releer en navegador.' }),
  evidenceUrls: Type.Array(Url, { description: 'Términos, robots.txt, correo de permiso, documentación de API...' }),
  openQuestions: Type.Optional(Type.Array(Note, { description: 'Dudas sobre las condiciones y la alternativa prudente adoptada.' })),
});
export type AutomationPolicy = Static<typeof AutomationPolicy>;

export const Source = Obj({
  id: Slug,
  name: Type.String({ minLength: 1, maxLength: 80 }),
  kind: StringEnum(['community_guide', 'media', 'stats_site', 'database', 'official', 'internal', 'fixture'], {
    description: 'media = prensa de videojuegos (agrega y resume); fixture = ficticia, solo para pruebas.',
  }),
  homepage: Url,
  termsUrl: Type.Optional(Url),
  attribution: Type.String({ minLength: 1, maxLength: 200, description: 'Texto de atribución a mostrar junto a sus datos.' }),
  automation: AutomationPolicy,
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
