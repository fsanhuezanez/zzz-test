# Envíos editoriales

Un fichero JSON por página consultada, agrupado por parche (`3.3/`, `3.4/`…). Formato: `schemas/editorial-submission.schema.json`.

- `<parche>/*.json`: datos leídos en la página (pendientes o verificados).
- `<parche>/leads/*.json`: **pistas de buscador** (`collectionMethod: "web_search"`): no se ha leído la página y nunca están verificadas.
- `*.draft.json` y los ficheros que empiezan por `_` se ignoran.

Crear un borrador: `npm run new-submission -- --source <id> --template team|build|tier|all --url <página>`

Guía: [docs/EDITORIAL-GUIDE.md](../../docs/EDITORIAL-GUIDE.md)
