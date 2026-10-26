# Propuesta de aserciones CT-01…CT-10 para arch-v1.0 (WI-CORE-082)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

**Estado: PROPUESTA.** El usuario aprueba, modifica o descarta cada aserción. La tesis (Anexo E, Tabla 52) solo da por contrato la «Evidencia» y «Prueba: CT-0x»; no define pasos de CT. Fuentes: fila del Anexo E, `harness/reports/arch-v1.0-inventario-contratos-core.md` (WI-CORE-080), contratos de `spec/contracts/`. Las pruebas citadas como existentes salen del inventario WI-CORE-080 (nombres verificados por grep allí; en esta pasada re-verifiqué los de `retrieval.service.spec.ts`, `context-builder.service.spec.ts`, `map-sandbox-result.spec.ts` y `openai-llm.provider.spec.ts`). Rutas desde `app/`.

**Estado vigente (2026-10-25):** las columnas «Existente» y «Falta» de las tablas de cada C-NN reflejan el inventario del WI-CORE-082; el estado actual de cada aserción (cubierta, con Postgres, declarada, manual, externa o posterior), su prueba y su comando están en `harness/reports/arch-v1.0-ct-evidencia-mapa.md` y en la tabla resumen de esta propuesta.

**Qué exige la tesis para el tag (Anexo G):** Tabla 56: «Evidencia mínima: CT/checklist, ADR-01–10, ESC-MOD-01, trace y acta». Tabla 54: checklist de 9 enlaces, comprobación directa e inversa por AnalysisRun, CUMPLE/NO CUMPLE/N/A justificado, IOE1.1 = 100% (la meta se mide sobre Runs reales; no se genera aquí). Tabla 55: ESC-MOD-01 M1=0, M2=0, M3=100%. La Tabla 54 sí tiene columna Evidence ID para el checklist; para CT-01…CT-10 la tesis no dice dónde se registra la evidencia (resuelto por el usuario: ver «Decisiones tomadas por el usuario»).

**Criterio de conteo:** cubierta = existe prueba y la columna Falta dice «ninguno»; parcial = existe prueba que cubre solo parte de lo afirmado; sin cobertura = ninguna prueba. Leyenda: Auto = automatizable con vitest / e2e / `*.pg.spec`; Man = checklist/manual. Esfuerzo de lo que falta S/M/L. «Parte» = campo de la fila de la que se deriva (E entrada, S salida, Pre, Post, Err).

---

## C-01 — Git Integration → Run Orchestrator (CT-01)
Cita: «fijar repositorio/PR/HEAD»; «evento no elegible, permisos insuficientes, duplicado».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-01-A1 | Dado un evento interno con bearer de servicio válido y payload canónico de Integration, cuando Core lo recibe, entonces crea/actualiza un AnalysisRun con repo, PR y HEAD idénticos al payload | E, S, Post | Core | Parcial: `src/analysis-runs/analysis-runs.service.spec.ts` («startRunFromWebhook»); no encadena payload canónico | M | Auto |
| CT-01-A2 | Dado un bearer inválido, cuando llega el evento, entonces 401 y no se crea Run; sin credencial configurada, 503 | E, Err | Core | `src/github-webhooks/github-webhooks.controller.spec.ts` («Core internal GitHub webhook receiver») | ninguno | Auto |
| CT-01-A3 | Dado un segundo evento con el mismo repo/PR/HEAD, entonces 200 sin Run nuevo (duplicado) y 202 el primero | Err | Core | controller.spec (202 nuevo, 200 duplicado); `analysis-runs.service.spec.ts` (redelivery mismo HEAD) | ninguno | Auto |
| CT-01-A4 | Dado un evento no elegible o de instalación sin permisos, entonces no se crea Run y el estado queda indicado | Pre, Err | Core | `github-webhooks.service.spec.ts` (instalación, repository events) piezas sueltas | S (nombrar como CT) | Auto |
| CT-01-A5 | El payload que Integration emite (saneado, sin secretos) valida contra el ejemplo canónico que Core consume | S, Evidencia | Integration (`app/src/github-webhooks/github-webhook-normalizer.spec.ts`, `github-webhook-core-client.spec.ts`) | Existen specs de normalizer y cliente; sin schema/ejemplo compartido en `spec/contracts/schemas/` | M (esquema canónico + ejemplo validado en Core e Integration + Contract Sync a Integration; D-2) | Auto |

Frontera entre dos repositorios (Git Integration → Core): la tesis ya los trata como componentes separados (el tag exige SHA de Git Integration). **D-2 decidida:** dos mitades (Integration: webhook de GitHub a evento; Core: evento autenticado a AnalysisRun) más un esquema JSON canónico del payload en `spec/contracts/schemas/` con ejemplo validado por ambos repos; sin prueba extremo a extremo entre repos.

