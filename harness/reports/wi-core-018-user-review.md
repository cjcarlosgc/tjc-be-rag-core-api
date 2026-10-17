# Revisión humana — WI-CORE-018

**Fecha:** 2026-10-08 (America/Lima)
**Reviewer:** usuario (Human Reviewer); el veredicto proviene del usuario en el chat de la sesión, no de un agente.
**Veredicto:** `APPROVED` (con la nota de INTEROP-2.7 §6.11)

El usuario revisó el diff y la evidencia (`wi-core-018-implementation.md`, `wi-core-018-contract-review.md`) y decidió:

1. Aplicar la nota de una frase en INTEROP-2.7 §6.11 (preguntas históricas -> `EXPECTED_RESULT`/`LEGACY`) y reemitir el Contract Sync hacia Console (`CS-CORE-20261008-002`, `1c317f4`). Sin cambio de versión INTEROP.
2. No cambiar el orden interno de `submitAnswer`: 404 -> obsoleta -> rol -> UNKNOWN.
3. `publishesContract=true` en `WI-CORE-018` es correcto.
4. Aprobados los cuatro criterios de diseño de `plan.md`: base = `run.baseSha` vía `getFileContent`; históricas `EXPECTED_RESULT`/`LEGACY`; orden de `submitAnswer`; símbolos sin construcciones no generan pregunta.

## Deuda conocida aceptada por el usuario (sin corregir en este WI)
- Archivo base que no parsea: todas las construcciones del HEAD cuentan como nuevas.
- Regla `ACTIVE` huérfana si se pierde una carrera entre la creación de la regla y el `answer()` condicional.
- `markObsolete` ocurre antes de verificar el rol del usuario.
- `ABSTAINED` no devuelve el resumen de abstención; Console relee `context-questions`.

Esta evidencia no autoriza push, PR, merge ni despliegue.
