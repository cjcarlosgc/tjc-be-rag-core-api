# 011-context-traces — Especificación

**Estado:** aprobado para implementar.
**Historias:** HU27, HU28

## Objetivo

Persistir y exponer evidencia navegable de cómo se adquirió el contexto de una generación, de modo que Developer Console pueda mostrar un único explorador con dos modelos semánticos distintos: contexto RAG y contexto observado por el agente generalista.

## Reglas y comportamiento

- Cada traza pertenece a una `ProjectVersion` inmutable, un `TestTarget` y un intento lógico. Puede originarse en un target de `TestGenerationRun` o en una repetición de `ExperimentRun`, nunca en ambos.
- Una generación normal produce una traza `RAG` por target procesado. Un experimento produce una traza `RAG` o `AGENT` por estrategia/repetición.
- Un retry manual crea un nuevo intento y conserva los anteriores. Los listados devuelven solo el intento vigente por defecto; `includeSuperseded=true` permite auditar el historial.
- La entrada general de un run lista todos sus targets. La entrada desde un artefacto filtra las trazas asociadas a los targets materializados en ese archivo; `ArtifactResponse.targetIds` hace explícita esa relación.

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

Las rutas y DTOs son los de `INTEROP-2.0`, sección 6.7, y deben adaptarse a AnalysisRun/HEAD al implementar HU27-HU28. Un trace inexistente o ajeno al propietario se responde como `CONTEXT_TRACE_NOT_FOUND`; consultar antes del estado terminal produce `CONTEXT_TRACE_NOT_FINISHED`.

## Fuera de alcance

- Visualizar razonamiento interno, mensajes ocultos del modelo o influencia causal.
- Reemplazar las métricas experimentales agregadas; las trazas las complementan.
- Hacer test-aware retrieval mientras `DEC-RAG-001` permanezca `PENDING`.
