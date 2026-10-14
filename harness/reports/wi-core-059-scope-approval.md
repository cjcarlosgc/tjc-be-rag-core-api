# WI-CORE-059 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (AskUserQuestion «Confirmo #5 y #6»), en orden #5 → #6, un WI activo a la vez, sin push ni despliegue; **no** el ítem #4 (constructores). Base: `harness/reports/fase2-diagnostico-items-4-5-6.md` (#5).

## Alcance
`inspect_symbol` del GENERALIST_AGENT resuelve por nombre simple los métodos PHP cuando no hay tipo ni función con ese nombre; con varias coincidencias devuelve la primera por ruta e indica «ambiguo: N coincidencias» con las rutas; TypeScript y las cuatro herramientas sin cambio; los nombres calificados siguen igual; se actualiza la descripción del esquema de la herramienta («Nombre exacto») y se enmienda la spec 018 §5. Incluye el fixture que distingue referencias por último segmento (`IDEA-029`). Sin cambiar ranking, R-PHP, métricas ni contrato público.
