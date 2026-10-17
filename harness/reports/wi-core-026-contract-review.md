# WI-CORE-026 — Revisión de contrato
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Fecha: 2026-10-09. Solo lectura salvo este reporte. Fuentes: INTEROP-2.7 §6.16 y §6.13, `wi-core-026-sdd-verification.md`, `plan.md` de 011 (detalle técnico), `analysis-runs.controller.ts`, `schema.prisma` (TestPublication).

## Veredicto: APPROVED para cortes A, B y C con la reserva DECISION_REQUIRED acotada a `publication.checkId`/`freshness` (DEC-TRACE-001/002, abiertas)

Ningún corte A-C exige cambio de contrato si `publication` se emite con `checkId=null` y `freshness` provisional. Los cambios de contrato aparecen solo en el corte D.

## 1. Conformidad del diseño con §6.16

- Corte A: conforme. `retrieval_id`/`context_id` son los únicos IDs nuevos que §6.16 permite; `functionalRuleIds` ya es campo de `context`. `UNIQUE(analysisRunId, analysisSymbolId)` con upsert es compatible. El bloque de reglas en el `ContextTrace` experimental sin procedencia ni texto no cambia §6.7 porque el mapeo de `ContextTracesService` es explícito (verificado en el reporte SDD, hallazgo 6).
- Corte B: conforme. `executionId` es el del Sandbox (§6.16 "reutiliza el execution_id"). `outcome` debe ser la clasificación técnica "ya expuesta en el Run": el implementer debe reutilizar el mismo valor/enum que el Run, sin inventar uno nuevo. Capturar `executionId` también en el error de ejecución aceptada es aditivo y no toca el contrato Core-Sandbox (§7).
- Corte C: conforme con matices a fijar en pruebas:
  - Reader mínimo, 404 por el guard (patrón existente en `getById`).
  - `403 PROJECT_ROLE_INSUFFICIENT` es inalcanzable en `/trace`: Reader es el rol mínimo, así que todo usuario con visibilidad lo satisface. §6.16 lo menciona solo para evidence en general. La prueba "403" debe usar el rol/guard solo si existe un escenario real (p. ej. registro de acceso inexistente no es 403 sino 404); si no, documentar que no aplica. Recomendación: la prueba de autorización cubre 200 (Reader o superior) y 404 (no visible/inexistente); el 403 se cubre a nivel del guard con un metadato `@RequireProjectRole` verificado, no con un caso HTTP.
  - `409 EVIDENCE_NOT_FINISHED` en QUEUED/PROCESSING. El código solo existe en §6.16; no está en el catálogo de errores de §4. Registrarlo como código de dominio nuevo del módulo (no es cambio de contrato, ya está especificado).
  - `NOT_APPLICABLE` por enlace y `changeset.NOT_APPLICABLE` con `targetCount: 0`: conforme. Aclarar en el plan que un target con retrieval pero sin ejecución (p. ej. `ACTION_REQUIRED`) tiene `executions.status=NOT_APPLICABLE` con `items: []`, y que `generation.proposalIds` es `[]`.
  - Orden determinista de `targets` y `executions`: §6.16 no lo fija. Proponer orden por posición del símbolo y por `attempt` ascendente; es detalle no contractual, documentarlo.
  - `publication` con `checkId`/`companionBranch`/etc. en `null`: la forma lo permite. Pero con DEC-002 abierta no cerrar `publication.status`: ver sección 4.

## 2. No exponer conteos, omitidas ni `knowledgeId` en el trace público

Compatible. §6.16 `AnalysisRunTraceResponse` solo incluye `functionalRuleIds` en `context`; los conteos (`retrieved/selected/omitted`), las omitidas y su motivo son interiores a la obligación de 021 (auditoría persistida) y no están en trace ni en `EvidenceBundleResponse.context` (que tiene `tokenCounts` y `functionalRuleIds`). `functionalRuleIds` ya son `knowledgeId`; lo que no se expone son las omitidas.
Si se expusieran: (a) enmendar §6.16 (`context` del trace y/o del bundle) y subir la versión INTEROP o una enmienda de 2.7; (b) Contract Sync a Console (`WI-CONSOLE-016/017` consumen estos DTO); (c) decidir si las omitidas revelan `knowledgeId` de reglas que el usuario con rol Reader no debería inferir (procedencia/confidencialidad); (d) ampliar WI-CORE-027 (bundle) para mantener coherencia entre trace y evidence. Recomendación: no exponer ahora; el WI declara "sin impacto adicional porque los datos persistidos son auditoría interna". Si 027 los necesita, enmendar entonces.

## 3. "Matriz de roles de §6.16 pendiente"

No hay decisión ni redacción pendiente sobre quién accede: la matriz de §6.13 ya lista `GET /analysis-runs/{id}/trace`, `/evidence` de AnalysisRun, de experimento y `retrieval-comparisons/.../evidence` en la fila Reader. Lo pendiente es solo texto de estado, a actualizar al implementar:
- §6.16 encabezado: "Definido en INTEROP-2.7, pendiente de implementar y verificar" pasa a "implementado en Core (`WI-CORE-026` para `/trace`)", manteniendo `/evidence` pendiente de `WI-CORE-027`.
- Cabecera de versión (línea 14) y nota final (línea ~1377: "6.16 ... pendiente de implementar") para reflejar el estado.
- §6.13 "Estado de implementación (INTEROP-2.7)" puede añadir `/trace`.
Es estado, no decisión. Una prueba de autorización (200 Reader+, 404 no visible, y verificación del metadato de rol; ver 403 arriba) la cubre.

