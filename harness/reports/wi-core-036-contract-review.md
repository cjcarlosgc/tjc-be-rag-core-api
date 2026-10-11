[contract-reviewer::GPT-6 Luna / High] · WI-CORE-036 · Revisión contractual
Modelo: contract-reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo high

status: APPROVED

findings:
- El alcance de WI-CORE-036 está definido y consistente entre los criterios del WI, feature 019, SYSTEM-2.7 e INTEROP-2.8: cardinalidad uno-a-uno Project/repository, detección automática solo para un `composer.json` candidato, fallback legacy con cero candidatos, ningún ranking ni selector para múltiples candidatos, raíz POSIX bajo el snapshot lógico, aislamiento de análisis y paths externos repo-relative. `DEC-PHP-ROOT-001` bloquea solo el subcaso de múltiples candidatos y no impide el candidato único.
- La persistencia necesaria es aditiva: `Project.projectRoot` admite `null` antes de resolver candidato; `ProjectVersion.effectiveProjectRoot` se congela por versión. Versiones históricas deben leerse como `.` (por default/backfill compatible). Los DTOs publicados agregan `projectRoot` a `ProjectResponse` y `effectiveProjectRoot` a las respuestas/summary/results de ProjectVersion; conservar compatibilidad de lectura de versiones antiguas y no cambiar los paths repo-relative.
- CS-CORE-20261011-001 (Console) y CS-CORE-20261011-003 (GitHub Integration) siguen C-PENDING en el outbox local y no hay sus ACKs en el inbox de Core. El primero requiere importar espejos y no crear selector; el segundo solo actualizar espejos y acusar. Esto no requiere un contrato adicional ni un cambio de producto en esos consumidores, pero no debe declararse propagación/acuse completo hasta que los consumidores importen y acusen. No altera la autorización actual para desarrollar en Core el corte de candidato único.
- WI-CORE-037 no debe enviar `projectRoot` a Sandbox ni activar ejecución PHP con raíz anidada mientras CS-CORE-20261011-002 siga sin ACK/importación del Sandbox y sin WI local implementado. INTEROP-2.8 declara `projectRoot` opcional durante la transición; omisión equivale a `.` y mantiene el comportamiento legado. Core puede preparar cambios internos de WI-037 solo si no cambia el request efectivo enviado al Sandbox; el corte funcional de transporte/cwd espera el ACK y evidencia Sandbox.
- No se requiere Contract Sync nuevo: los tres eventos existentes cubren los consumidores y los archivos contractuales vigentes ya están publicados en `sourceRevision: 187b0383817e341aa7c82e91cb36d7dcce343479`. No cambiar SYSTEM/INTEROP ni reinterpretar el evento de Sandbox.

blockers:
- Para completar WI-036 y superar sus checkpoints externos, mantener trazabilidad de las importaciones/ACKs de Console y GitHub Integration conforme a los gates locales; el estado actual del outbox es C-PENDING.
- Para WI-CORE-037, ACK/importación de Sandbox, WI local Sandbox registrado e implementación/validación del root y cwd son prerrequisitos antes de que Core incluya el campo en ejecuciones. No se debe cerrar WI-037 ni inferir que el ACK existe.

filesAffected:
- `harness/reports/wi-core-036-contract-review.md` (este informe)
- Contratos revisados como referencia sin cambios: `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`, `spec/features/019-project-root-detection/spec.md`, `spec/features/019-project-root-detection/plan.md`, `spec/features/019-project-root-detection/tasks.md`, `harness/contract-sync/outbox/CS-CORE-20261011-001.yaml`, `-002.yaml`, `-003.yaml`

evidence:
- `harness/work-items.json` WI-CORE-036: criterios para root único, compatibilidad histórica, DTOs, paths y aislamiento; dependencias vacías.
- `spec/features/019-project-root-detection/spec.md` y `plan.md`: candidato único aprobado, DEC-PHP-ROOT-001 limitado a múltiples candidatos y orden de dependencia entre WI-036/037.
- `spec/contracts/system-contract.md` §Repository binding: `repositoryId` sigue único por Project y único Project por repositorio; root único por snapshot y sin heurística multi-candidato.
- `spec/contracts/interoperability-contract.md` §6.1-6.2: `ProjectResponse.projectRoot`, `ProjectVersion.effectiveProjectRoot`, backfill semántico `.` y paths públicos repo-relative.
- `spec/contracts/interoperability-contract.md` §7.2: `CreateSandboxExecutionRequest.projectRoot` opcional, omisión legacy `.`; validación bajo `repositoryRoot`, Composer/PHPUnit cwd en subproyecto, artefactos repo-relative e identidad idempotente que incluye root.
- `harness/contract-sync/outbox/CS-CORE-20261011-001.yaml`, `-002.yaml`, `-003.yaml`: todos `C-PENDING`; el evento `-002` requiere explícitamente ACK antes de que Core envíe el campo.
- `harness/contract-sync/inbox/`: no existen eventos `CS-CONSOLE-20261011-*`, `CS-GH-20261011-*` ni `CS-SANDBOX-20261011-*` que acusen estos tres eventos.

recommendedNextStep:
- Continuar WI-CORE-036 únicamente dentro del alcance aprobado y registrar la persistencia/migración aditiva con compatibilidad histórica. Mantener el contrato canónico intacto. Mantener WI-CORE-037 pendiente de la importación/ACK y WI local Sandbox antes de implementar el transporte de `projectRoot`.
