# Arquitectura

Objetivo: una herramienta pequeña de línea de comandos que convierte **envíos atribuidos** en una **base JSON versionada** y deja un **informe**. No hay servidor, base de datos ni interfaz web. Git guarda el historial y la revisión entre pares se hace en los PR.

```
 data/sources.json ─┐   (política, escalas)
 data/patches.json ─┤   (calendario)
 data/catalog/*  ───┤   (entidades)
                    ▼
 data/editorial/** ──► collectors/manual ─┐
 feeds con permiso ──► collectors/http-feed (policy + robots) ─┐
                                          ▼                    ▼
                               core/normalize  (envío → claims canónicos + reglas semánticas)
                                          ▼
                               core/lifecycle  (dedupe · superseded · stale · flags)
                                          ▼
                               core/consensus  (derivados entre fuentes, aparte)
                                          ▼
                     store.serialize + validate (JSON Schema de cada fichero)
                                          ▼
              core/diff vs base anterior ─► changelog ─► core/report (md + json)
                                          ▼
                  store.writeDatabaseAtomic  (staging → swap; si falla, nada cambia)
```

## Decisiones

| Decisión | Motivo |
|---|---|
| **TypeScript ejecutado directamente** (Node ≥ 22.18, *type stripping*) | Sin paso de build para operar; `tsc --noEmit` para tipos; `npm run build` solo para publicar `dist/`. |
| **TypeBox** como única definición | Cada esquema es a la vez JSON Schema (publicado en `schemas/`) y tipo TS (`Static<>`), así que el consumidor y el validador no pueden divergir. Un test comprueba que `schemas/` está al día. |
| **Ajv** con `strict`, `allErrors` y `discriminator` | Errores precisos por ruta (`/claims/3/members/1`), uniones discriminadas por `kind` y reglas condicionales (`if/then`) en la procedencia. |
| **Claims atómicos y atribuidos a una fuente** | Permite combinar, contradecir y caducar evidencia sin perder de dónde salió. El consenso se calcula aparte y referencia sus claims (`derivedFrom`). |
| **Equipos como entidad de primera clase** | Un tier individual no implica que un equipo funcione. El recomendador parte de equipos avalados y de sustitutos documentados. |
| **Ids por contenido** (`clm_<kind>_<sha256[0:12]>`) | El mismo dato reconsultado otro día tiene el mismo id (deduplicación), y un valor distinto tiene un id distinto dentro del mismo `slotKey` (detección de cambios). |
| **`slotKey`** = fuente + tipo + sujeto + modo | Identifica el hueco que un dato ocupa. Dos valores para el mismo hueco son la misma pregunta con respuestas en momentos distintos: el más reciente queda vigente y el resto pasa a `superseded`. |
| **Salida canónica** (claves ordenadas, listas ordenadas por id) | Diffs limpios en git y hash de contenido estable. Mismo hash = no se publica revisión nueva. |
| **Publicación atómica** | Se escribe en `db.staging`, se relee, se valida y se intercambia. Ante cualquier error de entrada o de salida, `db/` no se toca. |
| **Errores de entrada = fallo de la actualización** | Prioriza la calidad: un envío con un agente mal escrito no debe publicarse a medias. Un fallo de red de un feed, en cambio, no bloquea: se conservan sus datos anteriores con `carried_over`. |

## Modelo de datos

### Catálogo (`data/catalog`, `db/catalog`)
`Agent { id, name, aliases[], rarity, attribute, attributeVariant?, specialty, faction?, releasePatch?, provenance }`, y de forma análoga `WEngine` (con `signatureOf`), `DriveDisc` y `Bangboo`. Los alias permiten escribir "Von Lycaon", "Lycaon" o "lycaon" en los envíos; la normalización los resuelve al id y sugiere nombres parecidos si no existe.

### Claim (`db/claims.json`)

```
id, kind, sourceId, slotKey, agentRefs[], payload (según kind), context { mode, modeDetail?, conditions? },
provenance { sourceId, url, accessedAt, declaredPatch|null, evidenceType, confidence, collectionMethod,
             collectedBy?, excerpt? (≤200), notes?, rationale?, sample?, derivedFrom?, verification },
status (current | stale | superseded | retracted), flags[], firstSeenAt, supersededBy?
```

