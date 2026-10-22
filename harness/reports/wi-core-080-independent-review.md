# WI-CORE-080 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Veredicto: **CHANGES_REQUESTED** (correcciones menores de exactitud en el entregable; no hay bloqueos ni decisiones abiertas).

## Qué se verificó

| Punto | Resultado |
|---|---|
| 1. Filas C-01…C-10 vs Anexo E (tesis l.2217-2226, Tabla 52) | OK. Ids, nombres, responsabilidades y CT-0x coinciden. Citas ≤ 15 palabras, truncadas sin alterar sentido. Anexo G (Tablas 54-56), IOE1.1 100 % (l.533), IOE1.3/ESC-MOD-01 (Tabla 55: M1=0, M2=0, M3=100 %, frontera `app/src/providers`, embeddings fuera), HITO-OE1 (Tabla 56, tag `arch-v1.0`), l.1478 y «la tesis no define pasos de CT» (solo l.1070/1200/1478 los mencionan sin pasos) existen tal cual. |
| 2. Rutas de prueba | Todas existen (Core, Sandbox, Integration, Console) salvo la de C-02 (ver F-1). `describe`/`it` citados existen. C-06/C-07 verificados al 100 % (Core: contract, service, resilience, map-sandbox-result, evidence-facts, contract-validator; Sandbox: `executions.contract-real.spec.ts` con describes `C-06`/`C-07`, `core-client.contract.spec.ts`, `executions.contract.spec.ts`). Al menos 3 pruebas por cada otro contrato leídas. |
| 4. Dueños | Coherentes (C-01 Integration normaliza/entrega; C-06/C-07 Sandbox; Console solo consume). |
| 5. Cifras | «6 `*.pg.spec.ts`» y «104 omitidos» confirmados: ejecuté `vitest run` sobre los 6 archivos sin URL de BD: 6 skipped, 104 tests skipped. La lista de los 6 es exacta. `spec/contracts/schemas/` solo tiene common, error-envelope, realtime y sandbox-execution: confirmado. |
| 6. Alcance | `git diff 3f9aaf6~1..HEAD --stat`: solo `harness/reports/*`, `harness/state.json`, `harness/work-items.json` y `spec/.../017-.../tasks.md`. No toca `app/`, contratos, esquemas ni `referencias/`. Sin IOE inventados ni corridas oficiales. |
| Validadores | `sdd-check` OK; `validate-work-items` OK (80 WI); `validate-harness` OK; `validate-completions` OK (76). |

## Correcciones solicitadas

### F-1 (baja) — fila C-02, ruta de prueba inexistente
`src/inventory/test-target-extractor.service.spec.ts` no existe. Debe decir `src/project-versions/inventory/test-target-extractor.service.spec.ts` (existe).

### F-2 (media) — fila C-05, cita que no cubre lo dicho
El reporte atribuye `context_id` a `src/context-traces/context-traces.service.spec.ts`; ese archivo tiene 0 apariciones de `context_id`/`contextId` (prueba la lectura/listado de trazas de contexto, no la identidad). `context_id` se verifica realmente en: `src/analysis-runs/persistence/analysis-trace.repository.pg.spec.ts` («links the context_id into a proposal…», «rejects a proposal that references a context_id that does not exist»), `src/analysis-runs/analysis-run-trace.service.spec.ts` (`contextId: 'context-a'`) y `src/evidence/evidence-bundle.assembler.spec.ts`. Debe decir: quitar «`context_id`» de la cita de `context-traces.service.spec.ts` (descríbela como «lectura de trazas de contexto») y añadir esas tres referencias. Además falta citar, como cobertura de «contexto trazable/auditable», `context-builder.service.spec.ts` «audits every candidate with the observed discard reason…».

### F-3 (media) — fila C-03 y C-05 y «Brechas de mayor valor» n.º 5, brecha sobrestimada
«`retrieval_id` + export/audit del ranking» y «`GenerationContextAudit` con `context_id`» se dan como sin cobertura de aserción. Sí hay aserciones de identidad: `analysis-run-trace.service.spec.ts` (`retrievalId: 'retrieval-a'`, `contextId: 'context-a'`), `analysis-trace.repository.pg.spec.ts` («keeps one retrieval and one context per target when the job retries») y `evidence-bundle.assembler.spec.ts`. Lo que sigue sin existir es una aserción a nivel de frontera Retriever→ContextBuilder (la salida de `RetrievalService`/`ContextBuilder.build` no devuelve ni se prueba con `retrieval_id`/`context_id`; se asignan en persistencia). Debe decir: «la identidad `retrieval_id`/`context_id` se prueba en trace/persistencia (citar archivos); no hay aserción en la frontera de los servicios `RetrievalService` y `ContextBuilder`», y ajustar la brecha 5 en consecuencia.

### F-4 (baja) — fila C-06, brecha parcialmente cubierta
«Sin secretos Git/FK … no se afirma explícitamente»: `sandbox-execution.service.spec.ts` tiene «never sends functional rules to Sandbox: the posted body has only the execution contract keys (WI-CORE-021)» (semántica RAG/FK ausente del body) y «never leaks the signed download URL into a thrown error message». Debe decir: «el body solo lleva las claves del contrato (sin reglas funcionales); no se afirma explícitamente ausencia de token/credenciales Git en el body». «Perfil no soportado»: no está cubierto en Core, pero sí en Sandbox (`executions.contract-real.spec.ts` T9); anotarlo en «Dueño/otro repo».