## C-02 — Run Orchestrator → Repository Intelligence / Analysis (CT-02)
Cita: «alcance de validación separado de actualización del índice».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-02-A1 | Dado un Run fijado a HEAD vigente, cuando se analiza, entonces se persiste el snapshot de ese HEAD | E, Pre | Core | `src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts` («snapshot persistence»); `analysis-runs.service.spec.ts` («recordSnapshot») | ninguno | Auto |
| CT-02-A2 | **Reformulada (D-19, 2026-10-25):** los archivos del CHANGESET salen de PR base↔HEAD; los símbolos `DIRECTLY_CHANGED` se deciden comparando cada chunk del HEAD con la versión indexada previa del Project (INCREMENTAL) o, sin versión previa, son todos los símbolos de los archivos cambiados (BOOTSTRAP); un Project nuevo por caso aísla el historial | S, Post | Core | `snapshot-analysis-job.handler.spec.ts` («bootstraps when there is no previous ProjectVersion for the project», «reports every symbol in a changed file as DIRECTLY_CHANGED during BOOTSTRAP», «only reports a symbol as DIRECTLY_CHANGED (INCREMENTAL) when its content actually differs from the previous version») | ninguno; la forma estricta original (el cambio del INDEX DELTA no altera los targets) se declara NO CUMPLE: limitación documentada (G-05(b)) | Auto |
| CT-02-A3 | Dado un HEAD obsoleto, el Run pasa a obsoleto y no actualiza índice ni genera targets | Err | Core | `analysis-runs.service.spec.ts` («obsoleteRun»); handler parcial | S | Auto |
| CT-02-A4 | Un target no resoluble queda como estado explícito, sin abortar el resto | Err | Core | ninguna: `src/project-versions/inventory/test-target-extractor.service.spec.ts` solo prueba exportados/no exportados; `UNRESOLVABLE_TARGET` lo lanza `RetrievalService` (CT-03-A1), no el análisis | M (aclarar antes dónde ocurre el estado explícito) | Auto |

Nota: «CHANGESET», «INDEX DELTA» y «instrucciones de indexación» no tienen schema en `spec/contracts/schemas/`. **D-3 decidida:** el formato canónico es el del contrato de interoperabilidad vigente; no se crea schema nuevo antes del tag.

## C-03 — Retriever → Context Builder (CT-03)
Cita: «ranking auditable dentro de límites».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-03-A1 | Dado un target sin chunk, entonces `UNRESOLVABLE_TARGET` (modos SE y SEM) | Err | Core | `retrieval.service.spec.ts` («throws UNRESOLVABLE_TARGET…»; «SEM still throws UNRESOLVABLE_TARGET…») | ninguno | Auto |
| CT-03-A2 | En modo SE el resultado combina señales semántica+estructural en una entrada por candidato; en SEM solo semánticos sin match estructural | E, S | Core | «merges a candidate found by both…», «SEM returns only semantic candidates…», «uses SE when no mode is given…» | ninguno | Auto |
| CT-03-A3 | El conjunto vacío es un resultado explícito (lista vacía, sin excepción) y no rompe el flujo | Err | Core | ninguna en frontera | S | Auto |
| CT-03-A4 | Los candidatos que entrega `RetrievalService` vienen con score y orden determinista (el recorte por topK/minimumScore es de C-05, ver CT-05-A2) | S, Post | Core | ninguna en `retrieval.service.spec.ts` (el ranking ponderado se prueba en `context-builder.service.spec.ts`, frontera C-05) | S (coherente con D-4) | Auto |
| CT-03-A5 | Cada retrieval queda con `retrieval_id` consultable en el audit | S, Evidencia | Core | `analysis-trace.repository.pg.spec.ts` («keeps one retrieval and one context per target when the job retries»); sin aserción en `RetrievalService` | M (el id se asigna en persistencia) | Auto (pg) |
| CT-03-A6 | La búsqueda vectorial real devuelve candidatos con pgvector | Dep | Core | ninguna conocida (`*.pg`) | L | Auto (pg) |

