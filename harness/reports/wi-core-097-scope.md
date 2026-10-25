# WI-CORE-097 — alcance: aislamiento por Project y purga de datos (Projects de calificación `prepiloto-*`)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Pedido de cross (2026-10-25, relayado del usuario), solo lectura: verificar con código y spec (1) que retrieval, chunks/embeddings, Functional Knowledge y experimentos están acotados siempre por `projectId`/`projectVersionId`, de modo que un Project `prepiloto-*` no pueda aparecer en el contexto de otro; (2) cómo se purgan los datos de un Project (BD y Storage); (3) dejar registrado el riesgo de gobierno de datos (el código de la empresa viaja a OpenAI y se guarda en la Supabase del usuario).

Entregable: `harness/reports/wi-core-097-aislamiento-y-purga-projects.md`, con citas de código/spec, lo verificado, lo inferido y lo no verificado, y las decisiones del usuario. Documental: sin cambios en `app/`, contratos, esquemas, BD, Storage, `.env`, tesis ni otros repos; no se ejecuta nada contra BD ni Storage. Decisiones PENDING relacionadas: `DEC-VAL-001` (`Blocks` ingestión de código empresarial) se reporta, no se cierra.

Hecho cuando: el informe pasa la revisión independiente (`reviewer`) y se entrega la ruta a cross.
