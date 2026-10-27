# Guía editorial

Cómo añadir y corregir datos competitivos sin tocar código. Un fichero equivale a **una página consultada**.

## Flujo rápido

```bash
npm run new-submission -- --source game8 --template team --url https://game8.co/games/Zenless-Zone-Zero/archives/458656 --by tu-nombre
# → data/editorial/3.3/game8-AAAA-MM-DD-team.draft.json
# 1. Abre la página en tu navegador y rellena SOLO lo que dice. Borra los bloques que no uses.
# 2. Quita ".draft" del nombre.
npm run update -- --dry-run        # 3. corrige los errores que indique
npm run update                     # 4. publica db/ y export/
# 5. Otra persona abre la URL, comprueba y cambia verification a verified.
```

Plantillas: `team`, `build`, `tier` y `all`, o `--kinds team,w_engine,...`.

## Verificar una pista de `leads/`

1. Ejecuta `npm run report` y abre la primera página de «Revisar primero» (las marcadas 🔎 vienen de buscador).
2. Compara cada dato con la página. Corrige lo que no coincida y **borra lo que la página no diga**.
3. En el envío:
   - `collectionMethod: "manual_entry"`
   - `confidence` según la claridad de la página
   - `declaredPatch` si la página lo indica
   - `pageUpdatedAt` si muestra fecha
   - `accessedAt` = hoy
4. Mueve el fichero de `leads/` a `data/editorial/<parche>/`.
5. `npm run update`. Cuando otra persona lo compruebe: `"verification": { "state": "verified", "reviewedBy": "...", "reviewedAt": "AAAA-MM-DD" }`.

## Equipos: qué poner en cada campo

| Campo | Úsalo cuando la página… |
|---|---|
| `stance: "ranked"` + `rating` | clasifica el equipo en un **ranking de equipos** (S, T0…) |
| `stance: "recommended"` | lo recomienda («mejor equipo para X», «equipo recomendado») |
| `stance: "showcase"` | solo lo muestra como opción viable |
| `budget: true` | lo presenta como F2P, económico o para cuentas nuevas |
| `members[].substitutes` | dice qué agente puede reemplazar a **ese** miembro |
| `flex: [{ pick, options }]` | dice «X + 2 de estos» sin fijar el trío |
| `alternates` | cita alternativas sin decir a quién reemplazan |
| `requirements` | exige algo: Cinema (Mindscape), W-Engine, umbral de estadística, tipo de compañero… (`level: required` o `recommended`) |
| `limitations` | advierte de debilidades («pierde mucho sin Velina», «provisional») |
| `bangboo` | recomienda Bangboo para esa composición |

Un tier list de agentes **no** es un ranking de equipos: registra los tiers con `kind: "tier"`, no como equipos.

## Builds

- `w_engine`: `options` en el orden de la página (`rank` 1 = mejor). Si la página no ordena las alternativas, ponles el mismo `rank`. Añade `f2p: true` solo si la página lo dice.
- `drive_disc`: sets de 4 y 2 piezas, principales por ranura (validadas con `data/game.json`), subestadísticas en orden y `statTargets` si la página da umbrales.
- `investment`: prioridad de Cinema (`aspect: "mindscape"`, `mindscape: N`), del W-Engine exclusivo o de habilidades.
- `f2p_option`: alternativas gratuitas que la página cita.

## Reglas

1. **Solo lo que la fuente afirma.** Lo que deduzcas tú va en otro envío con `sourceId: "maintainer"`, `evidenceType: "internal_estimate"`, `rationale` y confianza `medium` o `low`.
2. **Palabras propias.** `mechanism`, `steps`, `note` y `notes` son resúmenes breves. Como mucho, un `excerpt` de 200 caracteres.
3. **Parche:** `declaredPatch` es el que **dice la página** (o `null`). Si no lo dice, rellena `pageUpdatedAt` cuando la página muestre fecha. Así se detecta si es de un parche anterior.
4. **Agentes nuevos:** añádelos a `data/catalog/agents.json`; basta `id`, `name`, `aliases` y `provenance`. Los alias sirven para escribir «Von Lycaon» o «Lycaon».
5. **Vocabulario nuevo** (atributo, especialidad, estadística): `data/game.json`.
6. **Correcciones:** edita el fichero. Si la fuente cambió de opinión, crea un envío nuevo con la fecha nueva: el anterior pasa a `superseded`. Si retira una recomendación, usa `"retracted": true`.

## Checklist del revisor

- [ ] La URL abre la página citada y el parche y la fecha coinciden.
- [ ] Cada equipo, sustituto y set aparece en la página tal como se registró.
- [ ] `stance` refleja lo que hace la página (ranking, recomendación o ejemplo).
- [ ] No hay texto copiado ni inferencias atribuidas a la fuente.
- [ ] `npm run update -- --dry-run` termina sin errores.
