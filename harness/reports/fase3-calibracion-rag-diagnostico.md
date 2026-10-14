# Fase 3 — Diagnóstico de calibración de la arquitectura RAG (solo lectura; sin implementar; sin LLM)

Fecha: 2026-10-14. Origen: Cross (Jean: afinar RAG «sin salirnos de la tesis ni del paper» y luego pilotos nuevos). Datos: SELECT de solo lectura (incluye consultas pgvector sobre la base real, sin generar embeddings ni llamar al LLM), código de `app/src/` y los replays WI-056/057/058 y Fase 2 #1. **Nada de esto está implementado.** Cada cambio exige aprobación de alcance de Jean en el chat de Core. Fijado por la tesis (según Cross): SE = semántico + R-PHP1..R-PHP5, pesos 0.7/0.3, k=10 principal / k=5 secundario (OE2); GENERALIST_AGENT read-only sin retriever/Context Builder/FK; VT/CF/CO. Lo fijado no se propone cambiar.

## 1. Modelo efectivo de los experimentos nuevos

- Cómo se resuelve: `resolveEffectiveConfig()` (`app/src/providers/openai-llm.provider.ts:~148-195`) lee `EXPERIMENT_LLM_MODEL` y `EXPERIMENT_LLM_REASONING_EFFORT` del entorno, busca el modelo en `LLM_SUPPORTED_COMBINATIONS` y exige que el esfuerzo esté en la intersección `efforts ∩ toolEfforts`; se persiste en `experiment_runs.modelConfig` y ambos brazos lo reutilizan (`experiment-job.handler.ts:412-417`).
- Con `EXPERIMENT_LLM_MODEL=gpt-5.4-nano` y `…EFFORT=none`, el modelo efectivo será **gpt-5.4-nano / none** **si y solo si** `LLM_SUPPORTED_COMBINATIONS` de Render incluye `gpt-5.4-nano` con `none` en `efforts` y `toolEfforts`. Si no, `POST /experiments` responde 422 `REASONING_EFFORT_UNSUPPORTED` (no hay degradación silenciosa).
- Evidencia: los experimentos del 13-oct con `gpt-5.4-nano/none` (07b20829, 924e38ab) se crearon en Render, así que esa combinación estuvo admitida entonces. **No verificable desde Core** que la variable actual de Render siga incluyéndola (no tengo acceso a las variables de Render). Verificación sin gasto: el `modelConfig` del primer experimento nuevo en el momento de crearse (la creación valida la configuración antes de encolar).

## 2. Perillas propuestas por Jean

Datos reales: `text-embedding-3-small`, 1 536 dimensiones, pgvector 0.8.2, **sin índice vectorial** (búsqueda exacta), consulta `1 - (embedding <=> ancla)`, `ORDER BY embedding <=> ancla LIMIT 20` (`code-chunks.repository.ts:141-164`). Normas L2 de los 1 711 embeddings: mín 0.9994, media 0.99998, máx 1.0005 (≈ unitarios).

