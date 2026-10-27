# zzz-meta-knowledge

Recopilador y normalizador de conocimiento competitivo de **Zenless Zone Zero**. Produce una base JSON versionada, validada con esquemas y trazable, pensada para que **Hoyo Builds** (u otro recomendador) combine la evidencia competitiva con el roster real de una cuenta.

No es un agregador de tier lists. Cada dato es un *claim* atómico atribuido a **una** fuente, con su procedencia completa. Los equipos son la unidad principal de recomendación: un agente con tier alto no mejora por sí solo un equipo que ninguna fuente avala.

> **Estado de los datos (parche 3.3, 27-10-2026).** La base publicada en `db/` contiene el registro de fuentes, el calendario de parches y un catálogo semilla (33 agentes, 27 W-Engines, 18 Drive Discs y 8 Bangboo), todo marcado como *sin verificar*. **Aún no contiene claims competitivos.** Las condiciones de Prydwen y Mobalytics prohíben la recogida automatizada, Akademiya no publica condiciones ni API, y no se han inventado datos en nombre de ninguna fuente. El siguiente paso es un pase editorial manual (ver [docs/EDITORIAL-GUIDE.md](docs/EDITORIAL-GUIDE.md)). La base de ejemplo `examples/fixture-db/` usa **fuentes ficticias** y lleva `isFixture: true`.

## Inicio rápido

Requisitos: Node.js ≥ 22.18. El proyecto ejecuta TypeScript directamente, sin paso de compilación.

```bash
npm install
npm run update -- --patch 3.3            # recoger → normalizar → validar → publicar en db/
npm run update -- --patch 3.3 --dry-run  # simular sin escribir nada
npm run validate                         # esquema + integridad + hash de la base publicada
npm run report                           # último informe (reports/latest.md)
npm test                                 # pruebas automatizadas (node:test)
npm run check                            # typecheck + pruebas + validación

# Pase editorial: crea un borrador para una fuente
npm run new-submission -- --source prydwen --patch 3.3 --kinds tier,team --url https://www.prydwen.gg/zenless/tier-list

# Ejemplo de consumo (con la base de PRUEBA)
npm run example:build       # regenera examples/fixture-db desde test/fixtures
npm run example:recommend   # recomienda equipos para examples/hoyo-builds-consumer/roster.example.json
```

`update` sin `--patch` usa el último parche de `data/patches.json`. Devuelve código 1 si la actualización falla. En ese caso `db/` queda intacta y se escribe `reports/failed-<parche>-<fecha>.md`.

## Qué hace

| Requisito | Cómo se cumple |
|---|---|
| Fuentes respetando sus condiciones | `data/sources.json` registra la política de cada fuente (`allowed` / `disallowed` / `unknown`) con su base y su evidencia. La recogida automatizada solo se ejecuta con `allowed`, el método autorizado y evidencia documentada, y además respeta robots.txt. Lo demás entra por envío editorial manual con atribución. |
| Agentes, tiers por rol, equipos, sustitutos, sinergias, rotaciones, W-Engines, Drive Discs, Bangboo, inversión y F2P | Once tipos de claim (`tier`, `team`, `substitute`, `synergy`, `rotation`, `w_engine`, `drive_disc`, `bangboo`, `investment`, `f2p_option`, `usage`) sobre un catálogo de entidades. |
| Procedencia de cada dato | `provenance`: fuente, URL, fecha de consulta, parche declarado, tipo de evidencia, confianza, método de recogida, quién lo recogió y verificación por una segunda persona. |
| Distinguir el tipo de evidencia | `explicit_recommendation`, `observed_data` (exige muestra), `cross_source_consensus` (solo derivado, en un fichero aparte) e `internal_estimate` (solo con la fuente interna, exige justificación y nunca tiene confianza alta). Las estadísticas de uso solo se aceptan como `observed_data` de una fuente externa. |
| JSON consistente y tipado | JSON Schemas en `schemas/` generados desde la misma definición TypeBox que produce los tipos TS. Las claves salen ordenadas y la salida es determinista. |
| Cambios, duplicados, último válido, antiguos y no verificados | Ids por contenido, deduplicación, `superseded`, `stale`, flags de revisión, changelog por versión, publicación atómica y conservación de los datos de una fuente cuyo feed falla. |
| Actualización por parche e informe | `npm run update -- --patch X.Y` genera `reports/<versión>.md` y `.json` con lo actualizado, lo desactualizado y lo pendiente de revisión manual. |
| Docs, pruebas y ejemplo externo | `docs/`, `test/` y `examples/hoyo-builds-consumer/`. |

