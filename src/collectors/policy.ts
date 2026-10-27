/**
 * Puerta de políticas: ninguna recogida automatizada se ejecuta si el registro
 * de fuentes no la autoriza explícitamente. "unknown" equivale a "disallowed".
 */
import type { CollectionMethod } from '../schema/common.ts';
import type { Source } from '../schema/sources.ts';

export class PolicyError extends Error {}

export function automationDecision(source: Source, method: CollectionMethod): { allowed: true } | { allowed: false; reason: string } {
  if (method === 'manual_entry' || method === 'derived') {
    return { allowed: false, reason: `"${method}" no es un método automatizado` };
  }
  if (source.automation.status !== 'allowed') {
    return {
      allowed: false,
      reason: `automatización ${source.automation.status === 'unknown' ? 'sin autorización conocida' : 'prohibida'} para "${source.id}": ${source.automation.basis}`,
    };
  }
  if (!source.automation.allowedMethods.includes(method)) {
    return { allowed: false, reason: `"${source.id}" no autoriza el método "${method}"` };
  }
  if (!source.automation.evidenceUrls.length) {
    return { allowed: false, reason: `"${source.id}" marca allowed sin evidencia (evidenceUrls vacío)` };
  }
  return { allowed: true };
}

export function assertAutomationAllowed(source: Source, method: CollectionMethod): void {
  const decision = automationDecision(source, method);
  if (!decision.allowed) throw new PolicyError(decision.reason);
}
