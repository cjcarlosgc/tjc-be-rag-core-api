# Migración de backlog a SDD 2.0

**Estado:** APROBADO como re-baseline de T-001
**Corte:** 2026-09-13
**Fuente:** código, tasks y contratos vigentes al crear `feature/T-001`

Este reporte clasifica trabajo ya terminado, parcial o pendiente mediante `KEEP|ADAPT|DEFER|DROP`. No autoriza iniciar automáticamente las HU posteriores; la selección del siguiente work item requiere revisión humana de SDD 2.0.

## RAG Core

| Existing work item/capability | Estado actual | Relación SDD 2.0 | Clasificación | Prioridad propuesta | Razón |
|---|---|---|---|---|---|
| HU01 Project | completo | domain root y ownership | ADAPT | P0 | Incorporará repository binding, integration branch y futura autorización colaborativa. |
| HU02-HU07 ZIP, ProjectVersion, indexación e inventario | operativo con pendientes menores | snapshot por commit SHA, bootstrap/incremental, existing tests | ADAPT | P0/P1 | Se reutilizan parsing, storage, inventario e índice; ZIP queda solo legacy/development. |
| HU08-HU12 modalidades de generación manual | operativo | etapa de generación derivada de AnalysisRun/CHANGESET | ADAPT | P1 | Se reutilizan providers, prompt y merge; los modos manuales dejan de dirigir orquestación. |
| HU13-HU18 jobs, validación y artefactos | operativo con pendientes de integración | pipeline PR-driven, baseline, clasificación y propuestas | KEEP/ADAPT | P0/P1 | Jobs DB-backed, evidencia y artefactos son base; estados y ownership pasan a AnalysisRun. |
| HU19 experimento RAG vs GENERALIST_AGENT | operativo con limitaciones documentadas | experimento de tesis | KEEP | P2 | Se conserva la comparación y se añade `DEC-EXP-FK-001` antes de usar Functional Knowledge en evidencia. |
| HU20-HU22 historial y realtime | operativo | historial/actualización de AnalysisRun | ADAPT | P1 | Infraestructura reutilizable; topics y DTOs deben migrar al nuevo dominio. |
| HU23 autoreparación | descartado | prohibición de autorepair semántico | DROP | ninguna | Sigue descartado; no se revive con SDD 2.0. |
| HU24 retry manual | operativo | attempt/continuation dentro del mismo Run/HEAD | ADAPT | P1 | La semántica debe separar retry técnico, continuación humana y nuevo HEAD. |
| HU25 gestión/listado | operativo | Projects/Runs del control plane | ADAPT | P1 | Listados existentes se reutilizan con repository y AnalysisRun. |
| HU27-HU28 trazas | pendiente | contexto semántico, estructural, funcional y tests | ADAPT | P1/P2 | El diseño sigue vigente pero debe vincularse a PR/HEAD y Functional Knowledge. |
| HU29 auth/owner scoping | implementado; e2e completo no cerrado en el corte | PlatformUser y autorización de Project | KEEP/ADAPT | P0 | Base segura; se agrega GitHub OAuth solo como login y no como permiso de repositorio. |
| GitHub login -> listado/importación de repos | dirección mock anterior | contradice GitHub App + binding | DROP | ninguna | Superseded by SDD 2.0 / T-001. |

**Capacidades completadas a preservar:** ownership, jobs DB-backed, object storage, snapshots inmutables, parsing TS, retrieval híbrido, generación, Sandbox client, artefactos, experimento y trazas observables existentes.

**Capacidades parciales a adaptar:** ProjectVersion por ZIP -> snapshot SHA; TestGenerationRun -> AnalysisRun; modos manuales -> targets derivados; realtime/history -> lifecycle PR; contexto técnico -> contexto multi-source.

**Pendientes old-direction a defer/drop:** expansión de selección manual y repo import ligado a login GitHub. ZIP se difiere como entrada principal, pero se conserva para desarrollo/experimento.

**Nuevos P0:** HU30-HU36. **Nuevos P1:** HU39-HU42 y adaptación de trazas/orquestación. **Siguiente recomendado:** HU32 (modelo/lifecycle de AnalysisRun) junto con la parte de dominio de HU30, antes de ingerir webhooks reales.

## Developer Console

