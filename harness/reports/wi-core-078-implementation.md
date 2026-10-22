# WI-CORE-078 — implementación: escape de valores y topes de entorno
Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

Informe del implementer (transcrito por el leader). Alcance aprobado por el usuario: `wi-core-078-scope-approval.md` (O3 no se toca; WI-CORE-079 en espera).

## Reglas y mensajes finales

- **L1:** `echoEnvValue(text)` exportado en `app/src/config/env.validation.ts`: recorta a 40 puntos de código (`Array.from`) y después aplica `JSON.stringify` más el escape `\uXXXX` de U+007F–U+009F, U+2028 y U+2029; devuelve el literal con comillas. Se usa en `LLM_REASONING_EFFORT`, `SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS` y los dos topes nuevos; `LLM_MODEL` y el resto de los mensajes no repiten valor (revisado). Para valores normales el texto de los mensajes queda idéntico (las pruebas existentes pasan sin cambios).
- **Topes:** `SANDBOX_MAX_POLL_ATTEMPTS` entero 1..600 (default 120) y `SANDBOX_REQUEST_TIMEOUT_MS` entero 100..60000 ms (default 10000). Parser único `parseBoundedInteger` (antes `parseSandboxPollInteger`): regex `^\d+$` sobre el texto recortado y `Number.isSafeInteger`; ausente = default; vacío o solo espacios = error; `1e3`, `0x10`, `+3`, decimales, unidades y fuera de rango = error. Se quitaron `@IsInt/@Min/@Max` de ambas claves (quedan `@IsOptional()`) y el valor normalizado se escribe en el objeto validado.
- **Mensajes:** `SANDBOX_MAX_POLL_ATTEMPTS=<eco> no es válido; debe ser un entero entre 1 y 600.`, `SANDBOX_REQUEST_TIMEOUT_MS=<eco> no es válido; debe ser un entero entre 100 y 60000 (ms).`, y los de vacío («si no la define se usa el valor por defecto 120» y «10000»), todos con el prefijo `Configuración de entorno inválida:`.
- **Defaults:** `DEFAULT_REQUEST_TIMEOUT_MS` y `DEFAULT_MAX_POLL_ATTEMPTS` pasan de `sandbox-execution.service.ts` a `app/src/config/sandbox-poll.defaults.ts` (fuente única); el servicio los re-exporta y `experiment-job.handler.ts` no cambia.

## Pruebas nuevas (`env.validation.spec.ts`, bloques añadidos sin modificar los existentes)

`echoEnvValue` (normales sin cambio, comillas y barra, `\n \r \t` y C0, U+007F/0085/009F/2028/2029, emoji y acentos intactos, sustituto suelto, recorte a 40 puntos de código y frontera de escape); mensajes con eco en `LLM_REASONING_EFFORT` y `SANDBOX_POLL_RETRIES`; topes (defaults ausentes, bordes 1/600 y 100/60000 como número, `" 120 "` válido, fallos para 0, 601, -1, 2.5, +3, 1e3, 0x10, 10s, 10_000, abc, enormes, 99, 60001, 100.5, vacío y solo espacios, truncado a 40, sin secretos, valor normalizado vía ConfigService).

## Evidencia (desde `app/`, Node 22.23.3)

| Comando | Resultado |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm test` | 157 archivos pasan, 7 omitidos; 2646 tests pasan, 104 omitidos (antes 2628) |
| `pnpm test:e2e` | 9 archivos, 259 tests pasan |

## Incidencia y desvíos

Durante la implementación el editor insertó U+2028/U+2029 literales dentro de una regex (daba «Unterminated regular expression»); se sustituyeron por secuencias de escape y se verificó con lint, build y tests. Desvíos: no se añadió la prueba unitaria de `sandboxHttpBoundMs` con los topes máximos (apartado 4.4 del informe SDD; queda a criterio del reviewer) y los defaults de los topes se movieron a `sandbox-poll.defaults.ts` en vez de duplicarse. O3 sin tocar.

## Antes de desplegar

Revisar en Render `SANDBOX_MAX_POLL_ATTEMPTS` y `SANDBOX_REQUEST_TIMEOUT_MS`: fallarían, por ejemplo, 1000 intentos, 120000 ms, o valores con unidad, decimales o notación científica.
