# Product Backlog de la solución

**Estado:** catálogo de producto aprobado para Core y Console. La homologación con Sandbox queda pendiente mientras ese repositorio está a cargo de otro desarrollador.

Este catálogo fija seis épicas y dieciocho historias orientadas a valor. Las historias son transversales; no son unidades de commit ni equivalen uno a uno a un work item. La tesis aporta la estructura de planificación S1–S4, pero el comportamiento implementable se decide en las specs y contratos vigentes. No se crean automáticamente nuevas épicas o HU a partir de ideas, hallazgos o tareas técnicas.

## Épicas fijas

| ID | Épica | Resultado de producto |
| --- | --- | --- |
| EP01 | Projects | Gestionar proyectos y repositorios autorizados. |
| EP02 | Repository Intelligence | Comprender código, pruebas existentes, contexto e impacto. |
| EP03 | Functional Knowledge | Capturar, reutilizar y mantener intención funcional bajo autoridad humana. |
| EP04 | Generation & Validation | Generar y validar pruebas con evidencia. |
| EP05 | PR Workflow | Integrar análisis, revisión y publicación en el flujo real de PR. |
| EP06 | Experiments | Comparar enfoques sobre entradas y condiciones reproducibles. |

Las épicas son categorías estables, no objetos con un estado `PLANNED`. Su progreso se infiere de sus HU y work items.

## Historias de usuario fijas

`H-READY` significa que alcance, criterios y dependencias están suficientemente claros para seleccionar trabajo; no significa que la HU ya esté implementada. `H-DONE` exige evidencia del incremento completo, no solo un work item. Las 18 HU inician prudentemente en `H-BACKLOGGED`: la implementación con IDs antiguos no se toma como aceptación automática.

| HU | Épica | Sprint de referencia | Prioridad | Estado | Historia y criterio principal |
| --- | --- | --- | --- | --- | --- |
| HU01 | EP01 | S1 | Must | H-BACKLOGGED | Como responsable de proyecto, necesito registrar y gestionar un proyecto para centralizar análisis y resultados. Un usuario autorizado puede crearlo y consultar su estado estable. |
| HU02 | EP01 | S1 | Must | H-BACKLOGGED | Como responsable de proyecto, necesito vincular un repositorio GitHub autorizado para analizar cambios del equipo. El binding y la rama de integración son verificables y revocables. |
| HU03 | EP02 | S1 | Must | H-BACKLOGGED | Como desarrollador, necesito comprender elementos y relaciones del repositorio para recuperar su estructura técnica. El índice liga archivos, símbolos, relaciones, chunks y embeddings al commit. |
| HU04 | EP02 | S1 | Must | H-BACKLOGGED | Como desarrollador, necesito identificar tests asociados a los componentes para evitar redundancias. La asociación con símbolos conserva evidencia. |
| HU05 | EP02 | S2 | Must | H-BACKLOGGED | Como desarrollador, necesito recuperar contexto técnico relevante para alimentar la generación. Retrieval combina evidencia semántica y estructural y registra sus candidatos. |
| HU06 | EP02 | S3 | Must | H-BACKLOGGED | Como desarrollador, necesito identificar elementos modificados y potencialmente afectados para enfocar el análisis. El changeset distingue impacto directo e indirecto con traza. |
| HU07 | EP03 | S3 | Must | H-BACKLOGGED | Como desarrollador, necesito reutilizar reglas funcionales vigentes para evitar preguntas repetidas. Una regla ACTIVE aplicable entra en el contexto del Run. |
| HU08 | EP03 | S3 | Must | H-BACKLOGGED | Como usuario autorizado, necesito responder una aclaración funcional para continuar el análisis. Si el HEAD sigue vigente, continúa el mismo Run y se registra la autoridad de la respuesta. |
| HU09 | EP03 | S4 | Should | H-BACKLOGGED | Como responsable de proyecto, necesito actualizar reglas obsoletas o conflictivas para no usar conocimiento inválido. La regla reemplazada pasa a SUPERSEDED. |
| HU10 | EP04 | S2 | Must | H-BACKLOGGED | Como desarrollador, necesito generar pruebas con contexto recuperado para reducir omisiones y redundancias. El resultado incluye candidatas o declara que no se necesitan más. |
| HU11 | EP04 | S2 | Must | H-BACKLOGGED | Como desarrollador, necesito validar las candidatas en Sandbox aislado antes de incorporarlas. La ejecución devuelve evidencia sin credenciales GitHub. |
| HU12 | EP04 | S2 | Must | H-BACKLOGGED | Como desarrollador, necesito consultar la evidencia de generación y validación para comprender un Run. El detalle muestra diff, contexto, logs, estado y trazabilidad. |
| HU13 | EP04 | S3 | Must | H-BACKLOGGED | Como desarrollador, necesito distinguir fallos técnicos de posibles discrepancias de comportamiento. Un test respaldado por regla vigente puede clasificarse BEHAVIORAL_MISMATCH sin autoreparar su aserción. |
| HU14 | EP05 | S3 | Must | H-BACKLOGGED | Como desarrollador, necesito analizar automáticamente un PR para recibir validación en el flujo habitual. Un HEAD nuevo crea otro AnalysisRun y vuelve obsoleto al previo. |
| HU15 | EP05 | S4 | Must | H-BACKLOGGED | Como desarrollador, necesito recorrer la relación entre cambio, contexto, prueba y ejecución. Trace enlaza changeset, símbolos, contexto, test y evidencia. |
| HU16 | EP05 | S4 | Should | H-BACKLOGGED | Como desarrollador, necesito revisar y publicar pruebas por un companion PR. Una propuesta vigente aprobada crea rama y PR controlados, nunca un merge autónomo. |
| HU17 | EP06 | S4 | Must | H-BACKLOGGED | Como investigador, necesito comparar RAG con GENERALIST_AGENT bajo condiciones equivalentes. Ambos brazos comparten snapshot, target y entorno y guardan resultados por trial. |
| HU18 | EP06 | S4 | Could | H-BACKLOGGED | Como investigador, necesito capturar el siguiente PR elegible para evaluar enfoques sobre un cambio real. La captura se desarma al reservar el Run y no publica Checks experimentales. |