## C-04 — Functional Knowledge Service → Context Builder / Orchestrator (CT-04)
Cita: «solo conocimiento autorizado/vigente se utiliza».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-04-A1 | Dado un proyecto+target, el retriever consulta solo reglas ACTIVE por `targetRef` exacto y mapea la procedencia | E, S | Core | `src/retrieval/functional-rules.retriever.spec.ts` («queries ACTIVE rules by exact targetRef…») | ninguno | Auto |
| CT-04-A2 | **Reformulada (D-18, 2026-10-25):** una regla no ACTIVE (p. ej. SUPERSEDED) nunca llega a `functionalRules` del contexto; en los Projects oficiales no existen reglas sin procedencia (toda regla nace de `submitAnswer` con `confirmedByUserId`), por lo que no se filtra por procedencia (las reglas históricas sin procedencia siguen ACTIVE por INTEROP-2.7) | Post | Core | `functional-rules.retriever.spec.ts` y `functional-knowledge.repository.spec.ts` (filtro ACTIVE); aserción única en `app/src/ct/` | ninguno tras el WI-CORE-099 | Auto |
| CT-04-A3 | Confirmar sin rol suficiente (incluido UNKNOWN) devuelve 403 `PROJECT_ROLE_INSUFFICIENT` | Err, Pre | Core | `functional-knowledge.service.spec.ts` («submitAnswer») | ninguno | Auto |
| CT-04-A4 | Dada una regla requerida sin respuesta o con conflicto, el flujo se detiene con ACTION_REQUIRED y no genera con reglas supuestas | S, Err | Core | `listActionRequired`; `functional-context-evaluator.service.spec.ts`; `functional-continuation-job.handler.spec.ts` | S (nombrar frontera) | Auto |
| CT-04-A5 | Con Postgres/RLS, un usuario sin acceso al proyecto no lee ni confirma reglas **Alcance de la prueba (WI-CORE-099):** Core no usa RLS; la prueba pg cubre la lectura de reglas y la resolución del Project con `accessibleProject` contra SQL real; la confirmación sin rol suficiente se cubre en CT-04-A3 (sin pg). | Pre | Core | e2e de acceso generales (`access-matrix`); sin caso FK | M | Auto (e2e/pg) |

## C-05 — Context Builder → Test Generator (CT-05)
Cita: «contexto deduplicado, priorizado y trazable».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-05-A1 | El contexto siempre incluye el contenido del target y contadores de recuperación/selección | S | Core | `context-builder.service.spec.ts` («always includes the target content…») | ninguno | Auto |
| CT-05-A2 | El contexto respeta límites: `topK`, `minimumScore` y presupuesto de tokens, con motivo de descarte auditado (TOP_K_LIMIT, TOKEN_BUDGET) **WI-CORE-103:** vale para ambas estrategias (`LAYERED` por defecto en PHP y `RANKED`); con `LAYERED`, `topK` es el techo del relleno semántico y los motivos incluyen `BELOW_RELEVANCE_THRESHOLD`. | Post | Core | «drops candidates below minimumScore», «stops adding candidates once maxContextTokens…», «audits every candidate with the observed discard reason…», «marks an oversized candidate TOKEN_BUDGET…» | ninguno | Auto |
| CT-05-A3 | El contexto no contiene candidatos duplicados (mismo chunk) | Post | Core | ninguna explícita (el merge SE vive en el retriever) | S | Auto |
| CT-05-A4 | Las reglas funcionales se incluyen en orden, descuentan tokens antes que los chunks y no exponen al usuario confirmante | E, Post | Core | `ContextBuilder functional rules (WI-CORE-021)` (4 it) | ninguno | Auto |
| CT-05-A5 | **V1 implementada (D-16, WI-CORE-098):** con la regla D-5 (sin código del target, o sin ningún candidato sobre el mínimo Y faltan reglas funcionales requeridas del símbolo) `acquireGenerationContext` no produce GenerationContext y lanza un error interno; Validation deja la propuesta HELD y el símbolo `TECHNICAL_GENERATION_FAILURE`; Experiments termina el experimento `FAILED` sin repeticiones (caso no evaluable). V2 (Run → ACTION_REQUIRED con pregunta) queda como limitación **WI-CORE-103:** con `LAYERED`, `BELOW_RELEVANCE_THRESHOLD` cuenta como `BELOW_MINIMUM_SCORE` en la cláusula (b); con los valores por defecto la clase declarante se selecciona siempre que está indexada y (b) casi nunca se cumple, pero un target PHP sin clase declarante cuyos candidatos son solo `IMPORTED_BY` o con semántico < 0.60 y con reglas requeridas faltantes queda bloqueado (con `RANKED` se habría generado). | Pre, Err | Core | `generation/context-sufficiency.spec.ts`, `generation/test-generation-pipeline.spec.ts`, `validation/analysis-run-validation-job.handler.spec.ts`, `experiments/experiment-job.handler.spec.ts` (WI-CORE-098) | ninguno | Auto |
| CT-05-A6 | Cada contexto persiste con `context_id` enlazado a retrieval y propuesta **WI-CORE-103:** la traza añade `layer` por candidato y `strategy` y parámetros en `configuration` (aditivo, INTEROP-2.22); las trazas anteriores se leen igual. | S, Evidencia | Core | `analysis-trace.repository.pg.spec.ts` («links the context_id into a proposal…»), `context-traces.repository.spec.ts` | ninguno (pg en CI) | Auto (pg) |

