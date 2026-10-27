/**
 * Informe de actualización: qué se actualizó, qué está desactualizado y qué
 * necesita revisión manual. Se emite en JSON (máquinas) y Markdown (personas).
 */
import type { Catalog } from '../schema/catalog.ts';
import type { Claim, ClaimFlag } from '../schema/claims.ts';
import type { Changelog, SourceSummary } from '../schema/database.ts';
import type { PatchCalendarFile, Source } from '../schema/sources.ts';
import type { InputIssue } from './normalize.ts';

export type UpdateOutcome = 'published' | 'unchanged' | 'failed' | 'dry_run';

interface ClaimLine {
  id: string;
  sourceId: string;
  slotKey: string;
  status: string;
  flags: ClaimFlag[];
}

export interface UpdateReport {
  outcome: UpdateOutcome;
  gamePatch: string;
  dataVersion: string | null;
  previousDataVersion: string | null;
  generatedAt: string;
  errors: InputIssue[];
  warnings: string[];
  sources: SourceSummary[];
  changes: Changelog | null;
  stale: ClaimLine[];
  pendingReview: {
    unverifiedClaims: ClaimLine[];
    patchUndeclared: ClaimLine[];
    preRelease: ClaimLine[];
    carriedOver: ClaimLine[];
    sourcePolicyChanged: ClaimLine[];
    sourcesWithoutCurrentData: { id: string; name: string; automation: string; action: string }[];
    agentsWithoutCurrentClaims: string[];
    unverifiedCatalogEntries: string[];
    unconfirmedTierScales: string[];
    unverifiedPatchDates: string[];
    drafts: string[];
  };
}

const line = (c: Claim): ClaimLine => ({ id: c.id, sourceId: c.sourceId, slotKey: c.slotKey, status: c.status, flags: c.flags });

