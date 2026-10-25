# WI-CORE-097 — revisión independiente (ciclo 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

Alcance: relectura de las secciones modificadas del informe (`harness/reports/wi-core-097-aislamiento-y-purga-projects.md`) contra código y spec. Solo lectura. No edité el informe.

## Veredicto: CHANGES_REQUESTED (dos correcciones menores y una cita; sin riesgo de fondo)

H1 a H9 están aplicados y casi todo es exacto, pero el leader introdujo una afirmación incorrecta (N1) y una contradicción interna (N2). Son LOW/MEDIUM bajo; con N1 y N2 corregidos, APPROVED sin otro ciclo (el leader las aplica en el cierre, ya que el máximo de 2 ciclos se agota).

## Hallazgos nuevos

| # | Sev | Dónde | Qué cambiar |
|---|---|---|---|
| N1 | MEDIUM | §3 primera viñeta | Se lista `GeneratedTestProposal.generation` entre las columnas que «contienen texto derivado del código». El schema (`schema.prisma:503-505`) la define como `{ provider, model, modelVersion, reasoningEffort, inputTokens, outputTokens, durationMs }`: solo metadatos. Moverla a «solo metadatos». Además `ExperimentRepetition.trajectory` se afirma como texto de código sin respaldo campo a campo: cada paso guarda `resultSummary`, `arguments`, `resultSha256` y `observations` (`generalist-agent.service.ts:23-35`, saneado con `safeAgentStep`); puede incluir fragmentos del repositorio pero no lo comprobé. Reclasificarlo como «puede contener fragmentos (no verificado)». `sandboxEvidence` queda correcto (stdout/stderr, comentario del schema). |
| N2 | LOW | §4, tercera viñeta | «No verificado: … el orden exacto de borrado contra las migraciones SQL reales (se infirió del `schema.prisma`)» contradice §2 («contrastado con todas las migraciones SQL, que coinciden») y §4 primera viñeta. Reescribir: las `ON DELETE` están contrastadas con las migraciones; lo no verificado es la ejecución real del orden contra una BD (un script de purga debe probarse en una BD de prueba). |
| N3 | LOW | §1 matiz 2 (`≈:104`) | El `findById` sin scoping de `functional-knowledge.repository.ts` está en `:94-96` (no ≈`:104`). Corregir la cita. |

## Citas corregidas (verificadas)

- `retrieval.service.ts:111,134,152`: correctas (`findBySymbol` `:111`, `findSimilarByEmbedding` `:134` y `:152`; son los únicos llamadores).
- `test-targets.repository.ts:12-41`: correcto (`deleteByProjectVersion` `:11-13`, `findByProjectVersion` `:35-40`, `findById` `:46-47`; métodos/targets en `:62-76`). `≈:47` correcto.
- `experiment-job.handler.ts:210-214,232`: correcto (`findById(payload.projectVersionId)` `:210`, `testTargetsRepository.findById(payload.targetId)` `:211`, `objectStorageService.get` `:232`).
- `supabase-object-storage.adapter.ts:46-54`: correcto (`delete` con `remove` en `:47-54`).
- Cierto lo demás aplicado: cascadas de `ContextTrace` desde `ProjectVersion`/`TestTarget`/`ExperimentRun`/`ExperimentRepetition` (`schema.prisma:953-959`); tres `SET NULL` más `projects.currentVersionId` en migraciones; `WebhookDelivery` (`:652`) e `IdempotencyRecord` (`:1071`) sin FK; `UserGithubIdentity` (`:1089`) de usuario; `Artifact` (`:794`) sin `artifact.create` en el producto; `DEC-INF-001` `:265` y `DEC-INF-002` `:281` citados fielmente («exclusivamente repositorios de demostración/piloto … no código empresarial»; 80/443 «no habilitan código empresarial»); `candidates` solo metadatos (`analysis-trace-evidence.util.ts:43-52`); `promptSha256` (`:903`); `presignGet` en `sandbox-execution.service.ts:328`; `@RequireProjectRole('ADMIN')` en el controller; `app/scripts` solo con extractor, generador de contratos y entorno PHP.
- Sin secretos, IDs reales ni datos de BD; sin promesas de ejecución; español correcto.

## No verificado

Contenido real de BD/Storage, retención de proveedores, comportamiento de las FK en la BD desplegada.
