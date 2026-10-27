/**
 * Catálogo de entidades del juego (hechos, no opiniones competitivas).
 * Las afirmaciones competitivas viven en claims.ts y referencian estos ids.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Attribute, CollectionMethod, IsoDate, Note, Obj, Patch, Slug, Specialty, Url, Verification } from './common.ts';

export const EntityProvenance = Obj({
  sourceId: Slug,
  url: Type.Optional(Url),
  accessedAt: IsoDate,
  collectionMethod: CollectionMethod,
  verification: Verification,
  notes: Type.Optional(Note),
});
export type EntityProvenance = Static<typeof EntityProvenance>;

const Rarity = Type.Union([Type.Literal('S'), Type.Literal('A'), Type.Literal('B')]);
const Name = Type.String({ minLength: 1, maxLength: 80 });
const Aliases = Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
  uniqueItems: true,
  description: 'Nombres alternativos usados por las fuentes; sirven para normalizar entradas.',
});

/**
 * Rareza, atributo y especialidad son opcionales: un agente nuevo puede darse de
 * alta solo con su nombre y completarse cuando alguien lo verifique en el juego.
 */
export const Agent = Obj({
  id: Slug,
  name: Name,
  aliases: Aliases,
  rarity: Type.Optional(Rarity),
  attribute: Type.Optional(Attribute),
  attributeVariant: Type.Optional(Type.String({ minLength: 1, maxLength: 40, description: 'Variante de atributo, si existe (p. ej. "Frost").' })),
  specialty: Type.Optional(Specialty),
  faction: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  releasePatch: Type.Optional(Patch),
  provenance: EntityProvenance,
});
export type Agent = Static<typeof Agent>;

export const WEngine = Obj({
  id: Slug,
  name: Name,
  aliases: Aliases,
  rarity: Type.Optional(Rarity),
  specialty: Type.Optional(Specialty),
  signatureOf: Type.Optional(Slug),
  provenance: EntityProvenance,
});
export type WEngine = Static<typeof WEngine>;

export const DriveDisc = Obj({
  id: Slug,
  name: Name,
  aliases: Aliases,
  provenance: EntityProvenance,
});
export type DriveDisc = Static<typeof DriveDisc>;

export const Bangboo = Obj({
  id: Slug,
  name: Name,
  aliases: Aliases,
  rarity: Type.Optional(Type.Union([Type.Literal('S'), Type.Literal('A')])),
  provenance: EntityProvenance,
});
export type Bangboo = Static<typeof Bangboo>;

export const CatalogFile = <T extends TSchema>(item: T, id: string) =>
  Obj({ $schema: Type.Optional(Type.String()), items: Type.Array(item) }, { $id: id });

export const AgentCatalogFile = CatalogFile(Agent, 'agent-catalog.schema.json');
export const WEngineCatalogFile = CatalogFile(WEngine, 'w-engine-catalog.schema.json');
export const DriveDiscCatalogFile = CatalogFile(DriveDisc, 'drive-disc-catalog.schema.json');
export const BangbooCatalogFile = CatalogFile(Bangboo, 'bangboo-catalog.schema.json');

export interface Catalog {
  agents: Agent[];
  wEngines: WEngine[];
  driveDiscs: DriveDisc[];
  bangboo: Bangboo[];
}

/** Vocabulario del juego editable sin tocar código (data/game.json). */
const Term = Obj({
  id: Type.String({ pattern: '^[a-z][a-z0-9_]*$', maxLength: 40 }),
  label: Type.String({ minLength: 1, maxLength: 60 }),
  verified: Type.Boolean(),
  notes: Type.Optional(Note),
});

export const GameVocabularyFile = Obj({
  $schema: Type.Optional(Type.String()),
  attributes: Type.Array(Term, { minItems: 1 }),
  specialties: Type.Array(Term, { minItems: 1 }),
  extraTierRoles: Type.Array(Term, { description: 'Roles de tier list además de las especialidades (p. ej. sub_dps, overall).' }),
  stats: Obj({
    all: Type.Array(Type.String({ pattern: '^[a-z][a-z0-9_]*$' }), { minItems: 1, description: 'Estadísticas conocidas. Las de daño elemental (<atributo>_dmg) se añaden solas.' }),
    slot4: Type.Array(Type.String()),
    slot5: Type.Array(Type.String(), { description: 'Además de estas, la ranura 5 acepta <atributo>_dmg de cada atributo.' }),
    slot6: Type.Array(Type.String()),
    substats: Type.Array(Type.String()),
  }),
}, { $id: 'game-vocabulary.schema.json' });
export type GameVocabulary = Static<typeof GameVocabularyFile>;