export function buildPendingReview(args: {
  claims: Claim[];
  catalog: Catalog;
  sources: Source[];
  summaries: SourceSummary[];
  calendar: PatchCalendarFile['patches'];
  drafts: string[];
}): UpdateReport['pendingReview'] {
  const live = args.claims.filter((c) => c.status === 'current' || c.status === 'stale');
  const withFlag = (flag: ClaimFlag) => live.filter((c) => c.flags.includes(flag)).map(line);
  const current = args.claims.filter((c) => c.status === 'current');
  const covered = new Set(current.flatMap((c) => c.agentRefs));
  const unverified = (prefix: string, items: { id: string; provenance: { verification: { state: string } } }[]) =>
    items.filter((i) => i.provenance.verification.state !== 'verified').map((i) => `${prefix}:${i.id}`);

  return {
    unverifiedClaims: withFlag('unverified'),
    patchUndeclared: withFlag('patch_undeclared'),
    preRelease: withFlag('pre_release'),
    carriedOver: withFlag('carried_over'),
    sourcePolicyChanged: withFlag('source_policy_changed'),
    sourcesWithoutCurrentData: args.sources
      .filter((s) => s.kind !== 'internal' && s.kind !== 'official')
      .filter((s) => (args.summaries.find((x) => x.id === s.id)?.currentClaimCount ?? 0) === 0)
      .map((s) => ({
        id: s.id,
        name: s.name,
        automation: s.automation.status,
        action: s.automation.status === 'allowed' && s.adapter
          ? 'revisar el feed automatizado'
          : `pase editorial manual: npm run new-submission -- --source ${s.id}`,
      })),
    agentsWithoutCurrentClaims: args.catalog.agents.map((a) => a.id).filter((id) => !covered.has(id)).sort(),
    unverifiedCatalogEntries: [
      ...unverified('agent', args.catalog.agents), ...unverified('w-engine', args.catalog.wEngines),
      ...unverified('drive-disc', args.catalog.driveDiscs), ...unverified('bangboo', args.catalog.bangboo),
    ],
    unconfirmedTierScales: args.sources.flatMap((s) => s.tierScales.filter((t) => !t.confirmed).map((t) => `${s.id}/${t.id}`)),
    unverifiedPatchDates: args.calendar.filter((p) => !p.verified).map((p) => p.patch),
    drafts: args.drafts,
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const MAX_ROWS = 40;

function list<T>(items: T[], render: (item: T) => string): string {
  if (!items.length) return '_Ninguno._\n';
  const rows = items.slice(0, MAX_ROWS).map((i) => `- ${render(i)}`);
  if (items.length > MAX_ROWS) rows.push(`- … y ${items.length - MAX_ROWS} más (ver el informe JSON)`);
  return rows.join('\n') + '\n';
}

const claimRow = (c: ClaimLine) => `\`${c.slotKey}\` — ${c.sourceId} (${c.status}${c.flags.length ? `; ${c.flags.join(', ')}` : ''})`;

const OUTCOME_TEXT: Record<UpdateOutcome, string> = {
  published: '✅ Publicada nueva versión',
  unchanged: '➖ Sin cambios: se mantiene la versión existente',
  failed: '❌ Actualización fallida: se conserva la última versión válida',
  dry_run: '🧪 Simulación (dry run): no se escribió nada',
};

export function renderMarkdown(r: UpdateReport): string {
  const out: string[] = [];
  out.push(`# Informe de actualización — parche ${r.gamePatch}\n`);
  out.push(`- Resultado: **${OUTCOME_TEXT[r.outcome]}**`);
  out.push(`- Versión de datos: \`${r.dataVersion ?? '—'}\` (anterior: \`${r.previousDataVersion ?? '—'}\`)`);
  out.push(`- Generado: ${r.generatedAt}\n`);

  if (r.errors.length) {
    out.push(`## Errores (${r.errors.length})\n`);
    out.push(list(r.errors, (e) => `\`${e.file}\` ${e.path || '/'}: ${e.message}`));
  }
  if (r.warnings.length) {
    out.push(`## Avisos (${r.warnings.length})\n`);
    out.push(list(r.warnings, (w) => w));
  }

  out.push('## Fuentes\n');
  if (r.sources.length) {
    out.push('| Fuente | Automatización | Resultado | Última consulta | Claims (vigentes/total) |');
    out.push('|---|---|---|---|---|');
    for (const s of r.sources) {
      out.push(`| ${s.name} (\`${s.id}\`) | ${s.automationStatus} | ${s.updateOutcome} | ${s.lastAccessedAt ?? '—'} | ${s.currentClaimCount}/${s.claimCount} |`);
    }
    out.push('');
  } else out.push('_Sin datos._\n');

  out.push('## Datos actualizados\n');
  if (r.changes) {
    const c = r.changes.claims;
    out.push(`Añadidos: ${c.added.length} · Modificados: ${c.changed.length} · Reconsultados: ${c.refreshed.length} · Eliminados: ${c.removed.length} · Cambios de estado: ${c.statusChanged.length}\n`);
    out.push('### Añadidos\n');
    out.push(list([...c.added].sort((x, y) => x.slotKey.localeCompare(y.slotKey)), (a) => `\`${a.slotKey}\` — ${a.sourceId}`));
    out.push('### Modificados (mismo dato, valor distinto)\n');
    out.push(list(c.changed, (x) => `\`${x.slotKey}\` — ${x.sourceId}: ${x.fields.join(', ')}`));
    out.push('### Eliminados\n');
    out.push(list([...c.removed].sort((x, y) => x.slotKey.localeCompare(y.slotKey)), (a) => `\`${a.slotKey}\` — ${a.sourceId}`));
    out.push('### Cambios de estado\n');
    out.push(list(c.statusChanged, (s) => `\`${s.id}\`: ${s.from} → ${s.to}${s.flagsAdded.length ? ` (+${s.flagsAdded.join(', +')})` : ''}${s.flagsRemoved.length ? ` (−${s.flagsRemoved.join(', −')})` : ''}`));
    const cat = r.changes.catalog;
    out.push(`### Catálogo\n\nAñadidos: ${cat.added.length} · Modificados: ${cat.changed.length} · Eliminados: ${cat.removed.length}\n`);
  } else out.push('_No calculado._\n');

  out.push(`## Desactualizados (${r.stale.length})\n`);
  out.push(list(r.stale, claimRow));

  const p = r.pendingReview;
  out.push('## Pendiente de revisión manual\n');
  out.push(`### Fuentes sin datos vigentes para ${r.gamePatch} (${p.sourcesWithoutCurrentData.length})\n`);
  out.push(list(p.sourcesWithoutCurrentData, (s) => `${s.name} (\`${s.id}\`, automatización: ${s.automation}) → ${s.action}`));
  out.push(`### Claims sin verificar (${p.unverifiedClaims.length})\n`);
  out.push(list(p.unverifiedClaims, claimRow));
  out.push(`### Sin parche declarado (${p.patchUndeclared.length})\n`);
  out.push(list(p.patchUndeclared, claimRow));
  out.push(`### Información previa al lanzamiento (${p.preRelease.length})\n`);
  out.push(list(p.preRelease, claimRow));
  out.push(`### Conservados tras un fallo de actualización (${p.carriedOver.length})\n`);
  out.push(list(p.carriedOver, claimRow));
  out.push(`### Recogidos automáticamente con política ya no vigente (${p.sourcePolicyChanged.length})\n`);
  out.push(list(p.sourcePolicyChanged, claimRow));
  out.push(`### Agentes sin ningún claim vigente (${p.agentsWithoutCurrentClaims.length})\n`);
  out.push(p.agentsWithoutCurrentClaims.length ? p.agentsWithoutCurrentClaims.map((a) => `\`${a}\``).join(', ') + '\n' : '_Ninguno._\n');
  out.push(`### Entradas de catálogo sin verificar (${p.unverifiedCatalogEntries.length})\n`);
  out.push(p.unverifiedCatalogEntries.length ? p.unverifiedCatalogEntries.map((a) => `\`${a}\``).join(', ') + '\n' : '_Ninguna._\n');
  out.push(`### Escalas de tier sin confirmar (${p.unconfirmedTierScales.length})\n`);
  out.push(list(p.unconfirmedTierScales, (s) => `\`${s}\``));
  out.push(`### Fechas de parche sin verificar (${p.unverifiedPatchDates.length})\n`);
  out.push(list(p.unverifiedPatchDates, (s) => s));
  out.push(`### Borradores editoriales sin terminar (${p.drafts.length})\n`);
  out.push(list(p.drafts, (d) => `\`${d}\``));
  return out.join('\n');
}
