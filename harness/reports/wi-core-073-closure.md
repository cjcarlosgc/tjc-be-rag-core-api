# WI-CORE-073 (WI-C) — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: el error envelope de Core tiene 12 códigos genéricos (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `NOT_ACCEPTABLE`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `UNPROCESSABLE_ENTITY`, `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`, `HTTP_ERROR`; 5xx sin código = `INTERNAL_ERROR`) con mensaje fijo en español, `retryable` solo en los genéricos (true en 429 y 503) y estado HTTP conservado. INTEROP-2.18 (versión única junto con WI-D) documenta §4.1; esquema (solo descripciones), ejemplo `error-envelope.generic.json` y tipos generados actualizados; `DEC-ERR-001` PROPOSED (`Blocks: NONE`). Alcance aprobado por el usuario el 2026-10-19 («Apruebo todo lo recomendado»). Commits `6723832` y `f01e655`.

- Revisión independiente (`reviewer`): APPROVED, ciclo 1 de 2; 5 mutaciones detectadas (`wi-core-073-independent-review.md`).
- Revisión contractual (`contract-reviewer`): APPROVED (`wi-core-073-contract-review.md`); L1 (comentario «INTEROP-2.17 §4» → «INTEROP §4») y L2 (`spec/transversal/errors/spec.md`: `retryable` también `false` en el resto de genéricos) corregidos por el leader; L3 (línea Modelo del implementer-high: `claude-haiku-5-5` es el modelo configurado en `agent-profiles.yaml`) confirmado.
- `publishesContract=false`: WI-C **no publica** Contract Sync; la publicación única de INTEROP-2.18 la hace WI-D. Entre este cierre y el de WI-D, Console, GitHub Integration y Sandbox siguen en INTEROP-2.17: el cambio es aditivo y ningún consumidor depende de que 401/403/404/405/415 lleguen como `INVALID_REQUEST` (verificado en lectura por el contract-reviewer).
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
- Para el evento de WI-D (según el contract-reviewer): declarar un único juego INTEROP-2.18 (WI-C más §6.6), aditivo; listar los códigos de §4.1; GitHub Integration conserva su política de `INVALID_REQUEST` y Sandbox ya usa esos nombres; `code` se trata como abierto; incluir esquema, ejemplo y manifest; `DEC-ERR-001` PROPOSED con `Blocks: NONE`; Anexo E solo por referencia.

Observaciones no bloqueantes: los errores que no son HttpException siguen sin `retryable`; un HttpException con `code` en el cuerpo se devuelve sin validarlo contra el enum (comportamiento previo). Las referencias «INTEROP-2.17» restantes (`system-contract.md:471`, `github-integration-contract.md:3,143`, `sandbox-execution.schema.json:52`, comentarios de código) son históricas y correctas; no requieren bump ahora.

Fuera de alcance: WI-CORE-074 (WI-D) en cola; sin push, PR ni merge; sin tag.