## 4. DEC-TRACE-001 y DEC-TRACE-002 (abiertas; no decididas)

### DEC-TRACE-001 — `checkId`
Impacto: `GH-INTEROP` (`POST /internal/v1/github/checks`) responde hoy `204`; `createCheckRun` devuelve `void`. Obtener `checkId` exige cambiar la respuesta a `200 { checkId }`: cambio de contrato en otro componente (GitHub Integration) y de `github-integration-contract.md`. Requiere (i) confirmación explícita del usuario, (ii) handoff compacto al agente de GitHub Integration (no corregir su repo), (iii) compatibilidad: Core debe tolerar `204` durante la transición (`checkId=null`), (iv) nueva columna nullable en Core (no hay Check por Run persistido), (v) versionar `GH-INTEROP` (p. ej. 1.3) y registrar en CHANGELOG.
Opciones:
- A (recomendada): enmendar GH-INTEROP a `200 { checkId: string }`, aditivo respecto del cuerpo vacío (los consumidores que ignoran cuerpo no rompen), Core persiste `checkId` en una columna nullable; mientras no esté, `checkId=null`.
- B: `checkId` siempre `null` y retirar el campo del criterio de aceptación del WI (§6.16 mantiene `string | null`, es válido); requiere que el usuario acepte el criterio 2 reducido.
- C: Core consulta a GitHub por nombre/HEAD del check (requiere nuevo endpoint GH-INTEROP: más costo; no recomendada).
Redacción propuesta para GH-INTEROP: "`POST /checks` → `200 { checkId: string }` (id del Check Run creado). Un `204` sin cuerpo sigue siendo aceptable para consumidores antiguos hasta GH-INTEROP-1.3; Core trata la ausencia de cuerpo como `checkId = null`."

### DEC-TRACE-002 — semántica de `publication`
Problema: §6.16 mezcla `checkId` (independiente de `TestPublication`) con campos de `TestPublication`, y `TestPublicationStatus` tiene seis valores frente a `freshness` de dos. `TraceLinkStatus` solo admite `PRESENT | NOT_APPLICABLE`.
Opciones:
- A (recomendada): `status=PRESENT` si existe Check persistido o alguna `TestPublication` del Run; `NOT_APPLICABLE` si no hay ninguno. Con `TestPublication` elegir la más reciente por `createdAt` (empate por `id`). `freshness`: `CURRENT` solo con `PUBLISHED`; `STALE` con `STALE`; `null` en `PENDING`, `PUBLISHING`, `FAILED`, `CLOSED` y sin `TestPublication`. `companionBranch=branchName`, `companionPullRequestUrl`, `sourceHeadSha` copiados de la fila; `null` si solo hay Check.
- B: `PRESENT` solo si hay `TestPublication` en `PUBLISHED`/`STALE`; el `checkId` se reporta aparte y se pierde si no hay publicación (contradice la agrupación de §6.16).
- C: ampliar `freshness` a más valores o `status` con `PENDING/FAILED`: cambio de contrato visible para Console; no recomendada.
Redacción propuesta para §6.16: "`publication.status` es `PRESENT` si el Run tiene un Check publicado o una `TestPublication`; en otro caso `NOT_APPLICABLE`. Con varias `TestPublication` rige la más reciente por `createdAt`. `freshness` es `CURRENT` si su estado es `PUBLISHED`, `STALE` si es `STALE` y `null` en cualquier otro caso (sin publicación, `PENDING`, `PUBLISHING`, `FAILED`, `CLOSED`)."
Mientras estén abiertas: el corte C puede entregar `publication` con `checkId=null` y `status/freshness` provisionales marcados en el WI como sujetos a DEC-TRACE-002; no cerrar ese criterio ni declarar el WI terminado hasta decidir. `CLOSED` merece atención del usuario: cerrada ¿es `STALE` o `null`? (propuesta: `null`).

## 5. Cambios propuestos en INTEROP al cerrar (NO editados)

1. §6.16: estado "implementado en Core (`WI-CORE-026`)" para `/trace` y nota de que los enlaces sin fila en un Run terminal constan `NOT_APPLICABLE`.
2. Aclaraciones: orden determinista de `targets`/`executions`; `outcome` reutiliza la clasificación del Run; `403` no alcanzable en `/trace` por ser Reader el mínimo.
3. Texto de `publication` según DEC-TRACE-002 si se aprueba (A o la que el usuario elija) y `checkId` según DEC-TRACE-001.
4. Cabecera (línea 14) y nota final (~1377) de estado; §6.13 nota de implementación.
5. Solo si se exponen: conteos/omitidas en `context` (ver 2). Registrar `EVIDENCE_NOT_FINISHED` en la lista de errores si se desea catálogo único.
6. CHANGELOG; Contract Sync a Console solo si cambia forma (DEC-002 opción A no la cambia: solo semántica; DEC-001 afecta GH-INTEROP, no a Console).

## Handoff
`status`: APPROVED (cortes A, B, C) · `blockers`: DEC-TRACE-001, DEC-TRACE-002 solo para cerrar `publication`/`checkId` (corte D) · `recommendedNextStep`: implementar A, B y C; preguntar al usuario por DEC-001/002 y, si aprueba, emitir handoff compacto a GitHub Integration.
