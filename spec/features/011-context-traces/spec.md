# 011-context-traces — Especificación

**Estado:** implementado y revisado en T-004; suites unitarias y e2e aprobadas el 2026-09-24.
**Historias:** HU27, HU28

> **Nota SDD 2.1:** la variante de traza sobre `test-runs` (generación manual) queda retirada (`CHANGELOG.md`); `GET /experiments/{id}/context-traces` permanece vigente para HU27/HU28 sobre Experiments.

## Objetivo

Persistir y exponer evidencia navegable de cómo se adquirió el contexto de una generación, de modo que Developer Console pueda mostrar un único explorador con dos modelos semánticos distintos: contexto RAG y contexto observado por el agente generalista.

## Reglas y comportamiento

- Cada traza pertenece a una `ProjectVersion` inmutable, un `TestTarget` y una repetición de `ExperimentRun`; no se origina en `TestGenerationRun`. La ruta de generación manual y su variante de trazas quedaron retiradas en SDD 2.1.
- Cada repetición produce una traza `RAG` o `AGENT`, según su estrategia. Un experimento tiene hasta seis trazas: tres repeticiones por cada estrategia.
- Los listados devuelven solo el intento vigente por defecto; `includeSuperseded=true` permite auditar intentos anteriores cuando existan.
- La entrada principal lista las trazas del experimento y permite filtrar por estrategia y repetición. El contrato conserva `testRunId` y `artifactIds` por compatibilidad de DTO: para las trazas vigentes de Experiments, `testRunId` es `null` y `artifactIds` es una lista vacía.

### Contexto RAG — HU27

- Conservar el target raíz y todos los candidatos recuperados después de deduplicar por `chunkId`, incluidos seleccionados y descartados.
- Cada candidato registra señales `SEMANTIC`, `IMPORTS` o `IMPORTED_BY`, score semántico nullable, relación estructural nullable, score combinado, ranking, tokens y configuración efectiva de `ContextBuilder`.
- La decisión es `SELECTED` o `DISCARDED`. Un descarte declara exactamente `BELOW_MINIMUM_SCORE`, `TOP_K_LIMIT` o `TOKEN_BUDGET`; no se inventa una causa que el algoritmo no observó.
- El score explica el ranking configurado y no se presenta como probabilidad, confianza científica o prueba causal.

### Exploración del agente — HU28

- Conservar la secuencia cronológica observable de `list_files`, `search_text`, `inspect_symbol` y `read_file`, con número de paso, argumentos, estado, resumen, hash, truncamiento y observaciones normalizadas.
- `list_files` persiste el conjunto descubierto, pero el contrato principal devuelve solo el total; las rutas se consultan paginadas mediante “Mostrar descubiertos”.
- Resultados vacíos y errores se conservan como pasos `EMPTY`/`FAILED`; no se reclasifican como seleccionados o descartados.
- La etiqueta correcta es “contexto observado por el agente” o “contenido entregado al agente”. No se afirma que el agente “utilizó” una referencia ni se persiste o expone chain-of-thought.

### Fragmentos y reconstrucción

- Toda referencia de código normaliza path POSIX, símbolo y rango de líneas; conserva SHA-256, fragmento acotado y estado de truncamiento.
- El detalle entrega hasta tres líneas anteriores y posteriores cuando existan. Ese contexto circundante puede reconstruirse desde el snapshot congelado; no se duplican archivos completos en PostgreSQL.
- Los snippets, argumentos y resultados se tratan como datos potencialmente confidenciales y no se incluyen en logs ordinarios.

## Transporte

Las tres rutas y DTOs son los de `INTEROP-2.4`, sección 6.7: listado desde Experiments, detalle de traza y archivos descubiertos paginados. La autorización sigue el acceso Reader al Project del experimento. Una traza inexistente o no visible se responde como `CONTEXT_TRACE_NOT_FOUND`; consultar antes del estado terminal produce `CONTEXT_TRACE_NOT_FINISHED`.

## Fuera de alcance

- Visualizar razonamiento interno, mensajes ocultos del modelo o influencia causal.
- Exponer trazas desde `test-runs`, `TestGenerationRun` o artefactos de generación manual, retirados en SDD 2.1.
- Reemplazar las métricas experimentales agregadas; las trazas las complementan.
- Hacer test-aware retrieval mientras `DEC-RAG-001` permanezca `PENDING`.
