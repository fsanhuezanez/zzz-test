# Fuentes: condiciones, decisión y alternativa editorial

Revisión del 27-10-2026. Desde el entorno de desarrollo no se podía acceder a estos dominios (el proxy de red los bloquea), así que las condiciones se consultaron en los fragmentos que devuelve un buscador. **Antes del primer envío hay que releer las páginas originales en un navegador**, actualizar `automation.checkedAt` en `data/sources.json` y corregir esta tabla si algo cambió.

| Fuente | Qué aporta | Condiciones encontradas | Decisión |
|---|---|---|---|
| **Prydwen Institute** — [prydwen.gg/zenless](https://www.prydwen.gg/zenless/) | Tier list por rol, guías de agente, equipos, builds | [Términos](https://www.prydwen.gg/terms): prohíben *scrape, crawl or otherwise extract data in bulk*, limitan el uso a fines personales no comerciales y prohíben redistribuir el contenido con fines comerciales. Las guías son propiedad intelectual de Prydwen. No hay API pública. | `disallowed` → solo `manual_entry` |
| **Mobalytics** — [mobalytics.gg](https://mobalytics.gg/) | Tier lists, guías y builds | [Términos](https://mobalytics.gg/terms/): prohíben acceder, buscar o descargar contenido con spiders, robots, crawlers o herramientas de minería de datos que no sean su software o un navegador estándar, y prohíben el scraping para entrenar IA. | `disallowed` → solo `manual_entry` |
| **ZZZ Akademiya** — [zzz.akademiya.app](https://zzz.akademiya.app/en) | Base de datos (personajes, W-Engines, builds) y tier lists, incluidas listas creadas por usuarios | No se encontraron términos de uso, API ni feed. Es un sitio comunitario no afiliado a HoYoverse. | `unknown` (equivale a `disallowed`) → solo `manual_entry` |
| **HoYoverse** (juego, HoYoLAB, notas de parche) | Hechos del catálogo | Solo se registran hechos verificados a mano. | Manual, solo para el catálogo |
| **Mantenedor** (interna) | Estimaciones propias razonadas | — | Solo `internal_estimate` |

## Qué no se hace

- No se usa scraping, navegadores automatizados ni cabeceras que imiten a un navegador para saltarse bloqueos o desafíos anti-bot.
- No se copian textos de guías. Solo se registran hechos estructurados (qué tier, qué equipo, qué set) con palabras propias, con un `excerpt` opcional de 200 caracteres como máximo y siempre con la URL.
- No se atribuye a una fuente nada que la fuente no diga. Lo que es inferencia se registra como `internal_estimate` con la fuente interna.
- No se registran estadísticas de uso que la fuente no publique, ni se inventan tamaños de muestra.

## Alternativa editorial (lo que sí se puede hacer hoy)

1. **Pase editorial por parche.** Cuando sale un parche y las fuentes actualizan sus listas, un editor abre cada página en su navegador (uso personal normal) y registra los hechos en un envío. Ver [EDITORIAL-GUIDE.md](EDITORIAL-GUIDE.md).
2. **Revisión por pares.** Una segunda persona contrasta el envío con la página y lo marca `verified` (`reviewedBy`, `reviewedAt`). Hasta entonces lleva el flag `unverified` y el consumidor puede filtrarlo con `verifiedOnly`.
3. **Mínimo necesario.** Se registran ranking, composición, sustitutos y sets, no explicaciones ni análisis. El valor de la base está en estructurar, fechar y cruzar los datos, no en reproducir las guías.
4. **Atribución visible.** Hoyo Builds debe mostrar `db.attribution(claim)` y enlazar la página original.

## Cómo conseguir automatización legítima

- **Pedir permiso o un export.** Escribir a cada sitio explicando el proyecto (uso, frecuencia, atribución, enlaces de vuelta) y pedir un feed JSON o permiso por escrito. Akademiya, al no publicar condiciones, es la candidata más razonable.
- Si se concede: poner `automation.status: "allowed"`, el método (`automated_feed` o `automated_api`), la URL o el documento del permiso en `evidenceUrls` y un `adapter` `http_json_feed`. El feed debe usar el formato de `schemas/editorial-submission.schema.json`.
- **Uso comercial.** Si Hoyo Builds se monetiza, los términos de Prydwen (uso personal y no comercial) obligan a pedir permiso incluso para el resumen manual de sus datos. Hasta entonces, conviene limitar su uso a enlazar la fuente o hablar con ellos.

## Otras fuentes posibles (no integradas)

Creadores de contenido y hojas de cálculo comunitarias de theorycrafting suelen publicar análisis útiles. Pueden añadirse como fuentes con su propia política. Si permiten exportar los datos (por ejemplo una hoja pública con licencia), son buenas candidatas a `automated_feed`.