| Existing work item/capability | Estado actual | Relación SDD 2.0 | Clasificación | Prioridad propuesta | Razón |
|---|---|---|---|---|---|
| HU01-HU09 flujos base | mayormente completos | componentes, routing, API adapters y estados asíncronos | KEEP/ADAPT | P1 | Se reutiliza shell y visualización; las pantallas deben hablar de Runs/PR, no launcher manual. |
| HU10-HU26 experiencia consolidada | parcial | control plane mock-first | ADAPT | P0 | Es la base visual inmediata para Projects, Runs, Integrations y escenarios SDD 2.0. |
| HU27-HU28 context explorer | pendiente | trazas de contexto multi-source | ADAPT | P1 | Debe incluir cambios, símbolos, Functional Knowledge y evidencia existente. |
| HU29 autenticación | pendiente | email/password + GitHub OAuth + deep-link returnTo | ADAPT | P0 | Se conserva Supabase Auth; se excluyen Google OAuth, repo sync implícito y linking propio por correo. |
| Mock GitHub login/import | código exploratorio | flujo superseded | DROP/DEFER cleanup | P4 | No debe aparecer como arquitectura vigente ni definir DTOs. |

**Orden frontend:** aprobar SDD 2.0 -> migrar shell/control plane -> demo mock completa conforme a INTEROP-2.0 -> revisión UX/arquitectura -> integración live progresiva.

**Primer incremento:** Projects, Runs, Action Required, Focus Mode, Integrations/GitHub y escenarios success, action required, mismatch/correction, sufficient tests, baseline failure, generation failure, no relevant changes y publicación. Mocks viven detrás de un adapter separado y muestran `DEMO`.

**Siguiente recomendado:** HU37 + HU38, apoyadas en fixtures INTEROP-2.0; no esperar backends productivos.

## Test Execution Sandbox

| Existing work item/capability | Estado actual | Relación SDD 2.0 | Clasificación | Prioridad propuesta | Razón |
|---|---|---|---|---|---|
| HU01 API asíncrona/Bearer/idempotencia | operativo con verificación real pendiente | transporte Core->Sandbox 2.0 | KEEP/ADAPT | P0 | La frontera sigue vigente y agrega execution profile/phase. |
| HU02-HU04 workspace, materialización y container | completo | aislamiento y reproducibilidad | KEEP | P0 | Es infraestructura neutral a lenguaje que no debe reescribirse. |
| HU05 adapters Jest/Vitest | completo | profile NODE_TYPESCRIPT | KEEP | P1 | Track de compatibilidad, sin expansión innecesaria. |
| HU06 resultados objetivos | completo | evidencia neutral y clasificación en Core | KEEP/ADAPT | P0 | Se amplía runner/profile; Sandbox no interpreta negocio. |
| HU07 batch | completo | ejecución de targets/batches derivados del changeset | KEEP/ADAPT | P1 | Se conserva sin recibir lógica PR. |
| HU08 lifecycle/cleanup | completo con verificación real pendiente | resiliencia de ambos profiles | KEEP | P0 | Timeouts, límites, sweeper e idempotencia son comunes. |
| PHP mock runner | inexistente | no aceptado como solución | DROP | ninguna | El soporte debe ejecutar PHP/Composer/PHPUnit reales. |

**Nuevos P0/P1 PHP:** HU43 y las migraciones INTEROP-2.0 requeridas: seleccionar `executionProfile`, validar composer metadata, materializar dependencias, ejecutar PHPUnit y normalizar evidence sin secretos GitHub/Core.

**Siguiente recomendado:** abstracción real de execution profiles como primer corte de HU43, preservando `NODE_TYPESCRIPT`; después runtime PHP/Composer y PHPUnit.

## Roadmaps coordinados

### Frontend

1. HU37-HU38: control plane, Action Required y Focus Mode mock-first.
2. Integrations/GitHub y Runs con fixtures INTEROP-2.0.
3. Nueve escenarios mock navegables y revisión UX.
4. Sustitución progresiva por adapters live.

### Core

1. Milestone A: HU32, dominio/state model; HU30 binding; HU35 Functional Knowledge.
2. Milestone B: HU31 GitHub App/webhook/idempotencia.
3. Milestone C: HU33-HU34 changeset e impacto.
4. Milestone D: HU36 retrieval funcional/continuation.
5. Milestone E: HU41-HU42 PHP parsing/generation.
6. Milestone F: HU39-HU40 Checks/publicación.

### Sandbox

1. Migrar contract fixtures a INTEROP-2.0 conservando Node/Jest/Vitest.
2. Introducir execution-profile abstraction.
3. Implementar PHP, Composer, Laravel-compatible materialization y PHPUnit.
4. Normalizar evidence PHP y verificar integración con Core real.

## Puertas que permanecen pendientes

- `DEC-MET-001`: mutation testing; no vuelve obligatorio Mutation Score.
- `DEC-INF-001`: proveedor/VM remota.
- `DEC-VAL-001`: condiciones empresariales.
- `DEC-EXP-FK-001`: paridad del contexto funcional en el experimento.

Ninguna bloquea T-001. Cada una bloquea exclusivamente el trabajo declarado en `SYSTEM-2.0`.