Decidido (D-5): «contexto insuficiente» = sin código del target, o sin ningún candidato sobre el mínimo de relevancia Y faltan reglas funcionales requeridas ⇒ ACTION_REQUIRED y no se genera; lo demás no bloquea. Core hoy no lo define ni lo prueba: CT-05-A5 requiere implementación + prueba (L), no solo prueba. **Actualizado 2026-10-25:** implementado en su variante V1 por WI-CORE-098 (D-16).

## C-06 — Execution Coordinator → Sandbox (CT-06)
Cita: «artefactos técnicos completos; sin secretos Git/FK».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-06-A1 | El POST /executions que construye Core valida contra `CreateSandboxExecutionRequest` | E, S | Core | `src/sandbox/sandbox-execution.contract.spec.ts` | ninguno | Auto |
| CT-06-A2 | El body solo lleva claves del contrato; no incluye reglas funcionales | Pre, Post | Core | `sandbox-execution.service.spec.ts` («never sends functional rules to Sandbox…») | ninguno | Auto |
| CT-06-A3 | El request no contiene token ni credenciales Git ni secretos **Interpretación (WI-CORE-099):** «el request» es el cuerpo JSON; el service token viaja en la cabecera `Authorization` por diseño (DEC-AUTH-001) y la prueba fija el conjunto cerrado de cabeceras. | Pre | Core | ninguna explícita | S | Auto |
| CT-06-A4 | La respuesta aceptada trae `execution_id` y queda asociada al Run **Interpretación (WI-CORE-099):** el campo del contrato es `executionId` (camelCase), no `execution_id`. | S, Post | Core | `sandbox-execution.service.spec.ts` (parcial) | S | Auto |
| CT-06-A5 | Perfil no soportado/job inválido → 400 (Sandbox); fallo transitorio del sondeo (GET estado/resultado) → reintento; fallo del POST → `SandboxUnavailableError` sin reintento | Err | Core (resiliencia) + Sandbox (T9 perfil, T5 job inválido en `executions.contract-real.spec.ts`) | `sandbox-execution.resilience.spec.ts` (solo sondeo); T9/T5 en Sandbox | S | Auto |

## C-07 — Sandbox → Execution Coordinator (CT-07)
Cita: «no emite juicio funcional ni recibe semántica RAG».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-07-A1 | Un resultado COMPLETED/FAILED canónico se mapea a hechos técnicos (status, exit code, logs, métricas, execution_id) | S | Core | `sandbox-execution.contract.spec.ts`; `sandbox/sandbox-evidence-facts.spec.ts` | ninguno | Auto |
| CT-07-A2 | TIMED_OUT se mapea a FAILED/INFRASTRUCTURE | Err | Core | `map-sandbox-result.spec.ts` («maps TIMED_OUT to FAILED/INFRASTRUCTURE») | ninguno | Auto |
| CT-07-A3 | Fallo de test (compilación, aserción, runtime) se distingue de infraestructura | Err | Core | `map-sandbox-result.spec.ts` (COMPILATION, TEST_ASSERTION, TEST_RUNTIME) | ninguno | Auto |
| CT-07-A4 | La salida del Sandbox no contiene veredicto funcional ni campos RAG; Core ignora cualquier campo semántico | Post | Core + Sandbox (`executions.contract.spec.ts`) | ninguna como aserción | S | Auto |
| CT-07-A5 | El cliente real de Core consume la respuesta real del Sandbox | S, Dep | Sandbox (`core-client.contract.spec.ts`, se omite sin repo Core) | existe | S (ejecutar sin omisión con ambos repos presentes y registrar los SHA, exigido por la Tabla 56) | Auto |

## C-08 — Trace / Artifacts ← componentes (CT-08)
Cita: «reconstrucción directa e inversa cuando aplique»; evidencia «checklist de 9 enlaces».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-08-A1 | Dado un Run finalizado, la traza expone los 9 enlaces de Tabla 54 con sus identificadores (directo PR/HEAD→publication) | S, Post | Core | `analysis-run-trace.service.spec.ts` («returns the full chain for the DIRECTLY_CHANGED METHOD/FUNCTION targets…»); `analysis-trace.repository.pg.spec.ts` («builds the INTEROP §6.16 chain…») | ninguno | Auto |
| CT-08-A2 | Comprobación inversa (resultado→PR/HEAD) llega al mismo repo/PR/HEAD | Post | Checklist manual (Tabla 54) sobre los 3 AnalysisRuns de los pilotos | ninguna: el trace solo expone `PRESENT`/`NOT_APPLICABLE` y no hay consulta inversa automática | Man (checklist Tabla 54 contra los registros persistidos, con Evidence ID); la consulta automática queda como mejora posterior (D-11) | Man |
| CT-08-A3 | Enlaces 7-9 son N/A justificado cuando el Run termina legítimamente antes (la tesis solo exige esto; el contrato vigente `interoperability-contract.md` §6.16 admite N/A también en 4-6 si el Run termina antes, p. ej. ACTION_REQUIRED) | Pre | Core | `analysis-run-trace.service.spec.ts` («NOT_APPLICABLE») | ninguno | Auto |
| CT-08-A4 | Un enlace faltante o inconsistente se registra como tal | Err | Checklist manual (Tabla 54) | ninguna: Core no tiene estado de enlace faltante/inconsistente | Man (registrar N/A justificado o incumplimiento en la checklist, con Evidence ID); sin funcionalidad nueva antes de `arch-v1.0` (D-11) | Man |
| CT-08-A5 | Trace de Run no finalizado → 409 `EVIDENCE_NOT_FINISHED`; publicación PRESENT/STALE | Err | Core | `analysis-run-trace.service.spec.ts` | ninguno | Auto |
| CT-08-A6 | Checklist de 9 enlaces (Tabla 54) verificada sobre 3 AnalysisRuns reales finalizados con HEAD congelado, uno por piloto (`brick/money`, `doctrine/orm`, `EscolaLMS/Vouchers`), con Evidence ID por checklist (D-9, D-11) | Evidencia | Core (datos reales de los pilotos, sobre `arch-v1.0`) | n/a | M (3 checklists manuales) | Man |

