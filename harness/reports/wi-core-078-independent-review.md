# WI-CORE-078 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: APROBADO (APPROVED), sin bloqueadores.** Código revisado: commit `83d758e` (`feat(config): escapar valores…`) sobre `83d758e~1`.

## Verificación
1. **Escape (`echoEnvValue`, `env.validation.ts:~395-408`)**: recorta con `Array.from(text).slice(0,40).join('')` (40 puntos de código) y escapa después con `JSON.stringify` más `[\u007f-\u009f  ]` como `\uXXXX`. ESC/ANSI (`\x1b`), `\r`, `\n` y `\u0085` salen escapados (C0 por JSON, C1 por la regex); el sustituto suelto lo escapa JSON.stringify moderno (probado). Valores normales: mensaje idéntico al anterior (`"valor"`; la diff solo sustituye `"${x.slice(0,40)}"` por `${echoEnvValue(x)}`). Incidente del editor: `grep -P` de U+2028/U+2029/U+0085 literales en `app/src` sin resultados; la regex usa escapes `\u`.
2. **Topes**: `parseBoundedInteger` (antes `parseSandboxPollInteger`, mismo cuerpo): trim, vacío = error, `^\d+$`, `Number.isSafeInteger`, rango; ausente = default. 1..600 (default 120) y 100..60000 (default 10000). Las pruebas cubren 0, 601, -1, 2.5, +3, 1e3, 0x10, 10s, 10_000, abc, enorme, 99, 60001, 100.5. Defaults y `.env.example` (10000/120) válidos; CI y `vitest.config.e2e.ts` no definen estas variables (usan default). Se quitó solo `@IsInt/@Min/@Max` (sustituidos por `@IsOptional` + validación manual; nada más se perdía). `validated` recibe número. `sandbox-execution.service.ts` solo cambia imports/re-exports (defaults movidos a `config/sandbox-poll.defaults.ts`, que no importa nada: sin ciclos); `attempt-recovery.ts` sin diff; consumidores (servicio, handler) sin cambios de lógica.
3. **Compatibilidad**: specs de resiliencia, recuperación y handler pasan sin tocarse.
4. **Pruebas**: reales. Mutaciones (todas restauradas con `git checkout`): tope 600→601 FALLA; timeout min 100→99 FALLA; recorte a unidades UTF-16 FALLA; no escapar U+2028 FALLA; quitar escape de U+0085 FALLA; aceptar vacío FALLA (2 pruebas); quitar regex `^\d+$` FALLA (2 pruebas). **Sobrevive**: no escribir el valor normalizado de `SANDBOX_MAX_POLL_ATTEMPTS` en `validated` (ver F-1).
5. **Alcance**: O3 sin tocar; sin cambios de contrato, DTO, rutas ni otras variables; `app/.env` no aparece en `git status`; sin secretos (la prueba de no exposición de secretos pasa).

## Ejecución (desde `app/` y raíz)
`pnpm lint` OK · `pnpm build` OK · `pnpm contracts:check` OK · `pnpm test` 157 archivos / 2646 pruebas OK (104 omitidas) · `pnpm test:e2e` 9 archivos / 259 OK · `sdd-check`, `validate-work-items` (79 WI), `validate-harness`, `validate-completions` (75) OK. `git status` tras mutaciones: limpio salvo este informe.

## Hallazgos
- **F-1 (baja, no bloqueante)** `app/src/config/env.validation.ts:~415-427` + `env.validation.spec.ts` («trims surrounding spaces», «exposes the normalized numeric values»): la asignación del valor normalizado a `validated` no está protegida por pruebas; al quitarla las pruebas siguen pasando porque la conversión implícita de `plainToInstance` ya entrega número (`' 600 '` → 600). El comportamiento es correcto; la asignación es defensa redundante. Opcional: nada que corregir.
- **F-2 (informativa)** Falta la prueba de `sandboxHttpBoundMs` con los topes máximos (apartado 4.4 del SDD, punto 4 del plan). No es necesaria para aceptar: la función es aritmética pura sin cambios, y el peor caso (T=60000, P=600, R=10, D=30000) ≈ 5,8·10^8 ms, muy inferior a 2^53; el informe SDD ya declara que los topes no acotan el producto. Si se quiere cerrar el compromiso del plan, añadir una prueba de finitud y `< Number.MAX_SAFE_INTEGER` (opcional, puede ir en un commit posterior).
- Sin findings de gravedad media o alta.

## Siguiente paso recomendado
Dar por aprobada la revisión (ciclo 1); el leader puede cerrar el WI. F-1/F-2 opcionales.
