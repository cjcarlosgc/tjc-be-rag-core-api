# WI-CORE-040 — verificación SDD

**Resultado:** `APPROVED` para avanzar con la fuente canónica y el corte documental.
**Fecha:** 2026-10-11
**Estado del WI al registrar:** `W-SELECTED`.

## Decisión y alcance

El usuario aprobó `DEC-CHECK-003`: GitHub Integration queda limitada contractualmente a una instancia/proceso activo por entorno; el mutex y el estado de coordinación son efímeros y locales; no se agrega PostgreSQL, tabla, URL, migración ni componente. Se acepta el riesgo residual de que, después de un reinicio, una búsqueda completa sin candidatos permita crear mientras un Check remoto anterior todavía no sea visible. `DEC-CHECK-002` queda supersedida. No cambia `INTEROP-2.8`, DTOs públicos, datos de dominio Core/Supabase, implementación `app/`, despliegue ni infraestructura.

El alcance local de Sandbox no cambia: permanece en SDD 2.1 y su espejo declara SYSTEM-2.2. Se corrigió únicamente la descripción factual en el contrato canónico de Core; no se editó el repositorio Sandbox ni se declaró homologación.

## Resolución de observaciones

La primera revisión SDD señaló que el resumen de endpoint todavía prometía convergencia durable, el catálogo de error retenía semántica PostgreSQL/`ABANDONED` y el resumen Core indicaba SYSTEM-2.4 para Sandbox. Se corrigieron esos puntos en `spec/contracts/github-integration-contract.md`, `spec/contracts/system-contract.md` y `spec/README.md`. La revisión posterior confirmó que las reglas de 409/422/503 y el riesgo de reinicio son coherentes; observó inicialmente un `activeWorkItem` incompleto y sin PULL `start`. Se alineó `syncScopePaths`, se ejecutó y registró el checkpoint inicial sin eventos relevantes pendientes, y los validadores pasan ahora.

## Validaciones

- `node scripts/sdd-check.mjs` — PASS.
- `node harness/validate-work-items.mjs` — PASS (40 WIs).
- `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-040 --record` — PASS; `relevantPendingSyncIds: []`.
- `node harness/validate-harness.mjs` — PASS después de completar el snapshot y registrar PULL `start`.
- `git diff --check` — PASS tras actualizar Harness, subtarea y estado activo.

## Handoff de análisis

`[sdd-analyst::GPT-6 Luna / high] · WI-CORE-040 · corte contractual` — la fuente/decisión está verificada, sin decisiones bloqueantes; la observación operativa del snapshot se resolvió y se confirma con la validación final del Harness. Modelo servido: `unknown`.