Discrepancia tesis↔código (C-08): la tesis pide comprobación inversa y registro de enlaces faltantes/inconsistentes; el trace de Core solo expone `PRESENT`/`NOT_APPLICABLE`, sin consulta inversa ni estado de enlace inconsistente. Decisión D-11.

## C-09 — Model Provider Adapter / LLMProvider (CT-09)
Cita: «Core no depende de SDK concreto»; evidencia «interfaz/adapter + ESC-MOD-01».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-09-A1 | El adapter OpenAI cumple `LLMProvider`: genera, devuelve contenido y tokens, reporta modelo/esfuerzo efectivos | E, S | Core | `providers/openai-llm.provider.spec.ts` («sends the prompt through responses…», «reports the effective provider…») | ninguno | Auto |
| CT-09-A2 | Fallos del proveedor se envuelven como `LLM_PROVIDER_UNAVAILABLE`; config inválida falla sin llamar a la API | Err | Core | mismo spec («wraps provider failures…», «fails explicitly without calling the API…») | ninguno | Auto |
| CT-09-A3 | La suite de contrato de `LLMProvider` pasa contra el adaptador OpenAI y un segundo adaptador FALSO de prueba (misma forma de respuesta y errores), sin tocar el dominio | Post | Core | `providers/llm-provider.contract.spec.ts` (`describe.each` sobre `OpenAiLLMProvider` con cliente simulado y `providers/testing/fake-llm.provider.ts`; WI-CORE-089) | ninguno | Auto |
| CT-09-A4 | Fuera de `src/providers` y `providers.module` no se importa el SDK del proveedor | Post | Core | `providers/provider-boundary.architecture.spec.ts` sobre `src/` y `test/` reales, con prueba del detector en árbol temporal (WI-CORE-089) | ninguno | Auto (test de arquitectura) |
| CT-09-A5 | ESC-MOD-01 (D-10 revisada por D-14): tomando `arch-v1.0` como baseline, la evidencia de ESC-MOD-01 se ejecuta en una rama/commit posterior con el adaptador REAL (la suite A3 sigue con el falso) y da M1=0, M2=0, M3=100% | Evidencia | Core | definido en `spec/transversal/providers/spec.md` y ST-CORE-030; sin ejecutar | L (posterior al tag; WI-B en `feature/esc-mod-01`) | Man + Auto |

## C-10 — Persistence / Vector / Artifact adapters (CT-10)
Cita: «Core consume puertos, no proveedores concretos».

| ID | Aserción | Parte | Dónde | Existente | Falta | Auto |
|---|---|---|---|---|---|---|
| CT-10-A1 | El almacenamiento de artefactos se consume vía `ObjectStorageService` y el adapter Supabase cumple su contrato | Post | Core | adapter Supabase (parcial): `src/object-storage/supabase-object-storage.adapter.spec.ts`; el consumo vía puerto se cubre en A5 | S | Auto |
| CT-10-A2 | Embeddings se consumen vía `EmbeddingProvider` | Post | Core | adapter de embeddings (parcial): `providers/openai-embedding.provider.spec.ts` (2 it: orden y lotes; sin errores ni consumo vía puerto) | S | Auto |
| CT-10-A3 | Los repositorios `*.pg` pasan contra PostgreSQL real (jobs, trace, evidence, context-traces, retrieval-comparisons, migración) | E, S | Core | 6 `*.pg.spec.ts`, no corren localmente; el job de CI «Specs con PostgreSQL (pgvector)» salió en verde en el PR #26 tras WI-CORE-081 (6 de 6 checks), sin EV-OE1-CT-10 registrado | S (registrar la evidencia de esa corrida de CI: SHA, comando y resultado; parcial por criterio) | Auto (pg) |
| CT-10-A4 | **Reformulada (D-20, 2026-10-25):** un error de persistencia (Prisma/PG) sale por el envelope como `500 INTERNAL_ERROR` con mensaje fijo y sin fuga de internals, y los conflictos que traducen los repositorios son errores tipados (FK, idempotencia, jobs); no se añade un `ErrorCode` nuevo antes del tag | Err | Core | `all-exceptions.filter.contract.spec.ts` y specs de repositorios; aserciones en `app/src/ct/` | ninguno tras el WI-CORE-099 | Auto |
| CT-10-A5 | Fuera de repositorios/adapters no se importan SDKs de proveedor ni se usa `PrismaService` directamente; lista permitida explícita (D-21): `common/idempotency/idempotency.service.ts` se declara adapter de persistencia (D-6) | Post | Core | test de arquitectura en `app/src/ct/` | ninguno tras el WI-CORE-099 | Auto (test de arquitectura) |

