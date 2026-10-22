# WI-CORE-073 (WI-C) — revisión contractual
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

**Commit revisado:** 6723832. **Veredicto: APPROVED** (con 3 observaciones menores no bloqueantes).

## (a) Contrato vs filtro real
`interoperability-contract.md` (cabecera INTEROP-2.18, §4, §4.1) coincide con `all-exceptions.filter.ts` y `error-code.enum.ts`: los 11 estados con mensaje fijo, 5xx restante a `INTERNAL_ERROR`, otro 4xx a `HTTP_ERROR`, `retryable` true solo en 429 y 503, `details: null`, código explícito antes que genérico, 400 a `INVALID_REQUEST` con `details`, y parser de body sin cambio. El Anexo E se cita solo por referencia. Los 12 códigos nuevos del enum coinciden con la tabla.

## (b) Esquema, ejemplo y manifest; aditividad
- El esquema solo cambia descripciones; `code` sigue siendo string abierto y `retryable` y `phase` siguen opcionales. El ejemplo `error-envelope.generic.json` está en el manifest y valida (`pnpm contracts:check` ok y 55 tests de filtro y contrato en verde).
- El cambio es aditivo. Antes, una HttpException sin código (401/403/404/405/415…) salía como `INVALID_REQUEST` con el texto de la excepción. Ahora sale con su código genérico y mensaje fijo.
- Consumidores revisados (solo lectura):
  - Console (`api/client.ts:52,97-105`): decide por `status` y por `code` solo para 401 (`SESSION_ENDING_401_CODES`: AUTH_REQUIRED, INVALID_ACCESS_TOKEN, GITHUB_IDENTITY_REQUIRED). Un 401 `UNAUTHORIZED` no cierra sesión, igual que antes con `INVALID_REQUEST`. `retryable` solo se guarda en `ApiError`; el reintento automático existe únicamente en `socket.ts`, que usa otro canal. No hay dependencia de `INVALID_REQUEST` para 401/403/404/405/415; los `INVALID_REQUEST` de `control-plane/api.ts` son locales.
  - GitHub Integration y Sandbox no consumen errores de Core. Core como cliente de GitHub (`github-integration.client.ts:45`) mapea los errores de GH, que no cambian.
  - Conclusión: no hay ruptura ni cambio de mapeo de Core como cliente.

## (c) Referencias «INTEROP-2.17» restantes
Ninguna requiere bump ni corrección ahora. Todas son históricas o describen algo introducido en 2.17 que sigue siendo cierto:
- `spec/contracts/system-contract.md:471`: nota histórica de SYSTEM-2.13.
- `spec/contracts/github-integration-contract.md:3,143`: GH-INTEROP-1.8 cita el envelope de «INTEROP-2.17 §4», que es el hito en que se unificó la forma. Sigue siendo exacto. Un bump de GH-INTEROP sería ruido; el nuevo `retryable` de Core no toca el contrato de GitHub.
- `spec/contracts/schemas/sandbox-execution.schema.json:52` y `interoperability-contract.md:1403`: la tolerancia de `phase` nació en 2.17 §7.2. Es histórico y correcto.
- `spec/features/017-cross-repository-dependency-gates/tasks.md:7`: historia de WI-CORE-069.
- Comentarios en código (`contract-validator.ts:5`, `contract-validator.spec.ts:11`, `sandbox-execution.contract.spec.ts:7`, `sandbox-execution.service.ts:458`, `github-integration.client.contract.spec.ts:7`): remiten a §4, §7 o §10 sin depender de la versión.
- Observación menor (L1): `app/src/common/filters/all-exceptions.filter.ts:78` dice «INTEROP-2.17 §4» y conviene «§4». Es un comentario, sin efecto contractual, y no justifica un cambio por sí solo.
- `spec/README.md` ya dice INTEROP-2.18 como línea base de Core. Los espejos de otros repos dirán 2.17 hasta el sync de WI-D (ver e).

## (d) DEC-ERR-001 (`spec/transversal/errors/spec.md`)
La sección «Decisiones» tiene estado PROPOSED, `Blocks: NONE` explícito, propuesta y trazabilidad (Anexo E por referencia). El formato y `Blocks: NONE` son coherentes con el alcance aprobado.
- Observación menor (L2): la regla nueva de ese `spec.md` (línea 15) dice que `retryable` «solo aparece en TOO_MANY_REQUESTS (true) y SERVICE_UNAVAILABLE (true)». Es impreciso: también aparece como `false` en los demás genéricos (según §4.1). Conviene corregirlo en el siguiente toque documental, por ejemplo en WI-D. No es bloqueante, porque §4.1 es la fuente normativa.

## (e) Desfase temporal de espejos
- Los espejos de github-integration, console y sandbox seguirán en INTEROP-2.17 hasta WI-D. No rompe nada: el cambio es aditivo, Core solo emite más detalle (`code` string abierto y `retryable` opcional) y los consumidores ignoran campos desconocidos. Ninguno depende de los códigos que cambian.
- El evento de Contract Sync de WI-D debería:
  1. Declarar un único juego INTEROP-2.18 (WI-C más §6.6) para los tres repos.
  2. Indicar que el cambio es aditivo.
  3. Listar los códigos nuevos con estado y `retryable` (§4.1).
  4. Decir que GitHub Integration conserva su política (`INVALID_REQUEST` para 4xx no previstos) y que Sandbox ya usa esos nombres.
  5. Pedir a los consumidores solo que traten `code` como abierto.
  6. Incluir el esquema, el ejemplo `error-envelope.generic.json` y el manifest en el espejo.
  7. Marcar DEC-ERR-001 como PROPOSED (`Blocks: NONE`) y citar el Anexo E por referencia.
- Observación menor (L3): `harness/reports/wi-core-073-implementation.md:2` declara «configurado claude-haiku-5-5» para implementer-high. Conviene confirmarlo con `agent-profiles.yaml`; no es un tema contractual.

## (f) Ejecuciones (desde `app/`)
- `pnpm contracts:check`: ok (rc 0).
- `pnpm exec vitest run src/common/filters src/contracts`: 3 archivos y 55 tests en verde. El stack de la salida es el log esperado de un caso de 5xx.
- `jest` no existe en este repo; el runner es vitest.

## Resultado
Sin hallazgos bloqueantes. Hay 3 observaciones de gravedad baja (L1, L2, L3).
