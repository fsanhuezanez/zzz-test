# Arquitectura

Una CLI pequeña que convierte **envíos editoriales atribuidos** (JSON escritos a mano) en una **base JSON versionada**, un **paquete para Hoyo Builds** y un **informe breve**. No hay servidor, base de datos, interfaz web ni recogida automática. Git guarda el historial y los amigos revisan en PR o comentando.

```
data/sources.json · patches.json · game.json · catalog/*
data/editorial/<parche>/**.json  (leads/ = pistas de buscador)
            │
            ▼
 collectors/manual     lee envíos (ignora *.draft.json y _*)
 core/normalize        nombres → ids, vocabulario, reglas de evidencia, equipos
 core/lifecycle        dedupe · superseded · stale · flags de revisión
 core/consensus        coincidencias entre fuentes (aparte, derivado)
 core/store            serializa + valida cada fichero → db.staging → swap atómico
 core/diff + report    changelog y informe breve (reports/)
 export/build          paquete para Hoyo Builds (export/zzz-meta.json + tipos)
```

## Decisiones

| Decisión | Motivo |
|---|---|
| **JSON en git como base** | Fácil de revisar, editar, versionar y compartir con amigos. |
| **TypeScript ejecutado directamente** (Node ≥ 22.18) | Sin paso de build. `tsc --noEmit` comprueba los tipos. |
| **TypeBox + Ajv** | Una sola definición produce el JSON Schema y el tipo TS. Ajv en modo estricto da errores con ruta (`/claims/3/members/1`). |
| **Vocabulario en `data/game.json`** | Atributos, especialidades, roles de tier y estadísticas por ranura se editan sin tocar código (p. ej. «Wind» o «Armorer»). |
| **Claims atómicos y atribuidos a una página** | Permite combinar, contradecir y caducar evidencia sin perder su origen. |
| **Equipos como unidad principal** | Un tier individual no implica que un equipo funcione. El modelo distingue clasificado / recomendado / mostrado, núcleo y huecos flexibles, sustitutos por hueco, alternativas sin hueco, requisitos, limitaciones, Bangboo y si es económico. |
| **Identidad = fuente + página + hueco** | Dos páginas de la misma fuente pueden documentar el mismo equipo y ambas cuentan. Si la misma página cambia, el dato antiguo pasa a `superseded`. |
| **Ids por contenido** | El mismo dato reconsultado otro día conserva el id (deduplicación); un valor distinto genera otro id (detección de cambios). |
| **Publicación atómica** | `db.staging` → relectura y validación → intercambio. Ante cualquier error, `db/` y `export/` no se tocan. |
| **Paquete de exportación separado** | `db/` es el registro completo (incluye historial). `export/` es lo que consume la app: un JSON y un `.ts` de tipos sin dependencias. |
| **Fixtures aisladas** | Las fuentes `kind: "fixture"` solo se aceptan con `--allow-fixtures`, y `isFixture: true` acompaña a todo lo que generan. |

### Qué se quitó en la adaptación a uso personal (y por qué)

- **El recolector HTTP con robots.txt y conservación de datos tras fallo:** ninguna fuente permite automatizar, así que era código muerto. La protección «no sobrescribir una base válida» sigue garantizada por la publicación atómica.
- **El cliente compilado (`dist/`, `prepare`, `exports`) y el índice por agente:** Hoyo Builds consume `export/zzz-meta.json`, que ya agrupa builds por agente, y no necesita compilar nada.

## Modelo de datos

### Claim (`db/claims.json`)

```
id, kind, sourceId, slotKey, agentRefs[], payload (según kind), context { mode, modeDetail?, conditions? },
provenance { sourceId, url, accessedAt, pageUpdatedAt?, declaredPatch|null, evidenceType, confidence,
             collectionMethod (manual_entry | web_search | derived), collectedBy, excerpt?, notes?, rationale?, sample?, verification },
status (current | stale | superseded | retracted), flags[], firstSeenAt, supersededBy?
```

| kind | payload principal |
|---|---|
| `team` | `stance` (ranked/recommended/showcase), `budget?`, `members[{agent, role, substitutes[]}]` (1–3), `flex[{pick, options[]}]`, `alternates[]`, `requirements[{text, agent?, level}]`, `limitations[]`, `bangboo[]`, `rating?`, `archetype?` |
| `substitute` | `agent` → `substitute`, `quality`, `withAgents[]` (contexto en que vale) |
| `w_engine` | `agent`, `options[{wEngine, rank, f2p?, note?}]` |
| `drive_disc` | `agent`, `fourPiece[]`, `twoPiece[]`, `mainStats{slot4,5,6}`, `substats[]`, `statTargets[{stat, min}]` |
| `bangboo` | `agent` o `team`, `options[{bangboo, rank}]` |
| `investment` | `agent`, `aspect` (mindscape = Cinema, signature_w_engine, skills, core_skill, general), `priority`, `mindscape?` |
| `f2p_option` | `agent?`, `category`, `entities[]`, `replaces?` |
| `synergy` · `rotation` · `tier` · `usage` | sinergia/antisinergia, pasos resumidos, valoración individual (no es ranking de equipos), estadísticas observadas (solo `observed_data` con muestra) |

### Reglas de evidencia
- `internal_estimate` solo puede registrarse con la fuente interna `maintainer`, con `rationale` y confianza media o baja. Una fuente externa nunca la lleva.
- `web_search` nunca puede ser `verified` ni de confianza `high`. Para verificarlo hay que leer la página y pasar a `manual_entry`.
- `observed_data` exige `sample`. Las estadísticas de uso no se estiman.
- La URL de cada dato debe pertenecer al dominio de su fuente.
- `verified` exige `reviewedBy` y `reviewedAt`.

### Estados y flags
`current` · `stale` (parche efectivo anterior al actual o consulta más antigua que `maxAgeDays`) · `superseded` · `retracted`. Si no se declara parche, se infiere con el calendario a partir de `pageUpdatedAt` o, si falta, de `accessedAt`.

Flags: `unverified`, `via_search`, `patch_undeclared`, `older_patch`, `access_too_old`, `pre_release` y `unverified_catalog_refs`.

### Versionado
`dataVersion = <parche>-r<revisión>`. La revisión sube solo si cambia el `contentHash` y vuelve a 1 con cada parche. `changelog.json` guarda lo añadido, modificado (mismo hueco, otro valor, con los campos), eliminado, reconsultado y los cambios de estado.

## Paquete para Hoyo Builds (`export/zzz-meta.json`)

Tipos en `src/export/types.ts`, copiado a `export/zzz-meta.types.ts`.

- `teams[]`: cada equipo tal como lo publica una fuente, con `evidence` (fuente, URL, fechas, parche, tipo, confianza, método, `review`, `status` y `flags`).
- `compositions[]`: agrupa equipos con el mismo núcleo y modo. `support` dice qué fuentes y cuántas verificadas lo respaldan; no es una puntuación.
- `substitutes[]`, `builds{agente}`, `tiers[]`, `synergies[]`, `rotations[]` y el catálogo con `review`.
- Solo incluye datos `current` y `stale`. Los reemplazados y retirados quedan en `db/`.
