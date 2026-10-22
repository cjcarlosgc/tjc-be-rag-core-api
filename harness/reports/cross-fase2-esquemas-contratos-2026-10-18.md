# Fase 2 — contratos como esquemas JSON (ejecutada desde la sesión cross)

Fecha: 2026-10-18. Ejecutada por la sesión cross por orden expresa del usuario (excepción puntual «desde cross»), sin WI: cambio transversal de contratos y harness. Commits en `feature/jean`, sin push.

## Qué cambia

- **Contratos canónicos (Core):** `SYSTEM-2.13` (editorial: redacta host/IP de la VM del Sandbox y declara que Sandbox espeja el contrato), `INTEROP-2.17` (error envelope con `retryable?`, §10 «Esquemas JSON canónicos», `phase` opcional con tolerancia transitoria) y `GH-INTEROP-1.8` (los errores de GitHub Integration usan el `ErrorEnvelope` completo). Espejados byte a byte en los cuatro repositorios.
- **Esquemas:** `spec/contracts/schemas/` (`common`, `error-envelope`, `sandbox-execution`) y ejemplos canónicos válidos en `examples/` con `manifest.json`. Es la fuente de las formas; la prosa define la semántica.
- **Código en cada backend:** tipos TypeScript generados desde los esquemas (`pnpm contracts:generate`; `pnpm contracts:check` falla si difieren), validador Ajv (`src/contracts/contract-validator.ts`) y tests de contrato que usan los mismos ejemplos.

## Decisiones tomadas al ejecutar

1. **`phase` queda opcional en el esquema.** El texto de INTEROP §7.2 lo daba por requerido, pero Core no lo envía a propósito (feature 018: «un Sandbox anterior lo rechazaría») y la brecha está documentada (feature 013, OC09). No se cambió el comportamiento de Core; se documentó la tolerancia. **Pendiente de confirmación del usuario.**
2. **Core no endurece su lectura de respuestas del Sandbox.** Mantiene sus parsers tolerantes con Sandboxes anteriores; la comparación con el esquema es solo un aviso en el log (`warnOnContractDrift`), sin lanzar ni incluir valores del payload.
3. **GitHub Integration emite el `ErrorEnvelope` completo** (`statusCode`, `details`, `timestamp`, `path` sin query string, además de `code`, `message`, `retryable`, `correlationId`). Es aditivo: Core solo lee `code` y `retryable` y Console ignora lo demás.
4. **Console** solo adopta el envelope (tipo generado y `ApiError.retryable`); sus ~130 tipos de respuesta de Core siguen a mano y se incorporan en un corte posterior.

## Desfases detectados y estado

| Hallazgo | Estado |
| --- | --- |
| Core no tenía `executionProfile` en `RunnerFacts` | Corregido: el tipo deriva del esquema; se actualizaron los fixtures de spec |
| `failureKind` opcional en Core y nullable obligatorio en Sandbox | Alineado al esquema (opcional y nullable); Sandbox lo emite siempre |
| `stage` de la evidencia: `string \| null` en Core, `SandboxStage` en el contrato | Sin cambio: Core conserva su tipo interno tolerante; el aviso detecta desvíos |
| Core no enviaba `phase` | Documentado como tolerancia transitoria (decisión 1) |
| `correlationId` podía salir `undefined` en el error de Core | Corregido: se genera uno si falta |

## Verificación

| Repo | lint | build | tests |
| --- | --- | --- | --- |
| Core | OK | OK | 2460 pasan, 104 omitidos |
| GitHub Integration | OK | OK | 192 pasan (antes 183) |
| Sandbox | OK | OK | 212 pasan, 4 omitidos (antes 203) |
| Console | OK | OK | 808 pasan, 1 falla (`RunsPage.test.tsx`, ya fallaba antes de este corte; antes 806 pasan) |

## Riesgos y orden de despliegue

- El envelope nuevo de GitHub Integration es aditivo; puede desplegarse antes o después de Core.
- Sandbox no cambia su comportamiento; Core tampoco. No hay orden obligatorio de despliegue.
- La instalación con pnpm 12 añadió sufijos de peer-dependencies en los lockfiles (formato `9.0` intacto).

## Pendiente

- Aplicar `pnpm contracts:check` en CI (Fase 3).
- Esquemas para Core↔GitHub Integration (incluidos webhooks) y para las respuestas Core→Console.
- Códigos genéricos para `HttpException` sin código en Core (hoy `INVALID_REQUEST` incluso para 403/404) y el 503 genérico de GitHub Integration para estados no mapeados: requieren ampliar el contrato (Fase 3).