Discrepancia: la tesis habla de «puertos» para relacional y vectorial; en el código son Prisma/SQL directo (sin interfaz). **D-6 decidida:** los repositorios se declaran *adapters* y se cubren con un test de arquitectura (CT-10-A5); sin refactor a interfaces antes del tag.

---

## 1. Tabla resumen

Estado tras WI-CORE-089, WI-CORE-098 y WI-CORE-099 (2026-10-25). Detalle por aserción, prueba y comando en `harness/reports/arch-v1.0-ct-evidencia-mapa.md`. Estados: Cubierta (automática), Pg (cubierta con PostgreSQL real), Declarada (reformulada o limitación aprobada), Manual (checklist con Evidence ID), Externa (mitad en otro repo), Posterior (tras el tag).

| CT | Aserciones | Cubiertas | Pg | Declaradas | Manuales | Externas | Posteriores | Dueño |
|---|---|---|---|---|---|---|---|---|
| CT-01 | 5 | 4 | 0 | 0 | 0 | 1 | 0 | Core + Integration |
| CT-02 | 4 | 3 | 0 | 1 | 0 | 0 | 0 | Core |
| CT-03 | 6 | 4 | 2 | 0 | 0 | 0 | 0 | Core |
| CT-04 | 5 | 3 | 1 | 1 | 0 | 0 | 0 | Core |
| CT-05 | 6 | 5 | 1 | 0 | 0 | 0 | 0 | Core |
| CT-06 | 5 | 5 | 0 | 0 | 0 | 0 | 0 | Core + Sandbox |
| CT-07 | 5 | 4 | 0 | 0 | 0 | 1 | 0 | Core + Sandbox |
| CT-08 | 6 | 3 | 0 | 0 | 3 | 0 | 0 | Core |
| CT-09 | 5 | 4 | 0 | 0 | 0 | 0 | 1 | Core |
| CT-10 | 5 | 2 | 1 | 2 | 0 | 0 | 0 | Core |
| **Total** | **52** | **37** | **5** | **4** | **3** | **2** | **1** | |

Las 4 declaradas son CT-02-A2 (D-19), CT-04-A2 (D-18), CT-10-A4 (D-20) y CT-10-A5 (D-21); las 3 manuales, CT-08-A2, A4 y A6 (D-11); las 2 externas, CT-01-A5 (mitad de Integration) y CT-07-A5 (prueba de contrato del cliente en el Sandbox con ambos repos); la posterior, CT-09-A5 (ESC-MOD-01 sobre `feature/esc-mod-01`).

## 2. Decisiones

