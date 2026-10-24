# WI-CORE-079 — ronda única de contratos INTEROP-2.20 / GH-INTEROP-1.9 / SYSTEM-2.15
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-IN_PROGRESS (reactivado).** Procedencia: mensaje escrito directamente por el usuario en el chat de Core el 2026-10-24: «Apruebo una sola ronda INTEROP-2.20 / GH-INTEROP-1.9 con el esquema canónico de CT-01, la errata E-01, SYSTEM-2.15 (tjc-piloto-ventas) y la corrección de sandbox-result.failed.json. No oracleRef. Los pilotos corren sobre forks míos con la App instalada. Acepto tus recomendaciones D-3, D-4, D-6 y D-7. Continúa.» Registrado como D-12 en `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` (WI-CORE-086).

**Historia:** este WI nació el 2026-10-21 como WI-B (solo la errata E-01) y el usuario decidió entonces «Mantener esperar» (`errata-pendientes-interop.md`: las erratas se corrigen junto con el próximo cambio de INTEROP por otro motivo). La ronda aprobada hoy es ese próximo cambio: E-01 viaja con el esquema de CT-01, SYSTEM-2.15 y el ejemplo del Sandbox. La propuesta antigua (solo E-01, «no se ejecuta ni se publica») queda superada.

## Alcance aprobado

1. **Esquema canónico CT-01** `spec/contracts/schemas/github-webhook-event.schema.json` del payload Integration→Core (`NormalizedWebhookEvent`, 9 variantes por `data.kind`), con ejemplos válidos (≥1 por variante, IDs y nombres sintéticos, sin identidades de pilotos) y sus entradas en `manifest.json`; `app/src/contracts/generated/*` regenerado con `npm run contracts:generate`; **GH-INTEROP-1.9** cita el esquema como forma canónica ejecutable.
2. **E-01** en INTEROP §6.5: `ExperimentResultsResponse` documenta `targetId` (el DTO no cambia).
3. **SYSTEM-2.15**: `system-contract.md:287` sin la identidad `tjc-piloto-ventas` ni el número de PR.
4. **Ejemplo `sandbox-result.failed.json`**: `code` pasa de `COMPOSER_INSTALL_FAILED` (no existe en el código) a `DEPENDENCY_INSTALL_FAILED`.
5. **INTEROP-2.20**, **GH-INTEROP-1.9** y **SYSTEM-2.15** (cabeceras, `spec/README.md`, `CHANGELOG.md`), todos `breaking: false`.
6. **Pruebas de frontera** de CT-01 en Core (`app/src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts`): ejemplos válidos pasan el esquema y `parseNormalizedWebhookEvent` (round-trip); inválidos fallan en ambos; paridad esquema↔parser con las brechas conocidas declaradas.
7. **Contract Sync** a Integration, Sandbox y Console (eventos `C-PENDING` en el `outbox/` de Core). Core no edita otros repos; cross los entrega e importa.

## Decisiones de diseño del leader (dentro de lo aprobado; propuestas del sdd-analyst, `wi-core-079-sdd-analysis.md`)

| # | Punto | Se adopta | Por qué |
|---|---|---|---|
| A-1 | Cadenas vacías en `title`, `ref`, `sha` (Core las acepta; Integration las rechaza) | Esquema **igual al parser** (sin `minLength` en esos campos); la brecha se declara | No cambia el comportamiento de Core en una ronda de contrato; lo más estricto exigiría tocar el parser |
| A-2 | Tope de 100 caracteres de `action` (Integration no lo valida) | El esquema declara `maxLength 100`; en Contract Sync es una acción **informativa** para Integration | El usuario aprobó el esquema, no un cambio de comportamiento de Integration |
| A-3 | Sustituir tipos manuales de Core por los generados | **No**; `parseNormalizedWebhookEvent` y `NormalizedWebhookEvent` no se tocan | Cambio de producción sin beneficio en este corte |
| A-4 | Menciones de `sistema-ventas-dn`/`validacion-*` en `spec/features/019` | **Fuera de alcance** (no son contrato ni pilotos del experimento) | Lo decide el usuario si lo quiere |
| A-5 | Un evento de Contract Sync por consumidor | **Tres eventos** (Integration, Sandbox sin `github-integration-contract.md`, Console) | `scopePaths` y `requiredAction` exactos; corrige E-02 |

Forma del esquema: `oneOf` a nivel de sobre (9 sobres) para expresar también la coherencia `eventName`↔`kind`; si el generador (`json-schema-to-typescript`) no la soporta, el implementer vuelve al sobre único con `oneOf` solo sobre `data`, documenta esa brecha y mantiene la prueba de paridad.

## Fuera de alcance

- `oracleRef` o cualquier campo de oráculo en `ExperimentRun` (decidido: no).
- Cambios en `normalized-webhook-event.ts`, DTOs, rutas, enums o comportamiento de Core; migraciones.
- Edición de Integration, Sandbox, Console, tesis, Full Paper o `AGENTS.md`; push, PR, merge, tag.
- Que Integration valide lo que emite (su WI propio, por Contract Sync).

## Acciones que quedan para los consumidores (Contract Sync, vía cross)

Re-espejar contratos y `schemas/` byte a byte y ejecutar `contracts:generate` + `contracts:check` (el nuevo `.schema.json` cambia sus `generated/`, así que **no** es «sin cambio de código»); Integration además valida lo que emite contra el esquema (CT-01-A5, su mitad).

## Riesgos y desconocidos declarados

Salida del generador con `oneOf`/`not` (se prueba primero); estado de `CS-CORE-20261021-003/004` en los consumidores (lo sabe cross; conviene que estén resueltos antes de publicar 2.20); si Console ya usa `targetId`; `node` está en `/Users/cjcarlosgc/.local/node22/bin` y no en el `PATH` por defecto.
