# Cierre — WI-CORE-056
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Estado:** `W-DONE` (informe de análisis; sin cambios de producto) · **Subtarea:** ST-CORE-063

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-056-independent-review.md` (agente `reviewer`; ciclo 1 CHANGES_REQUESTED con 5 hallazgos de texto, corregidos; ciclo 2 de 2 APPROVED, con las cifras y la tabla de políticas recomputadas de forma independiente). Lectura autorizada por el usuario («WI-056: AUTORIZADO SELECT de solo lectura»). El usuario es informado y puede reabrirlo. No autoriza push ni cambios de ranking.

## Qué entrega
`harness/reports/wi-core-056-rag-context-noise-analysis.md`: diagnóstico del ruido (exp. 1: 8/10 chunks y 54 % de tokens son pruebas de la clase sin mencionar `hasStock`; exp. 2: 9/10 vecinos), el matiz de que el fallo del exp. 2 se debe a las reglas y no al ruido, una propuesta de contexto anclado al target con presupuesto en tokens, simulación offline P1 a P3 reproducible y riesgos (sin medir calidad; `DEC-RAG-001` PENDING). Ninguna escritura en la base ni cambio en `app/`.

## Decisiones que quedan para el usuario
Replay offline sobre el índice completo, ablación con LLM (OE2/OE5) antes de tocar el ranking y política de contexto de pruebas por defecto (con `DEC-RAG-001`).
