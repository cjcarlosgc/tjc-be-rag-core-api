# WI-CORE-026 — Revision contractual GH-INTEROP (DEC-TRACE-001)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

## Veredicto
- Texto de lineas 53 y 124 de `spec/contracts/github-integration-contract.md`: CONFORME y consistente entre si (tabla de operaciones y DTO). Sin correcciones de texto necesarias.
- Aditivo / `breaking=false`: SI para el contrato. El unico consumidor es Core, que tolera `200 {checkId}` y `204` (checkId null); request, errores y autenticacion no cambian. Matiz: pasar de 204 a 200 con cuerpo no es aditivo para un cliente estricto que exija 204, por eso la tolerancia de Core en la transicion es obligatoria (ya esta escrita).
- Bump de version: SI corresponde `GH-INTEROP-1.3`. Precedente directo: `WI-CORE-014` agrego `createdAt` (aditivo) y subio 1.1 a 1.2; no se uso solo nota de estado. Las notas de estado se reservaron a cierres sin cambio de semantica (p. ej. `WI-CORE-015`). Se recomienda bump menor (1.2 a 1.3), breaking=false.
- Otras menciones de la respuesta del endpoint de checks: ninguna inconsistente. `system-contract`, `interoperability-contract` y features no describen el 204 de checks; `interoperability-contract.md:1160` (`checkId: string | null` en `/trace`) es el consumidor ya alineado; `011-context-traces/plan.md:56` coincide.

## Ediciones exactas para el bump (no aplicadas)
En `spec/contracts/github-integration-contract.md`:
1. Linea 1: `GH-INTEROP-1.2` -> `GH-INTEROP-1.3`.
2. Linea 3 (Estado): anadir que `GH-INTEROP-1.3` (`WI-CORE-026`, `DEC-TRACE-001`) agrega `checkId` en `POST /checks`; Core lo consume tolerando `204`; implementacion GitHub Integration y espejos pendientes (CS-GH); sin despliegue/cutover. Conservar el texto de 1.2 como historia cerrada.
3. Linea 254 (migracion): `GH-INTEROP-1.2 anade ...` -> mencionar que `GH-INTEROP-1.3` anade `checkId` a la respuesta de Check.
Referencias a actualizar a `GH-INTEROP-1.3` (vigente): `spec/README.md:36`, `spec/contracts/system-contract.md` lineas 8, 34, 412, `spec/contracts/interoperability-contract.md:9` (verificar cada una: si describen la fecha del PR como historia de 1.2, dejar 1.2 y anadir 1.3). `CHANGELOG.md`: entrada `WI-CORE-026 — GH-INTEROP-1.3`. Espejos Console/GH: los actualizan sus sesiones via CS (byte por byte). SYSTEM-* e INTEROP-* conservan versionado independiente (sin bump).

## Evento CS propuesto (NO publicado)
- id: `CS-CORE-<YYYYMMDD>-<NNN>` (siguiente libre), origen Core, `sourceWorkItem: WI-CORE-026`, destino: `tjc-be-github-integration-api`.
- changed: `GH-INTEROP-1.3`: `POST /internal/v1/github/checks` pasa de `204` sin cuerpo a `200 { checkId: string }` (id del check run de GitHub como texto) al crear o actualizar; si el Check ya existe para ese `headSha` y nombre, devuelve el mismo id. Core tolera `204` (checkId null) durante la transicion. Request, errores y autenticacion sin cambio. breaking=false.
- requiredAction: importar y acusar este evento; actualizar su contrato y espejo de GH-INTEROP-1.3 (byte por byte con el original de Core); implementar la respuesta `200 { checkId }`; probar (crear, actualizar con el mismo id, errores sin cambio); y avisar con un `CS-GH-...` para que Core persista el id. Nada mas debe cambiar.