## Estructura

```
├── data/                       ENTRADAS (editadas por personas)
│   ├── sources.json            registro de fuentes + políticas + escalas de tier
│   ├── patches.json            calendario de parches (detecta stale y pre_release)
│   ├── catalog/                agentes, W-Engines, Drive Discs, Bangboo
│   └── editorial/<parche>/     envíos manuales (*.json; *.draft.json se ignora)
├── db/                         SALIDA versionada (no editar a mano; validate lo detecta)
│   ├── manifest.json           versión, hash, recuentos, estado por fuente
│   ├── claims.json             todos los claims con procedencia y estado
│   ├── derived/consensus.json  consenso entre fuentes (derivado, separado)
│   ├── index/by-agent.json     índice agente → claims
│   ├── catalog/*.json  sources.json  changelog.json
├── reports/                    informes por versión + latest.{md,json}
├── schemas/                    JSON Schemas publicados (npm run schemas)
├── src/
│   ├── schema/                 TypeBox: esquemas + tipos TS
│   ├── core/                   normalize, lifecycle, consensus, diff, store, report, integrity
│   ├── collectors/             manual, http-feed (con permiso), policy, robots
│   ├── client/                 lector para consumidores (loadDatabase / MetaDatabase)
│   ├── pipeline.ts  cli.ts  templates.ts
├── examples/
│   ├── hoyo-builds-consumer/   recomendador de ejemplo basado en roster
│   ├── fixture-db/             base generada con fuentes ficticias
│   └── fixture-reports/
├── test/                       node:test + fixtures ficticios
└── docs/                       ARCHITECTURE, SOURCES, EDITORIAL-GUIDE
```

## Ejemplo de JSON generado

Un claim de equipo de `examples/fixture-db/claims.json` (fuente **ficticia**):

```json
{
  "id": "clm_team_1146c77fa655",
  "kind": "team",
  "sourceId": "example-guide-a",
  "slotKey": "team:ellen+lycaon+soukaku:shiyu_defense",
  "agentRefs": ["astra-yao", "ellen", "lycaon", "qingyi", "soukaku"],
  "payload": {
    "archetype": "Ice burst",
    "members": [
      { "agent": "ellen", "role": "main_dps" },
      { "agent": "lycaon", "role": "stunner", "substitutes": [{ "agent": "qingyi", "quality": "workable" }] },
      { "agent": "soukaku", "role": "support", "substitutes": [{ "agent": "astra-yao", "quality": "near_equivalent" }] }
    ],
    "bangboo": [{ "bangboo": "butler", "rank": 1 }]
  },
  "context": { "mode": "shiyu_defense" },
  "provenance": {
    "sourceId": "example-guide-a",
    "url": "https://guide-a.example.com/zzz/tier-list",
    "accessedAt": "2026-10-24",
    "declaredPatch": "3.3",
    "evidenceType": "explicit_recommendation",
    "confidence": "high",
    "collectionMethod": "manual_entry",
    "collectedBy": "editor-a",
    "verification": { "state": "verified", "reviewedBy": "revisor-b", "reviewedAt": "2026-10-25" }
  },
  "status": "current",
  "flags": ["unverified_catalog_refs"],
  "firstSeenAt": "2026-10-27"
}
```