| kind | payload |
|---|---|
| `tier` | `agent, role, tier` (etiqueta original), `tierScale`, `score` (posición normalizada 0–1 en esa escala) |
| `team` | `members[{agent, role, substitutes[{agent, quality}]}]` (2–3), `bangboo[]`, `archetype`, `rating` |
| `substitute` | `agent` → `substitute`, `quality`, `withAgents[]` (contexto en el que se validó) |
| `synergy` | `agents[2..3]`, `polarity` (positive / negative / conditional), `mechanism` |
| `rotation` | `agents[]`, `steps[]` (≤12 pasos de ≤120 caracteres, con palabras propias) |
| `w_engine` | `agent`, `options[{wEngine, rank, f2p?}]` |
| `drive_disc` | `agent`, `fourPiece[]`, `twoPiece[]`, `mainStats{slot4,5,6}` (validadas por ranura), `substats[]` |
| `bangboo` | `agent` o `team`, `options[{bangboo, rank}]` |
| `investment` | `agent`, `aspect` (mindscape / signature_w_engine / skills / core_skill / general), `priority`, `priorityLabel`, `mindscape` |
| `f2p_option` | `agent?`, `category`, `entities[]`, `replaces?` |
| `usage` | `agents[]`, `metric`, `value`, `unit`. Solo `observed_data` con `sample`. |

### Reglas de evidencia
- `internal_estimate`: solo con la fuente `kind: internal`, exige `rationale` y no puede tener confianza `high`. Una fuente externa nunca puede llevar este tipo, y la fuente interna no puede registrar otro.
- `observed_data`: exige `sample.description`. El tamaño de muestra solo se rellena si la fuente lo publica.
- `cross_source_consensus`: solo lo genera el pipeline, en `derived/consensus.json`, con `collectionMethod: derived` y `derivedFrom`.
- La URL de cada claim debe pertenecer al dominio de su fuente.
- `verification.state = verified` exige `reviewedBy` y `reviewedAt` (revisión por una segunda persona).

### Estados y flags

| Estado | Cuándo |
|---|---|
| `current` | Cabeza de su `slotKey` y no caducada. |
| `superseded` | Existe un dato más nuevo de la misma fuente para el mismo hueco (parche más nuevo o, con el mismo parche, consulta más reciente). |
| `stale` | Parche efectivo anterior al actual (`older_patch`) o consulta más antigua que `maxAgeDays` de la fuente (`access_too_old`). Si no se declara parche, se infiere del calendario y de la fecha de consulta. |
| `retracted` | Un envío posterior marca el dato con `retracted: true`. |

Flags de revisión: `unverified`, `patch_undeclared`, `older_patch`, `access_too_old`, `pre_release` (consultado antes del lanzamiento del parche o declarado para un parche futuro), `carried_over`, `source_policy_changed` y `unverified_catalog_refs`.

### Versionado
- `schemaVersion` (semver del formato): el cliente rechaza versiones mayores que no conoce.
- `dataVersion = <parche>-r<revisión>`: la revisión sube solo si cambia `contentHash`, y vuelve a 1 con cada parche nuevo.
- `changelog.json` guarda los claims `added`, `removed`, `changed` (mismo hueco con otro valor, indicando los campos), `refreshed` (misma información reconsultada o reverificada) y `statusChanged`, además de los cambios del catálogo.

## Recogida automatizada (solo con permiso)

`collectors/http-feed.ts` consume un feed JSON con el mismo formato que un envío editorial. Antes de cualquier petición:
1. `policy.automationDecision`: exige `automation.status = allowed`, que el método esté en `allowedMethods` y al menos una URL de evidencia (permiso, licencia o documentación de la API).
2. `robots.txt` del origen: si responde 401, 403 o 5xx, o si el feed está prohibido, no se accede. Un 404 significa que está permitido.
3. User-agent identificable, pausa mínima (`minIntervalMs`) y timeout.

No ejecuta JavaScript, no imita navegadores ni reintenta tras un bloqueo. Si el feed falla, se conservan sus claims anteriores (`carried_over`). Si la política deja de permitirlo, el feed no se consulta y sus datos se marcan `source_policy_changed`.

## Puntos de extensión
- **Nueva fuente**: añadirla a `data/sources.json` con su política y sus escalas.
- **Nuevo tipo de claim**: payload en `src/schema/claims.ts`, normalización y `slotKey` en `core/normalize.ts`, y si hace falta refs en `core/integrity.ts`. Después, `npm run schemas`.
- **Nuevo adaptador** (otra forma de API): un `collectors/*.ts` que devuelva `CollectorResult`, pasando siempre por `policy.ts`.