### F-5 (baja) — fila C-04, prueba nueva propuesta ya existe en parte
La brecha «403 de confirmación» está cubierta en `functional-knowledge.service.spec.ts` (`submitAnswer`: 403 `PROJECT_ROLE_INSUFFICIENT` para Reader/Writer, incluido `UNKNOWN`, antes de escribir; l.244-302, 372). Debe decir que lo pendiente es solo la aserción CT-04 única «reglas no ACTIVE/sin autoridad nunca llegan a `functionalRules`», no el 403.

### F-6 (baja) — fila C-08, brecha sobrestimada
«La checklist es sobre Runs reales, no unitaria» ignora `analysis-trace.repository.pg.spec.ts` «builds the INTEROP §6.16 chain from the persisted rows of a finished run» (cadena sobre filas reales en Postgres local, aunque con `*.pg`). La ausencia de comprobación inversa (resultado→PR/HEAD) sí es correcta (no hay prueba inversa en `analysis-runs/` ni `evidence/`). Debe mencionar esa prueba `*.pg` como cobertura directa parcial.

### F-7 (baja) — fila C-07, ambigüedad de dueño/cobertura
`test/full-pipeline.e2e-spec.ts` y `test/executions.e2e-spec.ts` del Sandbox no usan el cliente real de Core; solo `core-client.contract.spec.ts` lo hace (import dinámico, se omite si falta el repo hermano de Core: debe decirse, pues el estado «Cubierto» depende de que ambos repos estén juntos). Distinguir en la celda.

### F-8 (baja) — Nota (1), e2e de Core
Falta mencionar `test/access-webhooks.e2e-spec.ts` (ingreso por el receptor interno con bearer, eventos de acceso/repositorio): es un e2e en la frontera C-01 aunque no cruza PR→AnalysisRun; la conclusión «ningún e2e cruza C-01…C-08» sigue valiendo, pero la lista de e2e existentes debe incluirlo.

### F-9 (baja, opcional) — C-09 / ESC-MOD-01
`spec/transversal/providers/spec.md` §«ESC-MOD-01 — paridad de `LLMProvider`» (implementación pendiente) y `tasks.md` ST-CORE-030 ya definen el escenario en Core; citarlos en C-09 y en «Incoherencias». Nota de matiz: sí existen dobles de `LLMProvider` en pruebas (`generalist-agent.service.spec.ts`, `experiments*.spec.ts`), pero no una suite de contrato; «sin segundo adapter» es correcto.

## Lo que no se encontró
- Brechas «sin cobertura» ocultas en C-01, C-02, C-09, C-10 (webhook, persistence/pg, LLMProvider, sandbox revisados por palabras clave en `app/src` y `app/test`).
- Coberturas declaradas más débiles de lo dicho por ser solo mocks: el reporte ya marca los `*.pg` como no corridos localmente y C-06/C-07 como «con contrato real» (correcto para la parte de Sandbox).
- Incoherencias tesis↔código señaladas (webhook GitHub recibido por Integration y evento interno con bearer en Core; Prisma/SQL directo sin puertos relacionales/vectoriales; frontera ESC-MOD vs `src/experiments`): existen y son exactas.

## Siguiente paso
El sdd-analyst aplica F-1…F-8 (F-9 opcional) solo en `harness/reports/arch-v1.0-inventario-contratos-core.md`; luego ciclo 2 de revisión (verificación puntual de esas filas). No hace falta tocar `app/`, `state.json` ni la tesis.

## Ciclo 2 de 2
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Veredicto final: **APPROVED**.

- F-1…F-9 aplicadas y ciertas: la ruta completa de `test-target-extractor.service.spec.ts` existe; `context_id` y `retrieval_id` ya se atribuyen a trace/persistencia/evidence (verificado en ciclo 1); `core-client.contract.spec.ts` usa `describe.skipIf(!CORE_AVAILABLE)` en `CT-06 Core (cliente real) → Sandbox` (l.243) y `CT-07 Sandbox → Core (cliente real)` (l.337), con import dinámico; T9 del Sandbox existe (`executions.contract-real.spec.ts` l.89); ST-CORE-030 existe en `spec/transversal/providers/tasks.md`; dobles de `LLMProvider` presentes en `generalist-agent.service.spec.ts` y `experiments*.spec.ts`.
- Sin afirmaciones nuevas falsas en C-02…C-09, nota 1 ni Resumen. La etiqueta de C-07 «Cubierto, solo si Core y Sandbox están juntos» es correcta (describe CT-07 con cliente real se omite sin el repo de Core).
- Observaciones no bloqueantes: (a) C-06 conserva «Cubierto (con contrato real)» sin la misma salvedad, aunque su describe CT-06 con cliente real también se omite sin Core (el contrato HTTP del Sandbox sí corre solo); (b) en C-05, `context-builder.service.spec.ts` aparece citado dos veces. Pueden ajustarse opcionalmente.
- Alcance: `git status` muestra solo el entregable modificado y este informe nuevo; `git diff 3f9aaf6~1..HEAD --stat` sin cambios fuera de `harness/` y `spec/features/017-.../tasks.md`. No toca `app/`, contratos ni `referencias/`.
- Validadores: `sdd-check` OK; work-items OK (80 WI); harness OK; completions OK (76).
