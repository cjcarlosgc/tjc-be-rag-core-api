# Revisión independiente WI-CORE-082 (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: CHANGES_REQUESTED** (correcciones menores/moderadas al entregable; sin bloqueantes de alcance ni de seguridad).
Entregable revisado: `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` (sin commit). Revisor independiente del autor (sdd-analyst).

## 1. Alcance y gates
- `git status`: solo el entregable sin seguir; `git diff 3f9aaf6~1..HEAD --stat -- app spec/contracts referencias` vacío. No toca `app/`, contratos, esquemas ni `referencias/`. Sin números de IOE ni corridas oficiales (OK).
- Validadores desde la raíz: `sdd-check` OK; `validate-work-items` OK (82 WI); `validate-harness` OK; `validate-completions` OK (78).

## 2. Citas de la tesis (OK)
- Las 10 citas cortas del Anexo E (Tabla 52, líneas 2217-2226) existen tal cual (C-01 «fijar repositorio/PR/HEAD», C-02 «alcance de validación separado…», … C-10 «Core consume puertos…»).
- Tabla 54 (línea 2253; checklist con comprobación directa/inversa y N/A justificado de enlaces 7-9), Tabla 55 (M1=0, M2=0, M3=100%), Tabla 56 («Evidencia mínima: CT/checklist, ADR-01–10, ESC-MOD-01, trace y acta»), IOE1.1 (línea 533) y ESC-MOD-01 existen y están bien resumidos.
- Matiz: la Tabla 54 sí tiene columna «Evidence ID» (checklist). El reporte dice «La tesis no dice dónde se registra la evidencia CT»: es cierto para CT-01…CT-10, pero conviene precisar que el checklist sí la tiene (F-9).

## 3. Pruebas existentes: verificación
Archivos: todos existen (`ls`). Los 6 `*.pg.spec.ts` existen (jobs, context-traces, evidence-persistence-migration, analysis-trace, retrieval-comparisons, evidence). Sandbox: `executions.contract-real.spec.ts` (T9 existe), `core-client.contract.spec.ts` (`describe.skipIf(!CORE_AVAILABLE)`, cierto), Integration: `github-webhook-normalizer.spec.ts` y `github-webhook-core-client.spec.ts` existen.

| Aserción | Resultado |
|---|---|
| CT-06-A1 (`sandbox-execution.contract.spec.ts`) | OK |
| CT-06-A2 («never sends functional rules…», línea 666) | OK |
| CT-06-A3 (ninguna explícita) | OK (afirmación correcta) |
| CT-06-A4 (`returns the executionId accepted…`, línea 512) | OK pero subdeclarado: existe prueba directa de execution_id; «queda asociada al Run» sí es lo que falta |
| CT-06-A5 | Cubre menos de lo dicho: T9 (perfil no soportado → 400) y T5 (job inválido) están en Sandbox; la resiliencia de Core reintenta solo GET de estado/resultado y **el POST no se reintenta** (`resilience.spec` línea 62). «Infraestructura no disponible → error reintentable» solo vale para el sondeo; para el POST es `SandboxUnavailableError` no reintentado (F-6) |
| CT-07-A1 | OK (`sandbox-execution.contract.spec.ts` COMPLETED/FAILED; `sandbox-evidence-facts.spec.ts`) |
| CT-07-A2 | OK (título exacto) |
| CT-07-A3 | OK (COMPILATION, TEST_ASSERTION, TEST_RUNTIME presentes) |
| CT-07-A4 | Afirmación correcta (sin aserción explícita); la ruta citada `executions.contract.spec.ts` existe en Sandbox |
| CT-07-A5 | OK; el describe ya se llama «CT-07 Sandbox → Core (cliente real)» y existe también «CT-06 Core (cliente real) → Sandbox» (falta mencionar que el Sandbox ya nombra CT-06/CT-07) |
| CT-08-A1 | OK en fondo; el nombre citado «cadena completa» NO existe: el it real es «returns the full chain for the DIRECTLY_CHANGED METHOD/FUNCTION targets…» (línea 66). El it pg «builds the INTEROP §6.16 chain…» sí existe |
| CT-08-A3 | OK (tests de NOT_APPLICABLE líneas 217, 237) |
| CT-08-A5 | OK: `409 EVIDENCE_NOT_FINISHED` es el código real (`interoperability-contract.md` 1235; test línea 255); PRESENT/STALE cubiertos (líneas 200, 279, 294) |
| CT-01-A2 | OK (401 para ausente/inválido, 503 sin credencial; «401/403» es impreciso: es 401) |
| CT-01-A3 | OK (202 / 200 duplicado; redelivery en service.spec) |
| CT-01-A1 / A4 | Parcial correcto |
| CT-02-A1 | OK razonable (describe «snapshot persistence», `recordSnapshot`) |
| CT-02-A3 | Parcial correcto; «no actualiza índice ni genera targets» no está probado |
| CT-02-A4 | No cubre: el extractor (`TestTargetExtractorService`) está en `src/project-versions/inventory/` (la ruta del reporte omite `project-versions/`) y sus its solo prueban exportados/no exportados, no «target no resoluble». Ninguna prueba cubre el estado explícito; «parcial» es generoso |
| CT-03-A1, A2 | OK (títulos exactos) |
| CT-03-A4 | Mal atribuida a C-03: cita `context-builder.service.spec.ts` (frontera C-05). `RetrievalService` no tiene prueba de orden/ranking. Tal como está redactada para C-03 es «no cubre» y duplica CT-05-A2 (F-4) |
| CT-03-A5 | OK (título exacto del pg) |
| CT-04-A1 | OK |
| CT-04-A3 | OK (`submitAnswer`: 403 `PROJECT_ROLE_INSUFFICIENT`, incluido UNKNOWN) |
| CT-04-A4 | OK parcial (evaluator, continuation handler, `listActionRequired`) |
| CT-05-A1, A2 | OK (títulos exactos) |
| CT-05-A4 | OK; el describe tiene 4 it, no 3 |
| CT-05-A6 | OK (pg «links the context_id into a proposal…»; `context-traces.repository.spec.ts` existe) |
| CT-09-A1, A2 | OK (títulos exactos del spec) |
| CT-10-A1 | Cubre menos de lo dicho: el spec prueba el adapter Supabase, no que Core consuma solo `ObjectStorageService` (eso es el test de arquitectura de A5) |
| CT-10-A2 | Cubre menos: `openai-embedding.provider.spec.ts` tiene 2 it (orden y lotes); no prueba «se consume vía EmbeddingProvider» ni errores |
| CT-10-A3 | OK (6 pg, CI WI-CORE-081 con filtro `.pg.spec.ts`) |

