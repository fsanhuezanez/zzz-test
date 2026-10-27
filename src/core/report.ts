/**
 * Informe de actualización. Markdown breve para personas (resumen + qué revisar
 * primero); JSON completo para máquinas.
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

export interface PageToVerify {
  url: string;
  sourceId: string;
  claims: number;
  viaSearch: boolean;
  kinds: string[];
}

export interface PendingReview {
  summary: { live: number; verified: number; pending: number; viaSearch: number; teams: number; stale: number; superseded: number };
  /** Una entrada por página: abrirla permite comprobar todos sus claims a la vez. */
  pagesToVerify: PageToVerify[];
  patchUndeclared: ClaimLine[];
  preRelease: ClaimLine[];
  sourcesWithoutCurrentData: { id: string; name: string; automation: string }[];
  sourcePoliciesToRecheck: string[];
  agentsWithoutCurrentTeams: string[];
  unverifiedCatalogEntries: string[];
  unconfirmedTierScales: string[];
  unverifiedPatchDates: string[];
  drafts: string[];
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
  pendingReview: PendingReview | null;
}

const line = (c: Claim): ClaimLine => ({ id: c.id, sourceId: c.sourceId, slotKey: c.slotKey, status: c.status, flags: c.flags });

export function buildPendingReview(args: {
  claims: Claim[];
  catalog: Catalog;
  sources: Source[];
  summaries: SourceSummary[];
  calendar: PatchCalendarFile['patches'];
  drafts: string[];
}): PendingReview {
  const live = args.claims.filter((c) => c.status === 'current' || c.status === 'stale');
  const pending = live.filter((c) => c.provenance.verification.state !== 'verified');
  const withFlag = (flag: ClaimFlag) => live.filter((c) => c.flags.includes(flag)).map(line);

  const pages = new Map<string, PageToVerify>();
  for (const c of pending) {
    const page = pages.get(c.provenance.url) ?? { url: c.provenance.url, sourceId: c.sourceId, claims: 0, viaSearch: false, kinds: [] };
    page.claims += 1;
    if (c.provenance.collectionMethod === 'web_search') page.viaSearch = true;
    if (!page.kinds.includes(c.kind)) page.kinds.push(c.kind);
    pages.set(page.url, page);
  }

  const teamAgents = new Set(args.claims.filter((c) => c.kind === 'team' && c.status === 'current').flatMap((c) => c.agentRefs));
  const unverified = (prefix: string, items: { id: string; provenance: { verification: { state: string } } }[]) =>
    items.filter((i) => i.provenance.verification.state !== 'verified').map((i) => `${prefix}:${i.id}`);

  return {
    summary: {
      live: live.length,
      verified: live.length - pending.length,
      pending: pending.length,
      viaSearch: live.filter((c) => c.provenance.collectionMethod === 'web_search').length,
      teams: live.filter((c) => c.kind === 'team').length,
      stale: live.filter((c) => c.status === 'stale').length,
      superseded: args.claims.filter((c) => c.status === 'superseded').length,
    },
    pagesToVerify: [...pages.values()].sort((a, b) => b.claims - a.claims || a.url.localeCompare(b.url)),
    patchUndeclared: withFlag('patch_undeclared'),
    preRelease: withFlag('pre_release'),
    sourcesWithoutCurrentData: args.sources
      .filter((s) => s.kind !== 'internal' && s.kind !== 'official')
      .filter((s) => (args.summaries.find((x) => x.id === s.id)?.currentClaimCount ?? 0) === 0)
      .map((s) => ({ id: s.id, name: s.name, automation: s.automation.status })),
    sourcePoliciesToRecheck: args.sources.filter((s) => s.automation.checkedVia !== 'browser').map((s) => s.id),
    agentsWithoutCurrentTeams: args.catalog.agents.map((a) => a.id).filter((id) => !teamAgents.has(id)).sort(),
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
// Markdown (breve)
// ---------------------------------------------------------------------------

const MAX_ROWS = 15;

function list<T>(items: T[], render: (item: T) => string, max = MAX_ROWS): string {
  if (!items.length) return '_Nada._\n';
  const rows = items.slice(0, max).map((i) => `- ${render(i)}`);
  if (items.length > max) rows.push(`- … y ${items.length - max} más (ver el informe .json)`);
  return rows.join('\n') + '\n';
}

const OUTCOME_TEXT: Record<UpdateOutcome, string> = {
  published: '✅ Publicada nueva versión',
  unchanged: '➖ Sin cambios: se mantiene la versión existente',
  failed: '❌ Falló: se conserva la última versión válida',
  dry_run: '🧪 Simulación: no se escribió nada',
};

export function renderMarkdown(r: UpdateReport): string {
  const out: string[] = [];
  out.push(`# zzz-meta · parche ${r.gamePatch} · ${r.dataVersion ?? '—'}\n`);
  out.push(`**${OUTCOME_TEXT[r.outcome]}** (anterior: ${r.previousDataVersion ?? '—'}) · ${r.generatedAt}\n`);

  if (r.errors.length) {
    out.push(`## Errores que corregir (${r.errors.length})\n`);
    out.push(list(r.errors, (e) => `\`${e.file}\` ${e.path || '/'}: ${e.message}`, 50));
  }
  if (r.warnings.length) out.push(`## Avisos\n\n${list(r.warnings, (w) => w)}`);

  const p = r.pendingReview;
  if (p) {
    const s = p.summary;
    out.push('## Resumen\n');
    out.push(`- Datos vigentes o antiguos: **${s.live}**. Verificados: **${s.verified}**. Pendientes de revisión: **${s.pending}** (${s.viaSearch} tomados de buscador).`);
    out.push(`- Equipos: ${s.teams}. Desactualizados: ${s.stale}. Reemplazados (historial): ${s.superseded}.`);
    if (s.verified === 0) out.push('- ⚠ **Ningún dato está verificado todavía**: la base NO puede considerarse actualizada para este parche.');
    if (r.changes) {
      const c = r.changes.claims;
      out.push(`- Cambios frente a la versión anterior: +${c.added.length} añadidos · ${c.changed.length} modificados · −${c.removed.length} eliminados · ${c.statusChanged.length} cambios de estado.`);
    }
    out.push('');
  }

  if (r.changes) {
    const c = r.changes.claims;
    if (c.added.length + c.changed.length + c.removed.length) {
      out.push('## Qué cambió\n');
      const bySlot = <T extends { slotKey: string }>(xs: T[]) => [...xs].sort((a, b) => a.slotKey.localeCompare(b.slotKey));
      if (c.changed.length) out.push(`Modificados (misma fuente, valor distinto):\n\n${list(bySlot(c.changed), (x) => `\`${x.slotKey}\` — ${x.sourceId}: ${x.fields.join(', ')}`)}`);
      if (c.added.length) out.push(`Añadidos:\n\n${list(bySlot(c.added), (a) => `\`${a.slotKey}\` — ${a.sourceId}`)}`);
      if (c.removed.length) out.push(`Eliminados:\n\n${list(bySlot(c.removed), (a) => `\`${a.slotKey}\` — ${a.sourceId}`)}`);
    }
  }

  if (p) {
    out.push(`## Revisar primero: páginas por comprobar (${p.pagesToVerify.length})\n`);
    out.push('Abre cada enlace, comprueba sus datos, corrige el envío y márcalo `verified`.\n');
    out.push(list(p.pagesToVerify, (x) => `${x.viaSearch ? '🔎 ' : ''}${x.url} — ${x.sourceId}, ${x.claims} dato(s): ${x.kinds.join(', ')}`));
    if (r.stale.length) out.push(`## Desactualizados (${r.stale.length})\n\n${list(r.stale, (c) => `\`${c.slotKey}\` — ${c.sourceId} (${c.flags.filter((f) => f === 'older_patch' || f === 'access_too_old').join(', ')})`)}`);
    if (p.patchUndeclared.length) out.push(`## Sin parche declarado (${p.patchUndeclared.length})\n\nSe asume el parche vigente cuando se actualizó/consultó la página.\n\n${list(p.patchUndeclared, (c) => `\`${c.slotKey}\` — ${c.sourceId}`, 8)}`);
    if (p.preRelease.length) out.push(`## Previos al lanzamiento (${p.preRelease.length})\n\n${list(p.preRelease, (c) => `\`${c.slotKey}\` — ${c.sourceId}`, 8)}`);

    out.push('## Mantenimiento\n');
    const rows: string[] = [];
    if (p.sourcesWithoutCurrentData.length) rows.push(`Fuentes sin datos vigentes: ${p.sourcesWithoutCurrentData.map((x) => x.id).join(', ')}`);
    if (p.sourcePoliciesToRecheck.length) rows.push(`Condiciones de uso leídas solo vía buscador (releer en navegador): ${p.sourcePoliciesToRecheck.join(', ')}`);
    rows.push(`Agentes del catálogo sin ningún equipo vigente: ${p.agentsWithoutCurrentTeams.length}`);
    rows.push(`Entradas de catálogo sin verificar: ${p.unverifiedCatalogEntries.length}`);
    if (p.unconfirmedTierScales.length) rows.push(`Escalas de tier sin confirmar: ${p.unconfirmedTierScales.join(', ')}`);
    if (p.unverifiedPatchDates.length) rows.push(`Fechas de parche sin verificar: ${p.unverifiedPatchDates.join(', ')}`);
    if (p.drafts.length) rows.push(`Borradores sin terminar: ${p.drafts.join(', ')}`);
    out.push(list(rows, (x) => x, 20));
  }

  if (r.sources.length) {
    out.push('## Fuentes\n');
    out.push('| Fuente | Automatización | Última consulta | Vigentes/total |');
    out.push('|---|---|---|---|');
    for (const s of r.sources) out.push(`| ${s.name} (\`${s.id}\`) | ${s.automationStatus} | ${s.lastAccessedAt ?? '—'} | ${s.currentClaimCount}/${s.claimCount} |`);
    out.push('');
  }
  return out.join('\n');
}
