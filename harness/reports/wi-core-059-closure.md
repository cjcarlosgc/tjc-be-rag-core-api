# Cierre — WI-CORE-059
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-066

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-059-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED; 14 casos calificados idénticos a la base; mutantes principales detectados). Alcance aprobado por el usuario («Confirmo #5 y #6»). El usuario es informado y puede reabrirlo. No autoriza push ni despliegue.

## Qué entrega
`inspect_symbol` del GENERALIST_AGENT resuelve por nombre simple los métodos PHP cuando no hay tipo ni función con ese nombre (`applyPendingPlan`, `total`); con varios, el primero por ruta y posición con «Ambiguo: N coincidencias» y las rutas; nombres calificados, TypeScript y las demás herramientas sin cambio; descripción del esquema actualizada; spec 018 §5 enmendada. Código `71d3bc91cdae1c0a9515067b3bf74a7f026277a8`. Sin tocar ranking, R-PHP, métricas ni contrato.

## Criterio de verificación post-despliegue
En los experimentos con el agente sobre PHP, `inspect_symbol("applyPendingPlan")` y `inspect_symbol("total")` ya no terminan `EMPTY` (trayectoria y observaciones SYMBOL en la traza AGENT); un nombre homónimo muestra la línea «Ambiguo…». Declarar la versión del agente en el paper.

## Notas
H1/H2 en `IDEA-032`. `__construct` por nombre simple resuelve y suele ser ambiguo (el ítem #4 de constructores no se toca).