### Conteos
- Filas por contrato: 5+4+6+5+6+5+5+6+5+5 = **52 (correcto)**.
- Cubiertas (Falta = ninguno con prueba existente): 2+1+3+2+4+3+3+3+2+2 = **25 (correcto)**, aunque con la corrección de F-3 (CT-10-A1/A2 «cubre menos») y F-4 (CT-03-A4) el total real defendible baja a 22.
- Parciales: la columna «(+N parciales)» suma **5** (CT-01 +2, CT-02 +2, CT-04 +1), no 6. Las filas que dicen «parcial» en texto son 7 (CT-01-A1/A4, CT-02-A3/A4, CT-06-A4, CT-10-A4, y CT-04-A4 «S»). El criterio no es reproducible (F-1).

## 4. Hallazgos y correcciones exactas

| ID | Gravedad | Dónde | Qué está mal | Qué debe decir |
|---|---|---|---|---|
| F-1 | Media | Tabla resumen y línea 149 | «6 parciales» no cuadra con la columna (suma 5); falta definir criterio; CT-06 y CT-10 tienen filas «parcial» no contadas | Definir «cubierta = existe prueba y Falta = ninguno; parcial = existe prueba que cubre una parte» y agregar columna «Parciales» por CT; recalcular totales (con F-3/F-4: 22 cubiertas) |
| F-2 | Media | CT-08-A2, CT-08-A4 | Prometen «recorrido inverso» y «enlace faltante/inconsistente marcado explícitamente» como si fueran solo pruebas faltantes (M, Auto). Core no lo hace: el trace solo expone `PRESENT`/`NOT_APPLICABLE` (`analysis-run-trace.service.ts`) y no hay estado de enlace faltante/inconsistente ni consulta inversa. Son procedimientos del checklist de la tesis (Tabla 54, comprobación inversa, registro de faltantes) | Reclasificar como `Man` (checklist sobre Run real, junto a A6) o declarar «requiere funcionalidad nueva (no existe), decisión del usuario»; no «Auto, esfuerzo M». Añadir decisión nueva: ¿la comprobación inversa/faltante es manual (script/checklist) o hay que añadir capacidad a Core? |
| F-3 | Media | CT-10-A1, CT-10-A2 | Marcadas «ninguno» pero las pruebas citadas solo prueban el adapter, no el consumo vía puerto | Existente: «adapter (parcial); consumo vía puerto: ver A5»; Falta: S |
| F-4 | Media | CT-03-A4 | Prueba de ContextBuilder atribuida a C-03 (Retriever→Context Builder) y duplicada con CT-05-A2; `RetrievalService` no tiene prueba de orden por score | Reescribir: «los candidatos de `RetrievalService` vienen con score/ordenados de forma determinista» con Existente «ninguna en `retrieval.service.spec.ts`», Falta S; o eliminarla y que el recorte quede en CT-05-A2. Alinear con la recomendación de D-4 |
| F-5 | Baja | CT-02-A4 | Ruta `inventory/test-target-extractor.service.spec.ts` incorrecta y «parcial» generoso | Ruta `src/project-versions/inventory/test-target-extractor.service.spec.ts`; Existente: «ninguna cubre target no resoluble (UNRESOLVABLE_TARGET lo lanza `RetrievalService`, no el análisis)»; Falta M. Aclarar dónde ocurre el estado explícito |
| F-6 | Baja | CT-06-A5 | «infraestructura no disponible → error reintentable» no vale para el POST (no se reintenta); T9 y T5 son del Sandbox | «Perfil no soportado/job inválido → 400 (Sandbox, T9/T5); fallo transitorio del sondeo → reintento (Core resilience); fallo del POST → `SandboxUnavailableError` sin reintento» |
| F-7 | Baja | CT-08-A1, CT-05-A4, CT-01-A2 | Nombres imprecisos: «cadena completa» no existe (real: «returns the full chain…»); «(3 it)» son 4; «401/403» es 401 | Corregir los tres textos |
| F-8 | Baja | CT-08-A3 | «Enlaces 7-9 N/A» es lo que dice la tesis, pero el código también marca N/A retrieval/contexto/generación (Run en ACTION_REQUIRED, `interoperability-contract.md` 1238) | Anotar que la aserción solo exige 7-9 N/A por la tesis, y que el contrato vigente admite N/A en enlaces 4-9 si el Run termina antes (decisión menor para el usuario o nota) |
| F-9 | Baja | Línea 6 | «La tesis no dice dónde se registra la evidencia CT» sin matiz | Añadir: «Tabla 54 sí tiene columna Evidence ID para el checklist; para CT-01…CT-10 no» |
| F-10 | Baja | D-8 | No es decisión genuina del usuario: la Tabla 56 ya exige «Registrar SHA» de los repos integrados y el spec del Sandbox ya omite sin Core; el analista podía resolverlo | Reducir a nota/recomendación dentro de CT-07-A5 (o mantenerla como confirmación, marcada «menor») |

