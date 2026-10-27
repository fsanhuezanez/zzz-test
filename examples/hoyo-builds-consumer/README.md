# Ejemplo: consumo desde Hoyo Builds

Un recomendador mínimo que toma un roster real y propone equipos **avalados por evidencia**.

```bash
npm run example:build      # genera examples/fixture-db (fuentes FICTICIAS)
npm run example:recommend  # usa roster.example.json en modo shiyu_defense
node examples/hoyo-builds-consumer/recommend.ts db mi-roster.json deadly_assault   # con la base real
```

## Lógica (`recommender.ts`)

1. Parte de los claims `team` vigentes del modo pedido (y de `general`).
2. Por cada miembro que falta en el roster busca un sustituto, primero en los `substitutes` del propio claim de equipo y luego en claims `substitute` cuyo contexto (`withAgents`) encaje. Si no hay ninguno, el equipo pasa a *near misses* con lo que falta. **No rellena huecos con el agente de mejor tier.**
3. Puntúa cada equipo con el tipo de evidencia, la confianza, el estado, la verificación y la penalización de los sustitutos. Las estimaciones internas pesan 0,4.
4. Agrega las alineaciones iguales con rendimientos decrecientes por fuente independiente.
5. Penaliza las sinergias negativas declaradas.
6. Usa los tiers individuales solo como desempate (+0,02 como máximo) y los muestra como contexto.
7. `bestDisjointPair` elige dos equipos sin agentes repetidos (Shiyu Defense) y `gearFor` lista W-Engines, Drive Discs y opciones F2P con atribución, marcando lo que la cuenta posee.

Los pesos son heurísticas del ejemplo, no datos de la base. En Hoyo Builds conviene exponerlos como configuración.

## Salida con la base de prueba

El roster tiene a Miyabi (T0 en la fuente ficticia A), pero no a Yanagi, y ninguna fuente documenta un sustituto para Yanagi en ese equipo. Por eso Miyabi no aparece en ninguna sugerencia y su equipo sale como *near miss*:

```
▶ Nicole Demara / Qingyi / Zhu Yuan  score=1.017  fuentes=1
▶ Ellen Joe / Qingyi / Soukaku  score=0.768  fuentes=1
    · Qingyi sustituye a Von Lycaon (workable, team_claim, explicit_recommendation)
▶ Anby Demara / Ellen Joe / Soukaku  score=0.071  fuentes=1
    · Anby Demara sustituye a Von Lycaon (significant_downgrade, substitute_claim, internal_estimate)
    ! Incluye una sustitución basada en una estimación interna, no en una fuente externa.

Equipos avalados pero no formables (faltan agentes sin sustituto documentado):
  ✗ Hoshimi Miyabi / Tsukishiro Yanagi / Astra Yao — falta: Tsukishiro Yanagi

Mejor pareja sin solapamiento: [Nicole Demara, Qingyi, Zhu Yuan] + [Anby Demara, Ellen Joe, Soukaku]
```

## Integración en una app TypeScript

```ts
import { loadDatabase, MetaDatabase } from 'zzz-meta-knowledge';
import type { ClaimOf } from 'zzz-meta-knowledge/types';

// Node / servidor
const db = await loadDatabase('node_modules/zzz-meta-knowledge/db');

// Navegador: descarga los JSON listados en manifest.files y construye la base
const files = { manifest, agents, wEngines, driveDiscs, bangboo, sources, claims, consensus, index };
const db2 = MetaDatabase.fromFiles(files, { validate: true });

if (db.isFixture) throw new Error('no usar datos de prueba en producción');
const teams: ClaimOf<'team'>[] = db.claims({ kind: 'team', status: ['current'], minConfidence: 'medium' });
```
