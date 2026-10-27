/**
 * Catálogo de entidades del juego (hechos, no opiniones competitivas).
 * Las afirmaciones competitivas viven en claims.ts y referencian estos ids.
 */
import { Type, type Static } from '@sinclair/typebox';
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

export const Agent = Obj({
  id: Slug,
  name: Name,
  aliases: Aliases,
  rarity: Rarity,
  attribute: Attribute,
  attributeVariant: Type.Optional(Type.String({ minLength: 1, maxLength: 40, description: 'Variante de atributo, si existe (p. ej. "Frost").' })),
  specialty: Specialty,
  faction: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  releasePatch: Type.Optional(Patch),
  provenance: EntityProvenance,
});
export type Agent = Static<typeof Agent>;

export const WEngine = Obj({
  id: Slug,
  name: Name,
  aliases: Aliases,
  rarity: Rarity,
  specialty: Specialty,
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
  rarity: Type.Union([Type.Literal('S'), Type.Literal('A')]),
  provenance: EntityProvenance,
});
export type Bangboo = Static<typeof Bangboo>;

export const CatalogFile = <T extends ReturnType<typeof Obj>>(item: T, id: string) =>
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
