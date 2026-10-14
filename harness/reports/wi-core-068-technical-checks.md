# WI-CORE-068 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low), un corte (commit e992951); verificación del leader.
- Código: `ENUM_MARK` y `FINAL_MARK` en `php-dependency-context.ts`; `PhpDependencyEntry.enum?: true` interno; `enumTypes` desde `symbolKind` ENUM en el servicio (un enum conserva `final: true`); versión `php-prompt-2026-10-14.7` sin tocar la redacción de las convenciones.
- Rojo → verde (confirmado por el leader con stash del código de producto): 10 pruebas fallan sin el cambio (marca de enum con `SubscriptionStatus`, final class sin mención a enums, enum+clase, tope de 300 tokens, `enumTypes` del resolutor, versión .7) y pasan con él; la prueba de `context-traces.service.spec` es guarda de regresión (la traza expone `final: true` y no `enum`).
- `npx vitest run` (app): 148 archivos pasan, 7 omitidos; 2434 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base, delta 0). `validate-harness` pasa. Sin build; sin migraciones; sin contrato ni traza.
- Riesgos: cambia el texto del prompt RAG para clases `final` (se quita «o un caso si es un enum») y enums; el efecto sobre el LLM solo se mide con un experimento nuevo.
