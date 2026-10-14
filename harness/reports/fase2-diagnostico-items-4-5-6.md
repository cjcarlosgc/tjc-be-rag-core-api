# Fase 2 — Diagnóstico de los ítems #4, #5 y #6 (solo lectura; sin implementar)

Fecha: 2026-10-13. Origen: Cross (objetivo de Jean: «seguir puliendo lo ya construido; no contradecir el paper ni la tesis»). Alcance: diagnóstico + propuesta mínima. **Nada de esto está implementado**; cada corrección exige aprobación de alcance de Jean en el chat de Core. Evidencia de código en `app/src/`; trazas de la base real (SELECT de solo lectura).

Definiciones de la tesis que NO se tocan: SE = semántico + R-PHP1..5, pesos 0.7/0.3, top-10; GENERALIST_AGENT read-only con `list_files`/`read_file`/`search_text`/`inspect_symbol`; métricas VT/CF/CO; `valid ≡ passed`.

## #5 — `inspect_symbol` con nombres sin calificar devuelve EMPTY

**Evidencia.** Piloto V1: SUB-3 `inspect_symbol("applyPendingPlan")` → `EMPTY` en 2 repeticiones (`5e2b278e…`, `f7fe93c9…`); SAL-3 `inspect_symbol("total")` → `EMPTY` en 1 (`c190382e…`). Con nombre calificado (`App\Domain\Voucher\redeem`, `…::redeem`) ya resuelve (WI-055).

**Causa (código).** `app/src/generation/agent/workspace-agent-tools.ts:matchPhpDeclaration` solo acepta: el nombre simple/calificado de una **declaración de tipo o función** (`class`, `interface`, `trait`, `enum`, `function`) o un método **con prefijo de clase** (`Clase\m`, `Clase::m`, `Clase.m`). Un nombre de método suelto (`total`, `applyPendingPlan`) no es ni tipo ni función ni `Clase::m`, así que nunca coincide. Es el comportamiento especificado en `spec/features/018-php-laravel-support/spec.md` §5 («declaración de clase, interfaz, trait, enum o función con ese nombre corto»), no un defecto aleatorio.

**Cambio mínimo.** Si la búsqueda por tipo/función no encuentra nada, buscar **métodos** con ese nombre simple en el pool; si hay una coincidencia, devolverla; si hay varias, devolver la primera por orden de ruta e indicar «ambiguo: N coincidencias» con las rutas (sin elegir en silencio). Prueba rojo→verde en `workspace-agent-tools.spec.ts` (método único, ambiguo, inexistente, TypeScript sin cambio).

**Riesgo.** Bajo: el fallback solo actúa donde hoy devuelve EMPTY. Ambigüedad entre clases con métodos homónimos (`status`, `save`); se mitiga reportándola. Cambia el comportamiento observable del agente (más llamadas útiles) → vale como versión nueva de la medición.
**Contrato / Contract Sync.** No toca contrato público (el formato de trayectoria y observaciones es el mismo); sí enmienda spec 018 §5.
**Roza la tesis/paper.** No cambia el conjunto de herramientas (sigue read-only, 4 herramientas) ni SE. Es un refinamiento de resolución de nombres; **declarar** en el paper que `inspect_symbol` resuelve métodos por nombre simple desde la versión nueva. No contradice nada.

## #4 — Constructores sin TestTarget (`php-parser.service.ts:181`, IDEA-024)

**Evidencia.** `POST /experiments` con `App\Domain\OrderLine.constructor` → `UNRESOLVABLE_TARGET` (SAL-3). El símbolo existe en el análisis (`snapshot-analysis-job.handler.ts:73` colapsa CONSTRUCTOR→METHOD, qualifiedName `Clase.constructor`), pero no hay fila en `test_targets`.

**Causa.** `php-parser.service.ts:181`: `if (isClass && !constructor && this.isPublicMethod(member))` — el constructor se indexa como **chunk** (`CONSTRUCTOR`, `symbolName='constructor'`) y se excluye como candidato. Para TypeScript es igual: `test-target-extractor.service.ts` itera `getMethods()` (no `getConstructors()`), de modo que **ningún lenguaje** genera TestTarget de constructor. No es un defecto de PHP, es una decisión de producto homogénea.

**Cambio mínimo (si Jean lo aprueba).** Permitir `__construct` público como TestTarget `METHOD` con `methodName='constructor'` (la convención ya usada por chunks, análisis y reglas `Clase.constructor`), solo PHP o ambos lenguajes; ajustar `phpTestLocation` (nombre de clase `…ConstructorTest`), prompts y matching. Pruebas rojo→verde en parser, `findMatchingTestTarget` y retrieval.

**Decisiones que requiere Jean.** (1) Nombre canónico: `constructor` (coherente con chunks/reglas/TS) frente a `__construct`. (2) ¿Solo PHP o también TypeScript? (asimetría de catálogos si solo PHP). (3) Reanálisis: las versiones ya analizadas no ganan el target; hay que generar una ProjectVersion nueva (no se re-ejecuta el piloto V1). (4) Impacto en el catálogo de targets/«cobertura» (cuenta de TestTargets sube).
**Riesgo.** Medio: cambia el catálogo de TestTargets y por tanto conteos y vistas de Console; no toca ranking. **Contrato:** probablemente no (tipo METHOD ya existe); verificar si INTEROP/Console documenta «no hay targets de constructor». **Roza la tesis:** cambia el *universo de targets* evaluables; el paper debe declararlo. No contradice SE ni VT/CF/CO.
**Nota:** IDEA-024 (falso negativo de construcciones nuevas en constructores PHP) es un problema distinto, aunque comparte la nomenclatura `constructor`/`__construct`; conviene decidirlos juntos.