El texto del criterio es un resumen; la aceptación detallada vive en la feature correspondiente. Los sprints son referencias de planificación, no prueba de que una historia esté aceptada o terminada. En particular, trabajo implementado bajo IDs antiguos debe reauditarse antes de marcar una HU `H-DONE`.

## Relación con ejecución

`EP → HU → T (subtarea técnica en tasks.md) → WI (work item local al repositorio)`. La relación T→WI es muchos-a-uno o uno-a-uno según el corte; toda subtarea que se implemente declara al menos un WI. Un WI puede cubrir más de una HU si el corte es coherente. Los IDs de HU son globales; los WI se registran y validan en su repositorio. Core, Console, Sandbox y GitHub Integration tienen WIs propios. No se crea un WI de Sandbox en Core para simular trabajo del compañero.

Una idea nueva entra como `I-BACKLOGGED` sin alterar estas 18 HU; al seleccionarla se encaja en una HU existente o se solicita una decisión explícita de cambio de alcance. Retirar una funcionalidad se planifica como subtarea/WI con criterios de eliminación y de preservación de datos, no se borra silenciosamente una HU ya aceptada.

## Prioridad inmediata de la reorientación

1. P0: alinear SDD, Harness y contratos de Core/Console; retirar carga manual ZIP y descarga legacy de artefactos del producto, preservando snapshot ZIP interno y evidencia persistida.
2. P1: extraer toda interacción con GitHub desde Core a `tjc-be-github-integration-api`, por cortes contractuales y con reutilización de código.
3. P2: formalizar OC01–OC15 y sus subcasos en specs con trazabilidad a HU, comenzando por happy paths; el registro preliminar está en `spec/operational-cases.md`.
4. Diferido: homologar Sandbox cuando el usuario recupere ese repositorio. Mutation testing está descartado para este alcance, no es un work item activo.
