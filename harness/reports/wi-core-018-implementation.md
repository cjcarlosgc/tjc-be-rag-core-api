# WI-CORE-018 — Implementación
Modelo: implementer-high · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high (tres cortes; escalado preventivo desde implementer: cambio multiarchivo con AST, migración y concurrencia). Orquestación: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium.

## Cortes (commits)
1. `a01bea1` módulo `behavior-fingerprint` (construcciones, forma normalizada, huella, `scenarioKey`, diff base/HEAD).
2. `17ebf0d` `UNKNOWN` como abstención auditada: tabla `functional_question_abstentions`, columnas `scenarioKind`/`scenarioKey` (preguntas) y `behaviorConstructs` (símbolos), `outcome`, `abstention`, `answer()` condicional.
3. Elegibilidad exacta de `ACTION_REQUIRED`: `SymbolBehaviorConstructsService` (base = `run.baseSha`), persistencia en el job de snapshot y evaluador reescrito.

## Checks (desde `app/`, 2026-10-08)
- `pnpm lint`: exit 0.
- `pnpm test`: 105 archivos pasan, 1 omitido; 1246 tests pasan, 36 omitidos (línea base previa: 1169).
- `pnpm build`: exit 0.
- `tsc --noEmit` completo reporta ~43 errores previos en specs/fixtures ajenos (p. ej. `disabledReason`, `pullRequestCreatedAt`); el build de producción pasa y no hay errores en los archivos de producción tocados.
- La migración `20261008120000_functional_question_scenarios_abstentions` no se ejecutó contra PostgreSQL (no hay BD local); `prisma validate` y `prisma generate` pasan.

## Puntos para el Human Reviewer
- Decisiones de implementación fuera de la letra de la spec (registradas en `plan.md`): base = `run.baseSha`; preguntas históricas devuelven `EXPECTED_RESULT`/`LEGACY`; orden de `submitAnswer` interno al servicio (la guarda de ruta sigue siendo MAINTAINER); símbolos con `behaviorConstructs` nulo (PHP, Runs previos) no preguntan.
- Riesgos conocidos: si el archivo base no parsea, todas las construcciones del HEAD cuentan como nuevas; en la rama normal la regla se crea antes del `answer()` condicional, así que una carrera perdida deja una regla `ACTIVE` (el comportamiento previo ya admitía respuestas simultáneas duplicadas); `markObsolete` ocurre antes de la verificación de rol; ABSTAINED no devuelve el resumen (el contrato no lo define), Console relee el set de preguntas.
- Evaluador exige `language TYPESCRIPT`; hasta WI-CORE-020 una respuesta crea regla `ACTIVE` del target y evita preguntar por las demás construcciones.
- `publishesContract` del registro pasó de `false` a `true` para poder emitir el Contract Sync de implementación a Console que exige el criterio final; confirmar.
