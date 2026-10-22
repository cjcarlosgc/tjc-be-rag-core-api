Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-050 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: APPROVED** · Rango: `ed71ad1^..ed71ad1` (`app/src/config/env.validation.ts`, `env.validation.spec.ts`, `app/.env.example`). Independiente del implementer (claude-haiku-5-5). Revisión delegada por awayMode; no sustituye aprobación de alcance/contrato ni autoriza push.

## Evidencia ejecutada
1. **Regla y casos límite** (sondas en worktree desechable, matriz production/development/test con `SANDBOX_SERVICE_TOKEN` presente):
   - production: OK `https://host:443/`, `https://host`, `HTTPS://HOST.EXAMPLE`, `https://host:8443`, `https://<SANDBOX_HOST>.sslip.io`; REJECT todo `http:` (incl. `localhost:3001`, `127.0.0.1:3101`, `[::1]`, `LOCALHOST`).
   - fuera de producción: OK `http://localhost:3001`, `http://127.0.0.1:3101`, `http://[::1]:3001`, `http://LOCALHOST:3001`; REJECT `localhost.evil.com`, `127.0.0.1.evil.com`, `0.0.0.0`, `127.0.0.2`, IPv4 mapeada (`[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`), `ftp://`.
   - REJECT credenciales (`u:p@`, `u@`, `:p@`), ruta (`/x`, `//`), query y hash con valor. 
   - Vacío o no definido permitido; `SANDBOX_URL` sin token o token sin URL siguen dando el mensaje DEC-AUTH-001 (evaluada antes, también con `http://evil.com`).
   - El mensaje no contiene el valor (sonda y prueba del spec).
2. **Consumidores**: `validateEnv` solo lo usa `app.module.ts`; los e2e (`app/test`) no fijan `SANDBOX_URL`; `scripts/local-php-env.mjs` genera `http://localhost:<puerto>` (válido); `sandbox-execution.service.spec.ts` usa ConfigService falso. Ningún fixture construye `validateEnv` con http no loopback.
3. **Mutantes** sobre `env.validation.ts` contra el spec (9, todos detectados, 33 pruebas): sin comprobación de producción, http no loopback permitido, ruta permitida, credenciales permitidas, `allowHttpLoopback` invertido, query/hash permitidos, https no exigido, hostname `startsWith('localhost')`, valor impreso en el mensaje.
4. **Alcance**: el rango solo toca 3 archivos de `app/` (+ harness en el commit docs posterior); sin cambios en `sandbox/`, `spec/`, experimentos, OE2/OE5, evidencia ni métricas; sin contratos; sin secretos (solo `'token'` de prueba y un host público sslip.io).
5. **Gates**: `npx vitest run` en el árbol (equivale al código revisado): 140 archivos pasan, 6 omitidos; 2190 pruebas pasan, 104 omitidas. `npx oxlint`: exit 0 en head y en base. `tsc --noEmit`: 45 errores en el árbol (preexistentes, solo specs); delta 0 por archivo head vs base `ed71ad1^` en worktrees desechables (397 = 397 sin cliente Prisma generado). `validate-harness` pasa; `node --test harness/*.test.mjs` 31/31. Sin build.

## Hallazgos
- **F1 (menor, informativo)**: `https://host/?` y `https://host/#` (query/hash vacíos) se aceptan porque `URL.search/hash` son `''`. Idéntico a `isAllowedGithubIntegrationUrl`; sin impacto de seguridad. recommendedNextStep: ninguno; unificar solo si se refactoriza ambas funciones.
- **F2 (menor, informativo)**: espacios al inicio/fin y `http://127.1`/`http://2130706433` se normalizan por WHATWG URL y se aceptan (el segundo grupo resuelve a loopback; legítimo). Sin acción.
- **F3 (menor, duplicación)**: `isAllowedSandboxUrl` duplica byte a byte `isAllowedGithubIntegrationUrl`. Aceptable por alcance acotado; candidato a helper común en un WI futuro.
- **F4 (editorial, ya registrado)**: línea de `DEC-INF-002` en SYSTEM-2.12 dice «preparado y sin implementar»; corresponde al siguiente bump con contract-reviewer.

## Resultado
`status: APPROVED` · `blockers: []` · `filesAffected`: `app/src/config/env.validation.ts`, `app/src/config/env.validation.spec.ts`, `app/.env.example` · `recommendedNextStep`: el leader puede marcar W-DONE; recordar el riesgo operativo (producción con `SANDBOX_URL` http no arranca; Render ya usa `https://<SANDBOX_HOST>.sslip.io`).