| Perilla | ¿Fijada por la tesis? | Evidencia | Efecto esperado | Calibrable offline sin LLM | Recomendación |
|---|---|---|---|---|---|
| **Métrica de distancia** (coseno / euclídea / Manhattan) | El «semántico» es similitud coseno (`semanticScore = 1 − <=>`); cambiarla altera la definición del score 0.7·sem | En 7 anclas de los pilotos: orden top-20 por `<->` (L2) **idéntico** al coseno en 5/7 (en 2/7 difiere solo en posiciones de empate fino por norma ≠ 1 exacta); `<+>` (L1) comparte **9–10 de los 10** primeros y 5/5 de los 5 primeros, y 19–20/20 del pool | Coseno ≡ euclídea en orden (vectores unitarios: d² = 2 − 2·cos). L1 mueve 0–1 chunk del top-10 | Sí (consultas pgvector, 0 LLM) — ya medido | **No cambiar**: ganancia nula (L2) o ruido (L1), y L1 rompe la semántica del score [0,1] y la comparabilidad con V1 |
| **Top-K del contexto** (10) | **Sí** (k=10 principal, k=5 secundario en OE2) | `topK=10` en las 54 trazas V1 | — | — | **No proponer** |
| **Top-K vectorial del pool** (20) | Probablemente (Cross cita «top-20 semántico»; `DEFAULT_VECTOR_TOP_K`) | pool de 20–23 candidatos; el colaborador perdido (RenewalDatePolicy) estaba en rank 15 del pool | Subirlo solo añade candidatos de baja similitud | Sí (replay) | **No proponer** (fijado) |
| **Presupuesto de tokens del contexto** (`maxContextTokens`=8 000) | No explícito en lo que dice Cross; es de producto | Contexto real 383–797 tokens en los 9 casos (≤10 % del tope); nunca hubo `TOKEN_BUDGET` | Subir no cambia nada; bajar a <800 empezaría a descartar chunks relevantes | Sí | **Sin efecto**: dejar; no es la causa de ningún fallo |
| **minimumScore** (0) | No | `min combined` del top-10 por caso: 0.247–0.464; candidatos solo estructurales puntúan exactamente 0.300 (sem=null) | Cualquier umbral ≥0.30 eliminaría candidatos solo-estructurales (R-PHP) y contradice SE; umbral <0.25 no filtra nada | Sí | **No proponer**: o no hace nada o rompe R-PHP |
| **Pesos 0.7/0.3** | **Sí** | — | — | — | No proponer |

## 3. Perillas de mayor impacto que NO contradicen la tesis (propuestas del Core)

Evidencia agregada de los 9 casos V1 + verificaciones del 13/14-oct (n pequeño, no oficial).

1. **Convenciones PHPUnit en el prompt de generación** (alto impacto, bajo riesgo). Fallos observados que no son de recuperación: (a) `assertSame` sobre objetos de valor (`DateTimeImmutable`): 951a7bb2 RAG rep2 y rep3 — «Failed asserting that two variables reference the same object» (`assertSame($expectedNextDate, $subscription->nextBillingAt())`; debía ser `assertEquals`); (b) mock de clases `final` (ya mitigado para RAG por WI-058; el agente 4/6); (c) namespaces inventados (mitigado por WI-057). El prompt PHP actual (`prompt-builder.service.ts:buildPhp`) solo da: PHPUnit 11, `use` de FQCN, `TestCase`. Propuesta: 3–4 líneas de convención (comparar objetos de valor con `assertEquals`, `assertSame` solo para escalares/identidad; no crear dobles de clases `final`: instanciarlas; usar solo FQCN de la sección de dependencias y del contexto). **Roza**: el prompt es el mismo para ambos brazos solo si se aplica también al agente; el paper debe declarar la plantilla (verificar si el protocolo la congela). No toca SE, ranking ni métricas.
2. **Composición del texto a embeber** (impacto medio, requiere reindexar). Hoy se embebe `chunk.content` crudo (`snapshot-analysis-job.handler.ts:323-324`), sin ruta ni nombre calificado: el método `renew` se parece más a `Subscription.*` que a `RenewalDatePolicy` (sem 0.46, rank 15). Prefijar `Clase\FQCN::método` y `filePath` podría acercar colaboradores semánticamente. **No medible sin embeddings nuevos** (llamadas baratas a la API de embeddings, no LLM generativo) y exige una ProjectVersion nueva. **Roza** la definición de «semántico» (no la fija la tesis en lo que Cross cita; verificar). Recomendación: evaluar offline con un conjunto pequeño antes de proponer.
3. **Ruido de tests de clase en el top-10** (impacto medio). Evidencia: en SAL-3 y RES-3 4/10 chunks son pruebas del proyecto (clase de test + métodos, `IMPORTED_BY`); en el resto 0/10. Deduplicar la clase de test frente a sus métodos o limitar a 1 prueba de estilo **cambia la selección = ranking** → decisión de Jean (DEC-RAG-001 PENDING). No proponer sin esa decisión.
4. **Inflación por miembro** (R-PHP1 etiqueta todos los miembros): ya diagnosticada en `fase2-01-…` (V2); también DEC-RAG-001.
5. **Orden/deduplicación del Context Builder**: sin defecto observado; el orden es por score. Nada que proponer.
6. **Defectos restantes** (backlog): IDEA-031 (atributos PHP 8/alias en el resolutor de dependencias), IDEA-032 (acotar lista de ambiguos), IDEA-033 (`promptSha256` nulo si falla la generación), falso positivo de R-PHP3 por literales de cadena (SAL-3 en V1 del replay). Sin impacto en V1.
7. **Reglas funcionales (FK)**: si el código viola una regla ACTIVE, RAG «falla» por diseño (exp. 2 Voucher); es resultado, no defecto. No tocar.