Consenso derivado (`derived/consensus.json`), siempre separado de los claims atribuidos:

```json
{
  "id": "cns_tier_1cf3288a99f8",
  "agent": "ellen", "role": "attack", "mode": "shiyu_defense", "patch": "3.3",
  "entries": [
    { "sourceId": "example-guide-a", "claimId": "clm_tier_bbb3d993ee2d", "tier": "T0", "score": 1 },
    { "sourceId": "example-stats-b", "claimId": "clm_tier_5e0dca51f3c3", "tier": "S", "score": 0.8 }
  ],
  "meanScore": 0.9, "minScore": 0.8, "maxScore": 1, "agreement": "agree",
  "evidenceType": "cross_source_consensus", "collectionMethod": "derived",
  "derivedFrom": ["clm_tier_bbb3d993ee2d", "clm_tier_5e0dca51f3c3"]
}
```

## Consumo desde TypeScript

```ts
import { loadDatabase } from 'zzz-meta-knowledge';           // lector validado (Node)
import type { Claim, ClaimOf } from 'zzz-meta-knowledge/types';

const db = await loadDatabase('node_modules/zzz-meta-knowledge/db');
if (db.isFixture) throw new Error('base de prueba');
const teams: ClaimOf<'team'>[] = db.claims({ kind: 'team', agent: 'ellen', verifiedOnly: true });
console.log(db.attribution(teams[0]!));                       // atribución obligatoria al mostrarlo
```

También puedes importar directamente los JSON (`zzz-meta-knowledge/db/claims.json`) y validarlos con `zzz-meta-knowledge/schemas/*.schema.json`. Si se instala desde git, `prepare` compila `dist/`. El ejemplo completo, con el recomendador basado en roster, está en [examples/hoyo-builds-consumer](examples/hoyo-builds-consumer/README.md).

## Limitaciones conocidas

- **Sin datos competitivos reales todavía.** Hace falta un pase editorial humano por fuente y parche (ver la guía). Ninguna fuente objetivo permite automatizar hoy.
- **La política de las fuentes se revisó de forma indirecta.** Desde el entorno de desarrollo no se pudo acceder a prydwen.gg, mobalytics.gg ni zzz.akademiya.app (la red los bloquea), así que los términos se leyeron en fragmentos de buscador. Hay que reconfirmarlos en un navegador antes del primer envío (`automation.checkedAt`).
- **Catálogo semilla sin verificar e incompleto.** Cubre agentes hasta la era 1.x que el mantenedor conoce. Faltan los agentes de 2.x–3.3 y sus W-Engines, Drive Discs y Bangboo, y nada está contrastado con el juego. Todos los claims que lo referencian llevan el flag `unverified_catalog_refs`.
- **Escalas de tier provisionales** (`confirmed: false`). Las etiquetas de Prydwen, Mobalytics y Akademiya deben confirmarse contra sus páginas. El `score` normalizado es una posición dentro de la escala de cada fuente, no una métrica comparable en sentido estricto, y el consenso es aproximado.
- **Fechas de parche sin verificar** (3.1–3.3, tomadas de resultados de búsqueda).
- **Pesos del recomendador de ejemplo** heurísticos y no calibrados.
- **El lector `loadDatabase` usa `node:fs`.** En navegador, carga los JSON por tu cuenta y usa `MetaDatabase.fromFiles`.
- **El historial completo depende de git.** Cada versión guarda solo su `changelog.json` y su informe; los `superseded` se conservan dentro de `claims.json`.
- **No hay gestión de builds por mindscape más allá de `investment`, ni datos de enemigos o del buff de cada ciclo.** Las condiciones se anotan en texto (`context.conditions`).

## Licencia y atribución

Código bajo MIT. Los datos competitivos pertenecen a sus fuentes. Muestra siempre `db.attribution(claim)` y enlaza la página original. Zenless Zone Zero © HoYoverse; este proyecto no está afiliado a HoYoverse ni a ninguna de las fuentes.
