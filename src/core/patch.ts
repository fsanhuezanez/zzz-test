/** Utilidades de versiones de parche ("3.3") y fechas. */

export function parsePatch(patch: string): [number, number] {
  const m = /^(\d+)\.(\d+)$/.exec(patch);
  if (!m) throw new Error(`Parche inválido "${patch}" (formato esperado MAYOR.MENOR, p. ej. 3.3)`);
  return [Number(m[1]), Number(m[2])];
}

export function comparePatch(a: string, b: string): number {
  const [a1, a2] = parsePatch(a);
  const [b1, b2] = parsePatch(b);
  return a1 !== b1 ? a1 - b1 : a2 - b2;
}

export function daysBetween(fromIsoDate: string, to: Date): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
  return Math.floor((to.getTime() - from) / 86_400_000);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
