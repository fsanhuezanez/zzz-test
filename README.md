# zzz-meta-knowledge

Base de conocimiento competitivo de **Zenless Zone Zero** para **Hoyo Builds**, una herramienta privada que uso con mis amigos. Es un repositorio de JSON local, versionado en git y validado con esquemas. Cada dato dice de qué página sale, cuándo se consultó, para qué parche es y si alguien lo ha comprobado.

La base **describe la evidencia; no decide** qué equipo es mejor para cada cuenta. Eso lo hace Hoyo Builds cruzándola con el roster real de cada persona.

> ## Estado de los datos (27-10-2026, parche 3.3)
>
> - **0 datos verificados.** La base **no** puede considerarse actualizada para 3.3 hasta que alguien revise las páginas.
> - **41 pistas pendientes** en `data/editorial/3.3/leads/`: 22 equipos, 4 sustitutos, builds (W-Engine y/o Drive Discs) de Phoenix, Yixuan, Velina, Ye Shunguang y Miyabi, 2 sinergias y una rotación. Salen de 20 páginas de Game8, Game Rant, Icy Veins, Mobalytics, zzz-build, Timesaver y Prydwen. Se obtuvieron de **resúmenes de buscador**, porque desde el entorno donde se preparó no se podía abrir ninguna de esas webs. Llevan confianza `low`, método `web_search` y el flag `via_search`. Pueden tener errores.
> - El catálogo incluye 25 agentes nuevos de 2.x–3.3 (Phoenix, Velina, Remielle, Ye Shunguang, Yixuan, Lucia…), solo con el nombre. Faltan rareza, atributo y especialidad, y nada del catálogo está verificado en el juego.
> - **Falta por completo:** prioridades de inversión (Cinemas y W-Engine exclusivo). Las búsquedas solo devolvieron opiniones mezcladas sin atribuir a una página concreta, así que no se registraron. Los Bangboo solo aparecen en 2 equipos.
> - `npm run report` lista las 20 páginas que hay que abrir, ordenadas por número de datos.

## Separación de datos

| Qué | Dónde | Cómo se reconoce |
|---|---|---|
| **Verificado** | `data/editorial/<parche>/*.json` | `verification.state: "verified"` (con `reviewedBy`/`reviewedAt`) → `review: "verified"` en el export |
| **Pendiente** (leído en la página, sin segunda revisión) | `data/editorial/<parche>/*.json` | `verification.state: "unverified"` → `review: "pending"` |
| **Pista de buscador** (no leída en la página) | `data/editorial/<parche>/leads/*.json` | `collectionMethod: "web_search"`, nunca `verified` ni confianza `high`; flag `via_search` |
| **Ficticio** (solo pruebas) | `test/fixtures/`, `examples/fixture-*` | fuentes `kind: "fixture"`, `isFixture: true`. `update` se niega a publicarlas sin `--allow-fixtures`. |

## Instalación y uso

Requisitos: Node.js ≥ 22.18 (ejecuta TypeScript directamente, sin compilar).

```bash
npm install
npm run update                 # valida data/, publica db/, exporta export/ y escribe reports/
npm run update -- --dry-run    # simula sin escribir nada
npm run report                 # informe breve: qué cambió y qué revisar
npm run validate               # comprueba db/ y que export/ esté al día
npm test                       # pruebas
npm run check                  # tipos + pruebas + validación
```

Si `update` encuentra un error en los datos (agente mal escrito, estadística imposible, URL de otra web…), **no publica nada**. `db/` y `export/` quedan como estaban, y el informe dice el fichero, la ruta y el motivo.

## Flujo por parche

```bash
npm run new-patch -- 3.4 --date 2026-12-02 --url <noticia oficial>   # 1. calendario
#                                                                       2. agentes nuevos → data/catalog/agents.json (basta id + nombre)
npm run update -- --patch 3.4      # 3. lo de 3.3 pasa a "stale" y el informe lista qué revisar
npm run new-submission -- --source prydwen --template team --url https://www.prydwen.gg/zenless/...   # 4. un borrador por página
#                                                                       5. rellenar con la página abierta, quitar ".draft"
npm run update -- --patch 3.4      # 6. publicar; un amigo revisa y marca "verified"
```

Las plantillas son `team` (equipo y sustitutos), `build` (W-Engine, Drive Discs, F2P, inversión y Bangboo), `tier` y `all`. Guía detallada: [docs/EDITORIAL-GUIDE.md](docs/EDITORIAL-GUIDE.md).

Para atributos, especialidades o estadísticas nuevas, edita `data/game.json`; no hace falta tocar código.

## Uso desde Hoyo Builds

Copia (o enlaza como submódulo) la carpeta `export/`:

- `export/zzz-meta.json`: todo en un solo fichero, con equipos, composiciones, sustitutos, builds por agente, tiers, sinergias, rotaciones, catálogo y fuentes.
- `export/zzz-meta.types.ts`: los tipos, sin dependencias.

