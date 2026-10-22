# WI-CORE-069 — regularización del corte «desde cross»

Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Naturaleza retroactiva

Los commits `3955398`, `3e66b2a` y `6714019` de `feature/jean` se ejecutaron **antes** de que existiera este WI, desde la sesión cross y por orden expresa del usuario (excepción puntual «desde cross»), sin `sdd-analyst`, sin aprobación de alcance registrada y sin revisión independiente. Este WI no reescribe esa historia: registra el corte tal como ocurrió, lo somete a la verificación SDD, a la aprobación de alcance y contratos, y a la revisión independiente que no tuvo, y publica el Contract Sync que la coordinación entre repositorios esperaba. Los commits `5fa5666` y `9945342` (SDD 3.1) quedan fuera de este WI: son reglas del Harness y tienen su propia regularización (ver «Fuera de alcance»).

## Alcance

1. Contratos canónicos: `SYSTEM-2.13`, `INTEROP-2.17`, `GH-INTEROP-1.8`; `spec/contracts/schemas/` (`common`, `error-envelope`, `sandbox-execution`, `examples/` y `manifest.json`).
2. Código de Core: tipos generados (`app/src/contracts/generated/`), validador Ajv, pruebas de contrato, alineación de `sandbox.types.ts` con el esquema, `JobsService.tick()` resiliente, `enableShutdownHooks()` y red de seguridad de proceso, reintentos de GET al Sandbox y tope de `pollAfterMs`, `CONSOLE_CORS_ORIGINS` opt-in, `.env.example` completo, `engines`/`.nvmrc`/`packageManager`, CI, y refactor mecánico de `experiment-job.handler.ts` a `experiment-attempt-presenters.ts` y `experiment-job.helpers.ts`.
3. Contract Sync hacia `github-integration`, `console` y `sandbox`.

## Decisiones ya tomadas por el usuario (relayadas por cross; no se reabren)

- `phase` opcional en el contrato (tolerancia transitoria): cerrada y aprobada.
- `CONSOLE_CORS_ORIGINS`: aprobada, opt-in (sin ella CORS sigue abierto); el usuario la define en Render.
- Timeout de 8 s del webhook Integration→Core: sin cambios; se asume Core caliente.
- Token de context7 e IP en el historial git: se ignoran (el repo pasará de público a privado).
- Revisión por `reviewer` + `contract-reviewer`, máximo 2 ciclos; sin push, PR ni merge sin orden del usuario.

## Fuera de alcance

- Commits `5fa5666`/`9945342` (SDD 3.1, `harness/README.md`): reglas del Harness; se regularizan aparte si el usuario lo pide.
- WI-B (refactor de `runAttempt` y pipeline compartido), WI-C (INTEROP-2.18, códigos de error) y WI-D (tiempo real): WIs posteriores, uno activo a la vez.
- Esquemas Core↔GitHub Integration y respuestas Core→Console.
