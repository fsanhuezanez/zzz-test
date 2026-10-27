# Ejemplo: cómo consume Hoyo Builds el paquete

`recommender.ts` usa solo `export/zzz-meta.json` y `export/zzz-meta.types.ts`, igual que la app real.

```bash
npm run example:build      # paquete de PRUEBA en examples/fixture-export
npm run example:recommend  # roster.example.json con datos ficticios
node examples/hoyo-builds-consumer/recommend.ts export/zzz-meta.json mi-roster.json shiyu_defense   # datos reales
```

Formato del roster (ids del catálogo; ver `agents` en el paquete):

```json
{ "name": "felipe", "agents": ["phoenix", "velina", "miyabi", "yanagi"], "wEngines": ["weeping-gemini"] }
```

## Qué hace

1. Parte de los **equipos publicados** del modo pedido y de los marcados `general`.
2. Para cada miembro que falta busca, en este orden:
   1. un sustituto de la misma fuente;
   2. una alternativa citada por la misma fuente;
   3. una afirmación de sustitución externa compatible;
   4. una estimación propia.

   Si no hay ninguno, el equipo queda **bloqueado** y se dice qué falta. Nunca rellena con «el de mejor tier».
3. Los huecos `flex` se cubren con las opciones que la cuenta tiene, en el orden de la fuente.
4. Ordena de forma **transparente**, sin puntuación numérica:
   1. respaldo verificado;
   2. vigente;
   3. clasificado o recomendado antes que solo mostrado;
   4. confianza;
   5. no económico antes que económico;
   6. número de fuentes que documentan el núcleo original;
   7. menos sustituciones.
5. Muestra siempre requisitos, limitaciones, la fuente y su enlace. Además avisa cuando nada está verificado o cuando una sustitución es una estimación propia.
6. `bestDisjointPair` elige dos equipos sin repetir agentes (Shiyu). `buildsFor` lista W-Engines y Drive Discs marcando lo que se posee.

`includePending: false` deja solo lo verificado. Hoy eso es nada: la base real aún no tiene datos verificados.

## Salida con datos reales (27-10-2026, todo pendiente de verificar)

Con un roster de prueba que tiene Miyabi, Yanagi, Phoenix, Velina, Yuzuha, Lycaon, Soukaku, Anby, Nicole, Billy y Astra Yao:

```
▶ Phoenix / Velina / Yuzuha  (núcleo documentado por 3 fuente(s), 1 sustitución(es))
    · Yuzuha en lugar de Remielle — same_source_substitute, unspecified
    ✓ recommended — Timesaver.gg, PENDIENTE vía buscador, low, parche 3.3
▶ Hoshimi Miyabi / Tsukishiro Yanagi / Yuzuha  (núcleo documentado por 1 fuente(s), 0 sustitución(es))
    ✓ recommended — Game8, PENDIENTE vía buscador, low, parche ¿?
▶ Anby Demara / Billy Kid / Nicole Demara  [económico]  …
Equipos documentados a los que solo os falta 1 agente (sin sustituto documentado):
  ✗ Phoenix / Velina / Remielle (game8) — falta: Remielle
```