## 4. Método anti-sobreajuste

- **Calibración**: 9 casos V1 (SAL-1..3, RES-1..3, SUB-1..3) + verificaciones no oficiales (951a7bb2, 656140e5, cad591d6, 5852aeb4, c9948c77, 9a905b5a) **solo para calibrar**; **evaluación**: pilotos nuevos (otro corte, otro protocolo) que no se usan para decidir perillas.
- **Métricas offline sin LLM** (replay): (M1) presencia de tipos colaboradores en el top-10 y en la sección de dependencias; (M2) relevancia del contexto con la guía R1–R5 de la tesis (rúbrica manual sobre los chunks seleccionados); (M3) ruido: % de tokens de pruebas ajenas y de miembros no referenciados; (M4) tokens extra por caso; (M5) estabilidad: solape top-10 vs línea base (debe ser 10/10 para cambios que no deben mover ranking); (M6) fallos técnicos previstos por tipo (mock de `final`, namespace) detectables por reglas estáticas sobre el prompt.
- **Congelar antes del piloto nuevo**: pesos 0.7/0.3, k=10, pool vectorial 20, métrica coseno, minimumScore=0, presupuesto 8 000, relaciones R-PHP1..5, herramientas del agente; **y declarar** la versión del prompt PHP, del resolutor de dependencias (WI-057/058) y de `inspect_symbol` (WI-059).
- Criterio de aceptación de cualquier cambio: no pierde ningún tipo colaborador de la línea base; M5 sin regresión salvo cambio aprobado; tokens ≤ +15 %.

## 5. Frases de aprobación listas para Jean (pegar en el chat de Core)

**F3-A (convenciones PHPUnit en el prompt, ambos brazos):** «Apruebo el alcance del WI de Fase 3 A: añadir al prompt de generación PHP (RAG y agente generalista) instrucciones de convención PHPUnit (comparar objetos de valor con `assertEquals`, no crear dobles de clases `final`, usar solo FQCN del contexto y de la sección de dependencias), sin modificar el ranking, las relaciones R-PHP ni los pesos; con prueba rojo→verde y replay offline; sin push ni despliegue sin mi orden.»

**F3-B (harness de calibración offline, sin producto):** «Apruebo el alcance del WI de Fase 3 B: construir en `harness/` un replay de calibración offline sobre los 9 casos V1 y las verificaciones (métricas M1–M6) para evaluar cambios candidatos sin LLM, sin tocar `app/`; sin push ni despliegue sin mi orden.»

**F3-C (texto a embeber; solo evaluación offline):** «Apruebo el alcance del WI de Fase 3 C: evaluar offline, con embeddings nuevos de un conjunto pequeño (sin LLM generativo y sin tocar producción), si prefijar el nombre calificado y la ruta al texto a embeber mejora la presencia de colaboradores en el top-10; sin implementar en producción sin una decisión posterior mía.»

Modelo: Claude Sonnet 5.5 (diagnóstico, sin cambios en `app/`).
