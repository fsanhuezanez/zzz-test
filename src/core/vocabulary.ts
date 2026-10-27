/**
 * Vocabulario del juego cargado desde data/game.json (atributos, especialidades,
 * roles de tier y estadísticas por ranura).
 */
import type { GameVocabulary } from '../schema/catalog.ts';

export class Vocabulary {
  readonly attributes: Set<string>;
  readonly specialties: Set<string>;
  readonly tierRoles: Set<string>;
  readonly stats: Set<string>;
  private readonly slots: Record<'slot4' | 'slot5' | 'slot6', Set<string>>;
  readonly substats: Set<string>;

  constructor(v: GameVocabulary) {
    this.attributes = new Set(v.attributes.map((a) => a.id));
    this.specialties = new Set(v.specialties.map((s) => s.id));
    this.tierRoles = new Set([...this.specialties, ...v.extraTierRoles.map((r) => r.id)]);
    const elementDmg = [...this.attributes].map((a) => `${a}_dmg`);
    this.stats = new Set([...v.stats.all, ...elementDmg]);
    this.slots = {
      slot4: new Set(v.stats.slot4),
      slot5: new Set([...v.stats.slot5, ...elementDmg]),
      slot6: new Set(v.stats.slot6),
    };
    this.substats = new Set(v.stats.substats);
    const unknown = [...v.stats.slot4, ...v.stats.slot5, ...v.stats.slot6, ...v.stats.substats].filter((s) => !this.stats.has(s));
    if (unknown.length) throw new Error(`data/game.json: estadísticas por ranura no declaradas en stats.all: ${[...new Set(unknown)].join(', ')}`);
  }

  slotAllows(slot: 'slot4' | 'slot5' | 'slot6', stat: string): boolean {
    return this.slots[slot].has(stat);
  }

  list(set: Set<string>): string {
    return [...set].sort().join(', ');
  }
}