```ts
import data from './zzz-meta/zzz-meta.json' with { type: 'json' };
import type { ZzzMetaExport, Team } from './zzz-meta/zzz-meta.types.ts';

const meta = data as ZzzMetaExport;
if (meta.meta.isFixture) throw new Error('datos de prueba');
const phoenixTeams: Team[] = meta.teams.filter((t) => t.members.some((m) => m.agent === 'phoenix'));
const build = meta.builds['phoenix'];                            // W-Engines, Drive Discs, F2P, inversión, Bangboo
const verifiedOnly = meta.teams.filter((t) => t.evidence.review === 'verified');
```

El [ejemplo de recomendador](examples/hoyo-builds-consumer/README.md) cruza el paquete con un roster: equipos formables, sustitutos documentados, lo que falta, una pareja para Shiyu y builds.

```bash
node examples/hoyo-builds-consumer/recommend.ts export/zzz-meta.json mi-roster.json shiyu_defense
```

### Ejemplo de equipo exportado (pista real, pendiente)

```json
{
  "id": "clm_team_eada3c03d6dc",
  "mode": "general",
  "archetype": "Anomaly (Remielle)",
  "stance": "recommended",
  "budget": false,
  "members": [
    { "agent": "remielle", "role": "anomaly", "substitutes": [] },
    { "agent": "phoenix", "role": "anomaly", "substitutes": [] },
    { "agent": "velina", "role": "anomaly", "substitutes": [] }
  ],
  "flex": [],
  "alternates": [{ "agent": "promeia", "quality": "unspecified" }, { "agent": "vivian", "quality": "unspecified" },
                 { "agent": "aria", "quality": "unspecified" }, { "agent": "alice", "quality": "unspecified" }],
  "requirements": [{ "text": "Remielle obtiene sus mayores bonificaciones con otros dos agentes Anomaly en el equipo", "level": "recommended", "agent": "remielle" }],
  "limitations": [],
  "bangboo": [],
  "evidence": {
    "sourceId": "game8", "sourceName": "Game8", "url": "https://game8.co/games/Zenless-Zone-Zero/archives/458656",
    "accessedAt": "2026-10-27", "declaredPatch": null, "evidenceType": "explicit_recommendation",
    "confidence": "low", "collectionMethod": "web_search", "review": "pending", "status": "current",
    "flags": ["patch_undeclared", "unverified_catalog_refs", "via_search"]
  }
}
```

`stance` distingue entre un equipo que la fuente **clasifica** en un ranking (`ranked`, con `rating`), uno que **recomienda** (`recommended`) y uno que solo **muestra** (`showcase`). Los tiers individuales van aparte (`tiers`) y no son un ranking de equipos.

## Estructura

```
data/                     ENTRADAS, editables a mano
  sources.json            fuentes, condiciones de uso, dudas y escalas de tier
  patches.json            calendario de parches
  game.json               atributos, especialidades, estadísticas por ranura
  catalog/                agentes, W-Engines, Drive Discs, Bangboo
  editorial/<parche>/     envíos manuales (leads/ = pistas de buscador)
db/                       base canónica generada (no editar; validate lo detecta)
export/                   paquete para Hoyo Builds (zzz-meta.json + zzz-meta.types.ts)
reports/                  informe por versión + latest.{md,json}
schemas/                  JSON Schemas de los ficheros de entrada y de db/
src/                      schema/ · core/ · collectors/manual · export/ · pipeline.ts · cli.ts
examples/                 hoyo-builds-consumer/ + base, informe y paquete de PRUEBA (fixture-*)
test/                     pruebas (node:test) + fixtures ficticias
docs/                     ARCHITECTURE · SOURCES · EDITORIAL-GUIDE
```

## Limitaciones conocidas

- **Nada verificado.** Las 41 pistas son resúmenes de buscador: pueden mezclar páginas, haber quedado viejas o malinterpretar la fuente. Usarlas sin revisar es hacerlo bajo tu responsabilidad (`includePending: false` las excluye).
- **Catálogo incompleto.** Los agentes nuevos solo tienen nombre, y puede faltar alguno de 2.x–3.3. Los nombres completos usados como alias salen de resultados de búsqueda.
- **Vocabulario sin verificar.** «Wind» y «Armorer» se vieron en resultados de búsqueda. Las fechas de parche no están contrastadas con fuentes oficiales.
- **Ninguna fuente se automatiza** (ver [docs/SOURCES.md](docs/SOURCES.md)). Mantener la base al día exige un pase manual por parche: unos minutos por página.
- **El orden del recomendador de ejemplo** es un criterio transparente (verificado → vigente → clasificado/recomendado → no económico → más fuentes → menos sustituciones), no una métrica de daño.
- **Sin datos de enemigos ni del buff de cada ciclo de Shiyu o Deadly Assault**. Las condiciones van como texto en `requirements`, `limitations` y `conditions`.
- **Historial en git:** cada versión deja su informe y su `changelog.json`; los datos reemplazados se conservan en `db/claims.json`.

Uso personal y no comercial. Los datos competitivos pertenecen a sus fuentes; muestra siempre la fuente y el enlace. Zenless Zone Zero © HoYoverse.