Decisiones D-1…D-7, D-9, D-10: genuinas (D-1 evidencia, D-2 discrepancia tesis↔código, D-3 formato CHANGESET/INDEX DELTA, D-4 propiedad del ranking, D-5 «contexto insuficiente», D-6 «puerto», D-7 «sin autoridad», D-9 Runs reales, D-10 baseline ESC-MOD-01); las recomendaciones son coherentes con tesis y código (D-4 solo requiere ajustar CT-03-A4 según F-4; D-7 podría apoyarse en que FK ya filtra `ACTIVE`).

## 5. Discrepancias tesis↔código
Verificadas y bien descritas: C-01 (Core recibe evento interno con bearer; confirmado en controller.spec), C-03/C-05 (ranking/recorte en ContextBuilder), «contexto insuficiente» (sin definición ni test en Core; `grep` sin coincidencias), C-10 («puertos» vs Prisma/SQL directo; 59 archivos importan Prisma/cliente). `from 'openai'` solo en `providers/` (CT-09-A4 y CT-10-A5 viables como test de arquitectura). Faltó señalar C-08: inversa/enlace faltante no existe en Core (F-2).

## 6. Resultado
- status: CHANGES_REQUESTED
- Blockers: ninguno. Sin decisión abierta que impida la corrección; las nuevas decisiones de F-2 pasan al usuario cuando apruebe la propuesta.
- Esperar corrección del autor (ciclo 2 de 2 como máximo).

## Ciclo 2 de 2
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto final: APPROVED** (con una observación baja, no bloqueante).

1. Correcciones F-1…F-10: todas aplicadas y ciertas. Verificado: rutas (`project-versions/inventory/…`, `executions.contract-real.spec.ts`, `executions.contract.spec.ts` existen); `TraceLinkStatus = 'PRESENT' | 'NOT_APPLICABLE'` (`analysis-run-trace.response.ts`); 401 del controller para bearer ausente/inválido; `postJson` no pasa por `withTransientRetries` (solo el sondeo lo usa) y la prueba «el POST de creación no se reintenta» fija 1 llamada; T9 (perfil) y T5 (400 de validación) existen en Sandbox; it «returns the full chain…» existe; CT-05-A4 cita 4 it.
2. Totales: filas contadas con el criterio definido; columnas suman 22 cubiertas, 13 parciales, 17 sin cobertura = 52 y coinciden con la clasificación por fila. Observación baja (O-1): CT-10-A3 figura como cubierta aunque su «Falta» es «S (aportar evidencia de corrida en CI)», lo que por el criterio escrito («Falta = ninguno») sería parcial (22→21 y 13→14); aclararlo o cambiar la fila. No cambia el veredicto.
3. Aserciones nuevas/reescritas (CT-03-A4, CT-05-A5, CT-08-A2/A3/A4, CT-06-A5, CT-09-A3/A5, CT-10-A1/A2): verificables y alineadas con el comportamiento real; las que requieren funcionalidad inexistente (CT-05-A5, CT-08-A2/A4) lo declaran. D-11 es una decisión genuina del usuario. La sección «Decisiones tomadas por el usuario» recoge D-1, D-5 y D-10 como se indicaron. No hay afirmaciones nuevas falsas.
4. Alcance: `git diff 3f9aaf6~1..HEAD --stat -- app spec/contracts referencias` vacío; solo hay archivos sin seguir en `harness/reports/`. Los 4 validadores en verde (sdd-check; work-items 82; harness V3; completions 78).
