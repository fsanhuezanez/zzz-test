# Guía editorial

Cómo registrar a mano lo que publica una fuente, con trazabilidad y sin copiar contenido.

## Flujo por parche

```bash
# 0. Si hay parche nuevo: añadirlo a data/patches.json (fecha + fuente) y agentes nuevos a data/catalog
# 1. Crear un borrador (un fichero = una página consultada un día concreto)
npm run new-submission -- --source prydwen --patch 3.3 --kinds tier,team,w_engine \
  --url https://www.prydwen.gg/zenless/tier-list --by tu-nombre
# 2. Rellenar data/editorial/3.3/<fuente>-<fecha>-<tipos>.draft.json con la página abierta en el navegador
# 3. Quitar ".draft" del nombre y simular
npm run update -- --patch 3.3 --dry-run
# 4. Corregir los errores que indique, publicar y abrir un PR
npm run update -- --patch 3.3
# 5. Otra persona revisa contra la página y cambia verification a verified (reviewedBy/reviewedAt)
```

Los ficheros `*.draft.json` y los que empiezan por `_` se ignoran. Los borradores aparecen en el informe como pendientes.

## Reglas

1. **Un envío por página consultada.** `url` es la página concreta, `accessedAt` el día en que la leíste y `declaredPatch` el parche que **la página dice** (o `null` si no lo dice; no lo deduzcas).
2. **Solo lo que la fuente afirma.** Si la fuente pone a un agente en un equipo pero no dice que sea sustituible, no añadas sustitutos. Si sale de tu propio criterio, va en otro envío con `sourceId: "maintainer"` y `evidenceType: "internal_estimate"`, con `rationale` y confianza `medium` o `low`.
3. **Palabras propias.** `mechanism`, `steps`, `note` y `notes` son resúmenes breves. `excerpt` (≤200 caracteres) solo si una frase concreta justifica el dato.
4. **Etiquetas tal cual.** `tier` lleva la etiqueta exacta de la fuente ("T0.5", "S"). Si no está en la escala registrada, el pipeline falla: revisa la escala en `data/sources.json` y márcala `confirmed: true` cuando la hayas contrastado.
5. **Modo y condiciones.** `mode` (`shiyu_defense`, `deadly_assault`, `lost_void`, `general`, `other`), `modeDetail` para matices ("mitad 2", "jefe X") y `conditions` para requisitos ("requiere M2", "con W-Engine exclusivo").
6. **Confianza.** `high` si la página es explícita y está actualizada para el parche; `medium` si es ambigua o parcial; `low` si es preliminar (beta o primeras impresiones).
7. **Datos observados.** `usage` y cualquier `observed_data` necesitan `sample.description` con lo que la fuente dice de su muestra. `size` solo si la fuente da la cifra.
8. **Correcciones y retiradas.** Si la fuente cambia de opinión dentro del mismo parche, crea un envío nuevo con la fecha nueva: el dato anterior pasa a `superseded`. Si retira una recomendación, repite el claim con `"retracted": true`.

## Ejemplo de envío (estructura; valores ilustrativos)

```json
{
  "$schema": "../../../schemas/editorial-submission.schema.json",
  "sourceId": "prydwen",
  "url": "https://www.prydwen.gg/zenless/tier-list",
  "title": "Tier list (Shiyu Defense)",
  "accessedAt": "2026-10-28",
  "declaredPatch": "3.3",
  "collectedBy": "editor-a",
  "evidenceType": "explicit_recommendation",
  "confidence": "high",
  "verification": { "state": "unverified" },
  "mode": "shiyu_defense",
  "claims": [
    { "kind": "tier", "agent": "<agente>", "role": "attack", "tier": "<etiqueta de la página>" },
    { "kind": "team", "members": [
        { "agent": "<dps>", "role": "main_dps" },
        { "agent": "<aturdidor>", "role": "stunner", "substitutes": [{ "agent": "<alternativa citada>", "quality": "workable" }] },
        { "agent": "<apoyo>", "role": "support" } ] },
    { "kind": "w_engine", "agent": "<agente>", "options": [
        { "wEngine": "<exclusivo>", "rank": 1 }, { "wEngine": "<alternativa F2P citada>", "rank": 2, "f2p": true } ] }
  ]
}
```

Los ejemplos ejecutables de cada tipo de claim están en `test/fixtures/data/editorial/` (fuentes **ficticias**).

## Checklist del revisor

- [ ] La URL abre la página citada y el parche declarado coincide.
- [ ] Cada tier, equipo y set aparece en la página tal como se registró.
- [ ] No hay texto copiado más allá de un `excerpt` breve.
- [ ] Nada de lo inferido está atribuido a la fuente.
- [ ] `npm run update -- --dry-run` termina sin errores.
- [ ] Cambiar `verification` a `{ "state": "verified", "reviewedBy": "...", "reviewedAt": "AAAA-MM-DD" }`.