## #6 — Qué falta persistir para reconstruir un trial sin cruzar tablas

Hoy el trial se reconstruye con 4+ tablas: `experiment_repetitions` + `experiment_repetition_artifacts` + `context_traces` + `experiment_runs` (+ `project_versions`, `test_targets`, `functional_knowledge`).

| Dato | Estado hoy | Cómo recuperarlo hoy | Propuesta (aditiva) | Tocaría contrato |
|---|---|---|---|---|
| Versión del snapshot / head | `ProjectVersion.commitSha`; `ExperimentRun.projectVersionId` | JOIN `experiment_runs → project_versions` | copiar `commitSha` (y rama/PR si existe) en `ExperimentRun` al crear | No (interno; opcional exponer en §6.16 solo con Contract Sync) |
| analysisRunId / PR / head del PR | **No** está en `ExperimentRun` (solo `projectVersionId`) | por `analysis_runs.projectVersionId` (ambiguo si varias runs comparten versión) | `ExperimentRun.analysisRunId` (el DTO ya lo recibe en `POST /experiments`) | No si interno |
| Timestamps por intento | Solo `createdAt` de la fila y `lastHeartbeatAt` (interno) | duraciones (`generationDurationMs`, `executionDurationMs`) | `startedAt`/`finishedAt` en `ExperimentRepetition` | No si interno |
| Hash del prompt / contexto final enviado al LLM | **No persiste** | no recuperable (solo candidatos y `dependencyContext`) | `promptSha256` + `promptTokenCount` (hash del prompt serializado; opcional guardar el texto en `experiment_repetition_artifacts`, privado, con límite) | No si interno |
| Salida bruta del Sandbox (stdout/stderr) | **No** (el Sandbox no la devuelve) | — | requiere extender contrato del Sandbox (otro repo) | **Sí** (Sandbox, Contract Sync + handoff) |
| Modelo/esfuerzo efectivo | `ExperimentRun.modelConfig` ✔ | — | — | — |
| Reglas con procedencia | `context_traces.functionalRules` + `functional_knowledge` ✔ | JOIN | snapshot del texto de la regla en la traza (la regla puede cambiar) | No si interno |

**Cambio mínimo recomendado (todo aditivo e interno):** `analysisRunId`, `commitSha`, `startedAt/finishedAt` por intento, `promptSha256` (+ texto privado acotado) y snapshot de reglas en la traza. Requiere migración aditiva (columnas nullable). **Riesgo:** bajo; filas previas sin dato (sin backfill). **Contrato:** no, mientras no se exponga en DTO/§6.16. **Roza la tesis:** no cambia ninguna métrica ni el protocolo; refuerza la trazabilidad («salida exacta de la estrategia»). Persistir el *texto* del prompt guarda código de terceros: DEC-VAL-001 (gobierno de datos) sigue PENDING → proponer solo el hash por defecto.

## Lo que NO se propone (cambiaría lo que afirman paper/tesis)
- Cualquier cambio de ranking, pesos, topK o relaciones R-PHP (DEC-RAG-001 PENDING).
- Dar reglas funcionales o herramientas nuevas (escritura/ejecución) al GENERALIST_AGENT.
- Cambiar la definición de `valid`/`passed` o redefinir VT/CF/CO; separar la causa «violación de regla» vs «error del modelo» (alcance excluido).

## Frases de aprobación de alcance (para que Jean las pegue en el chat de Core)

**#5:** «Apruebo el alcance del WI de Fase 2 #5: que `inspect_symbol` del agente resuelva por nombre simple los métodos PHP cuando no hay tipo ni función con ese nombre (reportando ambigüedad con rutas), sin cambiar las herramientas ni el ranking; con prueba rojo→verde y enmienda de la spec 018 §5. Sin push ni despliegue sin mi orden.»

**#4:** «Apruebo el alcance del WI de Fase 2 #4: permitir el constructor público como TestTarget METHOD con nombre canónico `constructor` (solo PHP / PHP y TypeScript: elegir uno), con prueba rojo→verde, sin modificar ranking ni R-PHP; el reanálisis se hará con una ProjectVersion nueva. Sin push ni despliegue sin mi orden.»

**#6:** «Apruebo el alcance del WI de Fase 2 #6: persistir de forma aditiva e interna en cada experimento/repetición el `analysisRunId`, el `commitSha`, los timestamps de inicio/fin por intento y el hash SHA-256 del prompt enviado (sin exponerlos en DTO ni contrato), con migración aditiva creada y probada en local y no aplicada hasta mi orden. Sin push ni despliegue sin mi orden.»

Modelo: Claude Sonnet 5.5 (diagnóstico sin cambios en `app/`).
