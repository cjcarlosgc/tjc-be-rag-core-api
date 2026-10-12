# WI-CORE-050 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader.

- Rojo → verde: 4 pruebas nuevas de rechazo fallaban antes (http no loopback, loopback en producción, credenciales/ruta/query, URL inválida); después `src/config` y `src/sandbox` 98/98.
- `npx vitest run` (app): 140 archivos pasan, 6 omitidos; 2190 pruebas pasan, 104 omitidas.
- `npx oxlint src/config`: sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base de WI-CORE-048, solo specs preexistentes; el cambio toca `env.validation.ts` y su spec sin añadir errores).
- `node harness/validate-harness.mjs` y `node --test harness/*.test.mjs` pasan.
- Sin build en `app/`; `app/.env` no tocado. `sandbox-execution.service.spec.ts` usa un ConfigService falso y no pasa por `validateEnv`.
- Contrato: la regla de arranque ya está descrita como «seguimiento aprobado aparte» en `DEC-INF-002` (SYSTEM-2.12); no cambia DTO, rutas ni transporte. Deuda editorial: esa línea aún dice «preparado y sin implementar» (siguiente bump de SYSTEM, con contract-reviewer).
- Riesgo operativo: una producción con `SANDBOX_URL` http no arranca; Cross verificó `https://136-115-2-208.sslip.io` en Render.
