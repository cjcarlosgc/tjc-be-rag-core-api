# 013 — Análisis PR-driven y contexto funcional

**Estado:** APROBADO
**Story IDs:** HU30-HU36, HU39-HU42
**Contrato:** SYSTEM-2.0 / INTEROP-2.0

## Objetivo

RAG Core recibe eventos de una GitHub App para repositorios vinculados, crea un `AnalysisRun` por PR/HEAD y valida el `CHANGESET` con contexto semántico, estructural, funcional y de tests existentes. La Console puede completar contexto faltante y Core publica resultados por Check; los tests solo se publican después de revisión humana y freshness check.

## Invariantes

- GitHub OAuth autentica personas mediante Supabase Auth; GitHub App automatiza repositorios. Ninguna identidad implica la otra.
- Un Run representa un PR/HEAD. Attempts y continuaciones no crean Runs nuevos si el HEAD no cambia.
- `pull_request:synchronize`, incluido force-push, obsoleta el Run previo y crea uno para el HEAD nuevo.
- Solo `PR.base == Project.integrationBranch` activa análisis; `develop` es default configurable. No existe trigger global `push` ni workflow YAML obligatorio.
- `CHANGESET` define qué validar; `INDEX DELTA` define qué reindexar.
- Solo el Run vigente publica Check vigente. La merge policy pertenece al repositorio.
- `ACTION_REQUIRED` termina el job; una respuesta autorizada puede continuar el mismo Run/HEAD.
- `UNKNOWN`/No lo sé no crea `FunctionalKnowledge ACTIVE`.
- Sandbox recibe profile, snapshot, artifacts y targets; nunca recibe GitHub, usuarios, prompts, reglas funcionales o estrategia experimental.
- No existe autorepair semántico, modificación automática de producción, escritura directa a la feature branch ni auto-merge.

## Pipeline

```text
webhook verificado
-> binding habilitado
-> normalización/idempotencia
-> AnalysisRun + PR_ANALYSIS job
-> snapshot por SHA
-> bootstrap o INDEX DELTA
-> PR CHANGESET
-> changed + impacted symbols
-> existing test baseline
-> technical + functional retrieval
-> enough context?
   -> no: ACTION_REQUIRED + Check + job finalizado
   -> yes: generate -> Sandbox -> classify -> Check
```

Una respuesta human persistente genera Functional Knowledge y un continuation job solo si el HEAD sigue vigente. Un HEAD nuevo conserva la respuesta como evidencia/regla potencial y la reevalúa en otro Run.

## Clasificación

- `SUCCESS`: baseline y propuesta generada se validan.
- `NO_ADDITIONAL_TESTS_REQUIRED`: tests existentes cubren suficientemente los targets.
- `NO_TEST_RELEVANT_CHANGES`: no existen cambios relevantes para pruebas.
- `ACTION_REQUIRED`: falta conocimiento funcional relevante.
- `BEHAVIORAL_MISMATCH`: test técnicamente válido evidencia diferencia expected/observed.
- `TECHNICAL_GENERATION_FAILURE`: la prueba propuesta es técnicamente inválida.
- `INFRASTRUCTURE_FAILURE`: plataforma/Sandbox/storage/worker impide validar.
- `BASELINE_FAILED`: tests existentes relevantes ya estaban rojos.
- `OBSOLETE`: otro HEAD o lifecycle del PR invalida vigencia.

## Publicación

En `SUCCESS`, Core expone propuestas para revisión. Al solicitar publicación:

1. autoriza por Project;
2. comprueba que PR y HEAD siguen vigentes;
3. marca `STALE` si cambiaron;
4. crea rama desde el HEAD validado;
5. abre companion PR hacia la feature branch;
6. nunca auto-mergea ni reabre un companion PR cerrado.

Propuestas de un mismatch quedan `HELD`. El companion PR no dispara el pipeline principal porque su base no es `integrationBranch`; al mergearse en la feature branch, el PR original recibe `synchronize` y se revalida.

## Casos operativos obligatorios

1. Cambio sin tests y sin pregunta funcional: bootstrap/incremental, generación, Sandbox y `SUCCESS`.
2. Cambio con tests existentes: ejecutar baseline antes de propuestas nuevas.
3. Tests existentes suficientes: `NO_ADDITIONAL_TESTS_REQUIRED` sin duplicados.
4. Falta contexto funcional: `ACTION_REQUIRED`, Check y Focus Mode.
5. Respuesta humana revela inconsistencia: `BEHAVIORAL_MISMATCH` con expected/observed.
6. Corrección + `synchronize`: Run viejo `OBSOLETE`, Run nuevo reutiliza conocimiento válido.
7. Inconsistencia detectable sin humano: mismatch con regla ACTIVE recuperada.
8. Prueba generada inválida: `TECHNICAL_GENERATION_FAILURE`.
9. Baseline ya rojo: `BASELINE_FAILED`, sin atribuirlo a la propuesta.
10. Primer análisis de repo grande: `BOOTSTRAP` suficiente aunque el diff sea pequeño.
11. PR grande: filtrar símbolos, analizar impacto y dividir en batches según política configurable.
12. Solo docs/comments/format: `NO_TEST_RELEVANT_CHANGES`.
13. Impacto indirecto: incluir `POTENTIALLY_IMPACTED` con relación trazable.
14. Regla funcional desactualizada: solicitar decisión; superseder, no sobrescribir.
15. Nuevo HEAD durante espera humana: Run/pregunta viejos `OBSOLETE`, nueva evaluación.

## Seguridad y auditoría

Verificar firma sobre body crudo, estado de instalación/binding, correlación segura de callback y mínimo privilegio. Persistir delivery, lifecycle, preguntas/respuestas, reglas creadas/superseded, generación, ejecución, clasificación, Check y publicación sin guardar secretos, tokens o URLs firmadas completas.

## Fuera de alcance inicial

- soporte completo de fork PR;
- RBAC Owner/Maintainer/Reviewer;
- Mutation Score obligatorio;
- proveedor remoto del Sandbox;
- integración GitHub real o PHP completo dentro de T-001.

`DEC-MET-001`, `DEC-INF-001`, `DEC-VAL-001` y `DEC-EXP-FK-001` conservan sus blocks acotados y no bloquean esta baseline documental.