### Decisiones tomadas por el usuario (chat de Core, 2026-10-23 y 2026-10-24)
- **D-1:** un registro de evidencia por CT (p. ej. EV-OE1-CT-xx con SHA, comando y resultado, en el registro de evidencias de la tesis, Anexo G/HITO-OE1).
- **D-5:** «contexto insuficiente» = sin código del target, o sin ningún candidato que pase el mínimo de relevancia Y faltan reglas funcionales requeridas ⇒ ACTION_REQUIRED y no se genera; lo demás no bloquea. Core hoy no lo define ni lo prueba: requiere implementación + prueba (CT-05-A5).
- **D-2 (2026-10-24):** C-01 cruza dos repositorios (Integration es un repo aparte). Se prueba en **dos mitades más un payload canónico compartido**: Integration prueba su mitad (webhook de GitHub a evento: firma, permisos, elegibilidad, duplicado); Core prueba la suya (evento autenticado con bearer de Integration a AnalysisRun, identidad PR/HEAD preservada, duplicado idempotente); el vínculo es un **esquema JSON canónico del payload Integration→Core** en `spec/contracts/schemas/` con un ejemplo que **ambos repos validan** (CT-01-A1, A5). Requiere un WI de implementación y Contract Sync a Integration; sin prueba extremo a extremo entre repos.
- **D-9 (2026-10-24; actualizada 2026-10-25, decisión del usuario relayada por cross):** los pilotos oficiales pasan a ser `money` (`rag-tesis-org/money`, origen brick/money), `persistence` (`rag-tesis-org/persistence`, origen doctrine/persistence) y `casbin` (`rag-tesis-org/php-casbin`, origen php-casbin/php-casbin), los tres cambios funcionales controlados (ninguno basado en issue); ya no aplican `brick/money`, `doctrine/orm` ni `EscolaLMS/Vouchers` como pilotos. CT-08 reutiliza 3 de los AnalysisRuns oficiales de OE5 con regla fijada ex ante: el Run del caso `c1` de cada piloto y, si no termina por causa objetiva, el de `c2`. Texto original (2026-10-24): CT-08 audita **3 AnalysisRuns representativos, uno por cada piloto**: `brick/money`, `doctrine/orm` y `EscolaLMS/Vouchers`. Cada uno finalizado, con HEAD congelado, y con la cadena de 9 enlaces reconstruible en sentido directo y, cuando aplique, inverso. **No** se repite la checklist para las 54 ejecuciones del experimento OE5 ni necesariamente para los 9 casos: esas 54 pertenecen al protocolo comparativo de OE5 y conservan sus propios identificadores y evidencias. La evidencia se recoge sobre `arch-v1.0` con los pilotos nuevos. Detalle del handoff del usuario (`HANDOFF_PILOTOS_EVIDENCIA_CIERRE_DOCUMENTAL.md`, §6-§7).
- **D-11 (2026-10-24):** CT-08 se cierra con **checklist manual trazable** sobre esos AnalysisRuns reales: 9 enlaces en directo e inverso mediante identificadores persistidos, consultas disponibles y evidencia asociada; cuando una comprobación inversa no exista como consulta automática se verifica manualmente contra los registros persistidos y se documenta el Evidence ID (Tabla 54). Un enlace que no aplica porque el flujo terminó antes de esa etapa se registra como **N/A justificado**, no como fallo; un enlace obligatorio que falta o es inconsistente se registra como **incumplimiento**. **No** se implementa funcionalidad nueva ni se crean endpoints antes de `arch-v1.0`; la automatización de la consulta inversa queda como mejora posterior (CT-08-A2, A4, A6).
- **D-10:** baseline de ESC-MOD-01 = suite de contrato de `LLMProvider` contra el adaptador OpenAI y un segundo adaptador FALSO de prueba, sin tocar el dominio; el segundo proveedor real queda para OE5 (CT-09-A3, A5). **Revisada por D-14.**

- **D-3 (2026-10-24):** el formato canónico de CHANGESET/INDEX DELTA para CT-02 es el del contrato de interoperabilidad vigente; no se crea schema nuevo antes del tag (recomendación aceptada).
- **D-4 (2026-10-24):** el ranking final no se asigna a un solo componente: CT-03 cubre candidatos+score y CT-05 el recorte (así quedó CT-03-A4) (recomendación aceptada).
- **D-6 (2026-10-24):** en C-10 los repositorios Prisma/SQL se declaran *adapters* y se cubren con un test de arquitectura (CT-10-A5), sin refactor a interfaces antes del tag (recomendación aceptada).
- **D-7 (2026-10-24):** en las reglas funcionales, «sin autoridad» = no ACTIVE o sin procedencia confirmada (CT-04-A2) (recomendación aceptada).
- **D-12 (2026-10-24):** **una sola ronda** de contratos: esquema JSON canónico del payload Integration→Core (CT-01, D-2), errata E-01 (`ExperimentResultsResponse` documenta `targetId`), SYSTEM-2.15 (mención de `tjc-piloto-ventas` en `system-contract.md`) y corrección del ejemplo `sandbox-result.failed.json` (`COMPOSER_INSTALL_FAILED` no existe en el código; la categoría real es `DEPENDENCY_INSTALL_FAILED`), publicadas como INTEROP-2.20 y GH-INTEROP-1.9 con Contract Sync. **No** se añade `oracleRef` ni campo equivalente a `ExperimentRun`: el oráculo se identifica por convención del registro de evidencia (`oracleId`, `caseId`, hash). *Plan del leader (no decisión del usuario):* la ejecución sería `WI-CORE-079` (reactivado con este alcance); Integration, Sandbox y Console recibirían su parte por Contract Sync vía cross.
- **D-13 (2026-10-24):** los pilotos corren sobre **forks del usuario con la GitHub App instalada** (no sobre los repos upstream, donde el equipo no puede instalarla). Consecuencias verificadas en el código (WI-CORE-085, no decisiones nuevas): el workspace del Project debe ser la cuenta u organización dueña de los forks y el binding se crea antes de abrir el PR. Detalle abierto: si la cuenta dueña es personal u organización.
- **D-14 (2026-10-24, aprobaciones del usuario en el chat de Core junto con WI-A y WI-B):** (a) WI-A y WI-B aprobados; (b) tokenizador `cl100k_base` aceptado como aproximación documentada; (c) definición de M1/M2/M3 de `arch-v1.0-modularidad-llm-provider-core.md` §3 aceptada (M1 sobre `app/src` y `app/test`; `package.json` y lockfile cuentan como configuración, listados aparte); (d) proveedor previsto Anthropic, en la rama `feature/esc-mod-01` (WI-B); la tabla de esfuerzo para Anthropic la propone el leader antes de implementar. **D-10 revisada:** el adaptador falso es el doble de CT-09-A3 (determinismo, sin red ni coste); la evidencia de ESC-MOD-01 (CT-09-A5) usa el adaptador real en la rama posterior al tag; una prueba de humo real es opcional, marcada como integración y excluida de `pnpm test` por defecto.

