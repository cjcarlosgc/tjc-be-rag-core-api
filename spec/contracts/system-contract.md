# Contrato canónico del sistema

**Versión del contrato:** SYSTEM-1.1  
**Fecha de corte:** 2026-09-05  
**Estado:** APROBADO salvo decisiones `PENDING` explícitas  
**Propietario canónico:** `tjc-be-rag-core-api/spec/contracts/system-contract.md`

Frontend y Sandbox conservan una copia espejo con la misma versión. Una copia local no puede redefinir este contrato; todo cambio coordinado se consolida primero en el propietario y actualiza los tres `CHANGELOG.md`.

## Componentes y llamadas permitidas

`tjc-fe-rag-developer-console -> tjc-be-rag-core-api -> tjc-be-test-execution-sandbox`

- Developer Console es el frontend/cliente web de referencia. Consume únicamente RAG Core.
- RAG Core es el backend principal: ingesta, indexación, retrieval/contexto, generación, experimento, orquestación, artefactos y métricas.
- Test Execution Sandbox es el backend de ejecución aislada. Consume snapshots/artefactos autorizados, ejecuta Jest/Vitest y devuelve hechos objetivos.
- El frontend nunca llama directamente al Sandbox. El Sandbox no consulta pgvector, no llama al LLM y no conoce la estrategia experimental.

## Alcance técnico compartido

- Los proyectos analizados y ejecutados en V1 son exclusivamente TypeScript (`.ts`/`.tsx`) con Jest o Vitest.
- La tesis puede describir el dominio como ecosistema JavaScript/TypeScript; esto no habilita JavaScript puro (`.js`, `.jsx`, `.mjs`, `.cjs`) en V1.
- Cada run se vincula a una `ProjectVersion` inmutable para que generación y validación utilicen exactamente el mismo snapshot.
- La web es cliente de referencia; plugins IDE, PR/CI-CD autónomo y otros lenguajes son evolución futura.

## Persistencia y almacenamiento

- RAG Core usa PostgreSQL + pgvector en Supabase para datos de dominio, chunks, embeddings y la cola DB-backed de jobs.
- El proveedor de objetos aprobado es Supabase Storage mediante `@supabase/supabase-js`, siempre detrás de una abstracción interna `ObjectStorageService` en los backends que lo consuman.
- Supabase Storage conserva snapshots y artefactos; PostgreSQL/pgvector no se sustituye por Storage.
- El navegador no recibe credenciales de Supabase ni accede directamente al bucket. Las credenciales del host Sandbox nunca se inyectan al container que ejecuta código de terceros.

## Experimento

- La comparación principal es `RAG` vs `GENERALIST_AGENT`.
- `GENERALIST_AGENT` explora el mismo snapshot mediante herramientas read-only controladas y decide qué referencias usar; no es un LLM aislado o sin contexto.
- RAG adquiere contexto mediante retrieval híbrido semántico + estructural y un `ContextBuilder` explícito.
- Ambos brazos comparten target, snapshot, familia/versión de LLM, parámetros comparables, Sandbox, runtime y reglas de validación. La tarea es equivalente, aunque las instrucciones de adquisición de contexto difieran.
- La evaluación principal es first-shot, con tres repeticiones por target/estrategia por defecto y autorreparación desactivada.
- El Sandbox es ciego: no recibe `RAG`, `GENERALIST_AGENT`, `BASELINE` ni conclusiones experimentales.
- Se registran métricas de resultado/tiempo/tokens/costo y trazas propias de adquisición: chunks para RAG y tool calls/archivos inspeccionados para el agente.
- No se adopta una ablación obligatoria semántico/estructural/híbrido ni una prohibición general de recuperar pruebas por supuesto leakage.

## Validación en empresa real

- La validación final usa el producto conectado en modo `live` en el área de desarrollo de una empresa real e independiente.
- Datos mock sirven solo para desarrollo/demostración y nunca pueden exportarse o contabilizarse como evidencia experimental o empresarial.
- Código, rutas, logs, diffs y artefactos se tratan como datos no confiables y potencialmente confidenciales.
- Antes de desplegar o ingerir un repositorio empresarial debe resolverse `DEC-VAL-001`: cuentas/entorno, acceso, autorización, tratamiento frente a proveedores externos, retención/eliminación y evidencia exportable.

## Disponibilidad al corte SYSTEM-1.1

- Core↔Frontend implementado: health, crear/consultar proyecto, iniciar/consultar indexación, resultados de `ProjectVersion` e inventario de tests.
- Core↔Frontend con contrato HTTP `INTEROP-1.0` aprobado: listado, generación, validación, artefactos y experimento; la implementación puede continuar pendiente o bloqueada por decisiones propias de cada feature.
- Core↔Sandbox aprobado semánticamente: reconstruir snapshot exacto, materializar artefactos finales, ejecutar en aislamiento y devolver evidencia estructurada.
- Core↔Sandbox HTTP/DTO aprobado en `INTEROP-1.0` como ejecución asíncrona `202 + polling`, con idempotencia, referencias verificables de Storage y resultado factual.

### DEC-INT-001 — Contrato de ejecución Core↔Sandbox

**Estado:** APROBADO

**Blocks:** NONE

**Resolución:** `INTEROP-1.0` define `POST /executions`, consulta de estado/resultado, `executionId`, `Idempotency-Key`, correlación, autenticación servicio-a-servicio, `StorageObjectRef`, estados, errores y evidencia. Los límites concretos permanecen configuración del Sandbox y no son controlables por el request.

### DEC-MET-001 — Mutation score y StrykerJS

**Estado:** PENDING

**Blocks:** únicamente un work item futuro que pretenda implementar mutation testing o promover mutation score a métrica experimental en cualquiera de los tres componentes; no bloquea HU19 ni el cierre del núcleo de Sprint 2

**Pregunta:** inmediatamente después del núcleo de Sprint 2, investigar viabilidad homogénea en proyectos TypeScript con Jest/Vitest, alcance, costo/tiempo, configuración de StrykerJS, aislamiento en Sandbox, contrato de resultados y presentación en frontend. Presentar el análisis para aprobación antes de diseñar o implementar.

### DEC-VAL-001 — Condiciones técnicas de validación empresarial

**Estado:** PENDING

**Blocks:** únicamente despliegue e ingestión/ejecución de la validación en empresa; no bloquea desarrollo, demo ni prevalidación local

**Pregunta:** antes de usar repositorios empresariales, definir entorno y propiedad de cuentas, acceso, autorización, tratamiento de código privado frente a proveedores externos, retención/eliminación y evidencia exportable sin filtrar información confidencial.

## Decisiones compartidas referenciadas

- `DEC-CHUNK-001`, `DEC-EMB-001`, `DEC-RAG-001` y `DEC-EXP-002`: propiedad de RAG Core; solo bloquean sus alcances declarados.
- `DEC-MET-001` y `DEC-VAL-001` viven en este contrato porque una resolución exige sincronizar los tres componentes.

## Regla de compatibilidad

Cada contrato local debe declarar la versión `SYSTEM-*` e `INTEROP-*` contra la que fue sincronizado. Una operación `PENDING` no se convierte en contrato por existir en un mock, un plan o un repositorio consumidor.
