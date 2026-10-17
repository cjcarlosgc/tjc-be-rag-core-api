# WI-CORE-059 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader. Cambio mínimo del leader (motivo: solo prueba, 1 línea): `as unknown as {…}` en el spec del esquema para no añadir un error de `tsc`.
- Código: `71d3bc91cdae1c0a9515067b3bf74a7f026277a8` (`workspace-agent-tools.ts` y su spec) y enmienda de la spec 018 §5.
- Rojo → verde: 5 pruebas nuevas fallaban antes (método único `applyPendingPlan` y `total`, ambiguo `status`, referencia por último segmento `hasStock`, descripción del esquema); después `src/generation` y `src/providers` verdes. Guardas: un tipo homónimo gana sobre un método anterior, calificados y `Clase::método` sin cambio, inexistente EMPTY, TypeScript sin cambio.
- `npx vitest run` (app): 144 archivos pasan, 7 omitidos; 2329 pruebas pasan, 104 omitidas. `oxlint src/generation` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base).
- `validate-harness` y `node --test harness/*.test.mjs` pasan. Sin build; sin migraciones; sin tocar ranking, R-PHP, métricas ni contrato público.
- Riesgo: cambia el comportamiento observable del agente (menos EMPTY): la medición posterior es una versión nueva y debe declararse en el paper; un método homónimo en TypeScript no se resuelve.