- **D-15 (2026-10-25):** opción A: antes de cualquier Run oficial se cierran los huecos que exigen código y se recrea el tag `arch-v1.0` una sola vez (borrar el tag local y remoto y volver a crearlo), para que toda la evidencia OE1/OE3/OE4/OE5 salga de una sola línea base.
- **D-16 (2026-10-25):** CT-05-A5 (regla D-5) se implementa en su variante V1 (`WI-CORE-098`); V2 queda declarada como limitación.
- **D-17 (2026-10-25):** G-02 (F1: código de error propio para «esfuerzo no admitido» del segundo proveedor) se declara limitación y no se implementa: es inalcanzable por configuración (el arranque lo rechaza).
- **D-18 (2026-10-25):** G-04: CT-04-A2 se reformula (ver la fila); no se filtra por procedencia.
- **D-19 (2026-10-25):** G-05(b): CT-02-A2 se redacta a la semántica implementada (ver la fila) y la forma estricta se declara NO CUMPLE; el cambio de Core para decidir `DIRECTLY_CHANGED` solo por CHANGESET queda diferido a después de la evidencia.
- **D-20 (2026-10-25):** G-06: CT-10-A4 se reformula (ver la fila).
- **D-21 (2026-10-25):** G-07: CT-10-A5 usa una lista permitida explícita.
- **D-22 (2026-10-25):** G-08: CT-08-A2 y A4 siguen manuales (reafirma D-11); la consulta inversa automática queda como mejora posterior.
- **D-23 (2026-10-25):** G-09(1): la «versión» de la Tabla 63 y de IOE3.1 se representa por el linaje `supersedesId` + `createdAt`; no se añade una columna `version`.

### Pendientes

Ninguna decisión de CT queda abierta. Detalle abierto fuera de las decisiones de CT: la cuenta dueña de los forks (personal u organización, D-13).

D-8 se retiró: la Tabla 56 ya exige registrar los SHA de los repos integrados; queda como requisito de CT-07-A5.

## 3. Orden sugerido por valor para el tag

1. CT-08: A1/A3/A5 ya cubiertas; A2/A4/A6 como 3 checklists manuales (uno por piloto; D-9, D-11), exigido por IOE1.1 y Tabla 54.
2. CT-09 + ESC-MOD-01 (A3 suite con adaptador falso; A5 tras el tag, D-10).
3. CT-05-A5 (regla D-5, requiere implementación) y CT-10-A3/A5 y CT-01-A1/A5 (CT-01-A1/A5 se apoyan en la ronda de contratos D-12, WI-CORE-079, y en el WI de Integration).
4. CT-03-A3/A4, CT-04-A2 (aserciones de frontera, S/M).
5. CT-06-A3, CT-07-A4, CT-02-A2/A4 (cierres pequeños).

## 4. Nota

Propuesta por lectura; sin pruebas escritas ni corridas oficiales.

## 5. Documentos con descripción desactualizada (para la revisión final de coherencia; no se modifican aquí)

Decisión del usuario (2026-10-24): los pilotos oficiales son `brick/money` (cambio funcional controlado), `doctrine/orm` (cambio basado en el issue público #11600) y `EscolaLMS/Vouchers` (cambio funcional controlado), y **sustituyen** a los antiguos pilotos creados por el equipo de ventas, reservas y suscripciones. La tesis aún describe los antiguos en §3.3.3 («Sales/Discounts, Reservations y Subscriptions») y en el baseline del piloto de §5.6 (`tjc-piloto-ventas`, `tjc-piloto-reservas`, `tjc-piloto-suscripciones`); el Full Paper debe contrastarse igual. El diseño de OE5 (3 repositorios × 3 casos × 2 estrategias × 3 repeticiones = 54 ejecuciones y 27 pares) se mantiene. Se marcan para la revisión final de coherencia documental; la tesis y el Full Paper no se modifican sin instrucción explícita.
