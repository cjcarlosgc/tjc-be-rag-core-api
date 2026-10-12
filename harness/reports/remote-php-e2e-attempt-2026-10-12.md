# Intento único de E2E PHP Core → Sandbox

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

**Fecha:** 2026-10-12. **Estado:** intento completado sin ejecución aceptada; no es un E2E exitoso.

## Alcance y precondiciones

- Autorización humana directa en el chat Cross: «Aprobar y ejecutar 1 E2E». Alcance aplicado: una sola ejecución sobre la VM existente, sin infraestructura nueva, cambios de firewall, pull, rebuild ni deploy.
- Core `feature/jean`, SHA `c64ae2e0db7c3a73b254aaf1efec244b37ae71b1`. `pnpm run build` — PASS.
- El túnel local `127.0.0.1:3001` respondió `200` a `/health/live` y `/health/ready` inmediatamente antes del request. La verificación fue por el túnel IAP; no se leyó configuración sensible.
- El bucket de Storage ya existía y la configuración requerida validó sin imprimir valores.
- La VM Sandbox había reportado checkout `e217bd10a8e32f98a2b16ba8c90bfbc6a8cfe351`; el workload se inició desde el `dist/main.js` existente. No hay revisión OCI y el hash del archivo `dist/main.js` en la VM no se verificó; el SHA anterior se registra solo como revisión del checkout reportada, no como SHA probado del binario.

## Request y resultado observados

Core invocó una sola vez `SandboxExecutionService.execute()` con el perfil `PHP_LARAVEL_PHPUNIT`, runner `PHPUNIT`, `projectRoot: "."` y un snapshot efímero propio que contenía un proyecto PHP/PHPUnit de demo. Se aplicó una guarda de proceso que impide un segundo `POST /executions`.

| Dato | Resultado |
| --- | --- |
| `requestId` | `c60a26d3-3cde-40d0-85de-8a826e834b3a` |
| `executionId` | No recibido |
| `POST /executions` | Exactamente 1; HTTP `401` |
| Estado | No aceptado; no hay resultado PHPUnit ni E2E exitoso |
| Health live / ready | `200` / `200` |
| SHA-256 del snapshot demo | `5933e8ff6d400c17c435e8d578bdafc827edf034e6406c2bfd0d5007bcc536c7` |
| Limpieza del objeto demo | Eliminado de Storage después del rechazo `401` |

No se imprimieron ni persistieron el token, las URLs firmadas o el cuerpo de error. La causa concreta del `401` no se atribuye sin inspección; no se reintentó el POST. El resultado y el requestId se comunicaron a la sesión Sandbox para anexarlos a `WI-SANDBOX-004`, que permanece activo y no se declara cerrado.

## WIs Core planificados revisados

- `WI-CORE-004` sigue `W-PLANNED`, P2. Corresponde a formalizar OC01–OC15 empezando por happy paths; su dependencia local `WI-CORE-001` está `W-DONE`. No tiene aprobación registrada y no es necesario para este smoke, así que no se seleccionó.
- `WI-CORE-008` sigue `W-PLANNED`, P2, con `contractImpact` y `publishesContract` verdaderos. `ST-CORE-008` cubre verificación de roles/aislamiento, Contract Sync y precondiciones de despliegue organizacional; no habilita este E2E ni autoriza operaciones externas. No se seleccionó.

No se cambió código, estado del Harness, contrato ni infraestructura en este corte; únicamente se agregó este reporte de evidencia. No se reabrió `WI-CORE-043` ni se creó/cerró otro WI Core.
