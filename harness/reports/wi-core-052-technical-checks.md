# WI-CORE-052 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low); verificación del leader.

- Rojo → verde: 2 pruebas del handler fallaban antes (PHP no llamaba a `compute` ni persistía `behaviorConstructs`); después `src/snapshot-intelligence` y `src/functional-knowledge` 234/234. La aserción previa `compute` no llamado para PHP, que codificaba el diferimiento, pasó a `toHaveBeenCalledTimes(1)`. Las pruebas nuevas del servicio con PHP en monorepo (`projectRoot` `backend/`, lectura del archivo correcto, base por ruta y `baseSha`, base null, `added`, error de GitHub propagado) son de caracterización: el servicio ya despachaba PHP y respetaba el prefijo. La prueba del evaluador (PHP + BOUNDARY sin regla ACTIVE → ACTION_REQUIRED, `WI-CORE-032`) ya existía.
- `npx vitest run` (app): 140 archivos pasan, 6 omitidos; 2204 pruebas pasan, 104 omitidas. `oxlint` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base).
- `node harness/validate-harness.mjs` y `node --test harness/*.test.mjs` pasan. Sin build en `app/`; `app/.env` y la base real no tocados.
- Riesgos declarados: una lectura adicional a GitHub por archivo PHP cambiado; un fallo de esa lectura termina el Run `INFRASTRUCTURE_FAILURE` (como TypeScript); los PRs PHP con construcciones nuevas pasan a `ACTION_REQUIRED` (esperado por `DEC-FK-003/004`) y requieren respuesta de Maintainer/Admin. No afecta experimentos, OE2/OE5, evidencia ni métricas. `POTENTIALLY_IMPACTED` para PHP fuera de alcance.
