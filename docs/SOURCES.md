# Fuentes: condiciones, dudas y cómo se usan

Revisión del 27-10-2026. Desde el entorno donde se preparó el proyecto **no se podía abrir ninguna de estas webs** (el proxy de red las bloquea). Por eso las condiciones de uso se leyeron en resultados de buscador (`checkedVia: "web_search"` en `data/sources.json`), y el informe pide releerlas en un navegador.

## Criterio general

- **Uso personal y no comercial no significa sin restricciones.** Se respetan las condiciones de cada sitio, aunque Hoyo Builds sea privado.
- **Ninguna fuente se automatiza.** Prydwen y Mobalytics lo prohíben, y del resto no consta permiso. Que no haya términos publicados **no equivale a autorización**.
- **Hechos breves y enlace, nunca texto copiado:** qué equipo, qué sustituto, qué set y qué estadística. El `excerpt` está limitado a 200 caracteres.
- **No se salta ningún bloqueo:** nada de mirrors o cachés de CDN de una web bloqueada, ni de imitar navegadores.
- **Cuando hay dudas se elige la opción prudente** y se apunta en `automation.openQuestions`.

## Tabla

| Fuente | Qué aporta | Condiciones / duda | Decisión |
|---|---|---|---|
| **Prydwen** ([prydwen.gg/zenless](https://www.prydwen.gg/zenless/)) | Tier list por rol, guías por agente, equipos y builds | [Términos](https://www.prydwen.gg/terms): uso personal no comercial; prohíben scraping y extracción masiva. **Duda:** ¿compartir datos resumidos con amigos es «redistribuir»? | `disallowed` (automatizar). Manual, solo hechos breves con enlace; la base no se publica. |
| **Mobalytics** ([mobalytics.gg/zzz](https://mobalytics.gg/zzz/teams)) | Guías de build y equipos | [Términos](https://mobalytics.gg/terms/): prohíben bots, crawlers y minería de datos que no sean un navegador. | `disallowed`. Manual. |
| **ZZZ Akademiya** ([zzz.akademiya.app](https://zzz.akademiya.app/en)) | Base de datos y tier lists, algunas de usuarios | Sin términos ni API publicados. | `unknown`, tratada como no automatizable. Manual; indicar qué lista se consultó. Pedir un export si se quiere más. |
| **Game8** ([game8.co](https://game8.co/games/Zenless-Zone-Zero)) | «Best Team Comps», guías por agente con builds, alternativas y F2P | Términos no revisados en navegador. | `unknown`. Manual. Es la fuente más útil para equipos con alternativas. |
| **Icy Veins** | Equipos y sinergias por agente | No revisado. | `unknown`. Manual. Útil porque a veces discrepa (p. ej. Remielle con Phoenix). |
| **Game Rant** | Equipos por agente (prensa) | No revisado. | `unknown`. Manual. Prioridad baja; mirar la fecha. |
| **zzz-build.com** | Equipos y builds | No revisado. **Duda:** dice sincronizarse con Prydwen, así que puede no ser independiente. | `unknown`. Manual. Si coincide con Prydwen, no contar las dos como independientes. |
| **Timesaver.gg** | Equipos económicos para cuentas con pocos personajes | No revisado. | `unknown`. Manual. Prioridad baja. |
| **HoYoverse** (juego, HoYoLAB, notas de parche) | Hechos del catálogo y fechas de parche | — | Manual, para verificar el catálogo. |
| **maintainer** | Estimaciones propias razonadas | — | Solo `internal_estimate`, siempre separada de las fuentes. |

## Sobre las pistas de buscador (`leads/`)

Las 41 pistas de 3.3 salen de resúmenes generados por un buscador sobre esas páginas. Se registran porque ahorran tiempo: dicen qué página abrir y qué buscar en ella. Pero **no cuentan como lectura de la fuente**:

- `collectionMethod: "web_search"`, confianza `low`, nunca verificables tal cual.
- El resumen puede mezclar páginas o resumir mal. Varias pistas lo advierten en `notes`.
- Para convertir una pista en dato fiable: abrir la URL, corregir el envío, cambiar a `manual_entry`, moverlo fuera de `leads/` y pedir a otra persona que lo marque `verified`. Los pasos están en [EDITORIAL-GUIDE.md](EDITORIAL-GUIDE.md).

## Si una fuente da permiso

Si alguna fuente concede permiso escrito o publica un feed con licencia, apúntalo en `automation` (`status: "allowed"` y la evidencia en `evidenceUrls`). Un importador automático tendría que añadirse de nuevo: el anterior se retiró por no tener uso (está en el historial de git, en el commit inicial).
