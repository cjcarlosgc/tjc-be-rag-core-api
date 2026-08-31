# Product Backlog global

**Estado:** línea base preliminar SDD 1.0

Este backlog es compartido conceptualmente por los tres repositorios. Cada SDD local indica su participación concreta. La numeración expresa trazabilidad y orden lógico, no ejecución estrictamente secuencial.

## Épicas

- **EP01 — Gestión e indexación versionada de proyectos**
- **EP02 — Generación RAG de pruebas unitarias**
- **EP03 — Seguimiento y validación automática**
- **EP04 — Artefactos, diff y descarga**
- **EP05 — Evaluación experimental RAG vs baseline**
- **EP06 — Historial, tiempo real y resiliencia**
- **EP07 — Experiencia de producto**

## Historias

| HU | Épica | Sprint | Prioridad | Nombre | Descripción |
|---|---|---|---|---|---|
| HU01 | EP01 | Sprint 1 | P0 | Crear proyecto de análisis | Como desarrollador de software, quiero crear un proyecto de análisis en la plataforma, para disponer de un espacio donde cargar y procesar versiones de mi código fuente. |
| HU02 | EP01 | Sprint 1 | P0 | Cargar una versión del proyecto mediante ZIP | Como desarrollador de software, quiero cargar una versión de mi proyecto TypeScript en formato ZIP, para que la plataforma pueda analizarla e indexarla. |
| HU03 | EP01 | Sprint 1 | P0 | Validar proyecto cargado | Como desarrollador de software, quiero conocer si el ZIP y el proyecto son válidos y compatibles, para corregir problemas antes de iniciar el análisis. |
| HU04 | EP01 | Sprint 1 | P0 | Consultar progreso del análisis | Como desarrollador de software, quiero consultar el estado y progreso de la indexación, para saber cuándo el proyecto está listo para generar pruebas. |
| HU05 | EP01 | Sprint 1 | P0 | Consultar resultado del análisis | Como desarrollador de software, quiero revisar el resumen del proyecto analizado, para conocer archivos procesados, framework detectado y resultados de indexación. |
| HU06 | EP01 | Sprint 1 | P1 | Consultar cobertura de pruebas existente | Como desarrollador de software, quiero conocer qué clases y métodos ya tienen pruebas, para identificar los objetivos que aún requieren cobertura. |
| HU07 | EP01 | Sprint 1 | P1 | Reindexar una nueva versión del proyecto | Como desarrollador de software, quiero cargar una nueva versión del proyecto sin perder la anterior, para mantener trazabilidad entre análisis y generaciones. |
| HU08 | EP02 | Sprint 2 | P0 | Generar pruebas para un método | Como desarrollador de software, quiero generar pruebas unitarias para un método específico, para trabajar sobre un objetivo puntual del código. |
| HU09 | EP02 | Sprint 2 | P0 | Generar pruebas completas de una clase | Como desarrollador de software, quiero generar pruebas para todos los objetivos testables de una clase, para obtener una cobertura funcional completa de ese componente. |
| HU10 | EP02 | Sprint 2 | P0 | Generar pruebas faltantes de una clase | Como desarrollador de software, quiero generar solo las pruebas inexistentes de una clase, para conservar las pruebas actuales y completar sus brechas. |
| HU11 | EP02 | Sprint 2 | P0 | Generar pruebas faltantes del proyecto | Como desarrollador de software, quiero generar pruebas para los objetivos sin cobertura del proyecto, para completar de forma dirigida las brechas detectadas. |
| HU12 | EP02 | Sprint 2 | P0 | Generar pruebas para todo el proyecto | Como desarrollador de software, quiero generar pruebas para todos los objetivos testables del proyecto, para obtener una propuesta integral de suite unitaria. |
| HU13 | EP03 | Sprint 2 | P0 | Consultar progreso de generación | Como desarrollador de software, quiero consultar el progreso de una generación en segundo plano, para conocer cuántos objetivos ya fueron procesados y en qué etapa se encuentra. |
| HU14 | EP03 | Sprint 2 | P0 | Consultar resultados de validación | Como desarrollador de software, quiero conocer qué pruebas generadas compilaron, se ejecutaron y fueron válidas, para distinguir resultados correctos de fallos de generación o ejecución. |
| HU15 | EP04 | Sprint 2 | P1 | Identificar archivos creados y modificados | Como desarrollador de software, quiero distinguir los archivos de prueba creados de los existentes que fueron modificados, para comprender el impacto de la generación. |
| HU16 | EP04 | Sprint 2 | P1 | Comparar modificaciones mediante diff | Como desarrollador de software, quiero visualizar el diff de un archivo de prueba modificado, para revisar exactamente qué contenido fue agregado o cambiado. |
| HU17 | EP04 | Sprint 2 | P1 | Descargar un artefacto generado | Como desarrollador de software, quiero descargar individualmente un archivo de prueba creado o modificado, para incorporarlo al proyecto cuando lo considere conveniente. |
| HU18 | EP04 | Sprint 2 | P1 | Descargar resultados de generación | Como desarrollador de software, quiero descargar en un ZIP todos los artefactos generados en una ejecución, para obtener conjuntamente los cambios producidos. |
| HU19 | EP05 | Sprint 2 | P0 | Comparar generación RAG contra baseline | Como desarrollador de software, quiero comparar la generación de pruebas utilizando RAG y una estrategia baseline sin recuperación, para evaluar bajo las mismas condiciones el efecto del contexto recuperado sobre la calidad y el costo de la generación. |
| HU20 | EP06 | Sprint 3 | P1 | Consultar historial de generaciones | Como desarrollador de software, quiero consultar generaciones anteriores de una versión del proyecto, para revisar sus resultados, validaciones y artefactos. |
| HU21 | EP06 | Sprint 3 | P0 | Recibir progreso de análisis en tiempo real | Como desarrollador de software, quiero recibir actualizaciones del análisis mediante WebSockets, para evitar consultas periódicas por polling. |
| HU22 | EP06 | Sprint 3 | P0 | Recibir progreso de generación en tiempo real | Como desarrollador de software, quiero recibir en tiempo real los cambios de estado de generación y validación, para seguir el proceso sin polling. |
| HU23 | EP06 | Sprint 3 | P0 | Corregir automáticamente pruebas inválidas | Como desarrollador de software, quiero que la plataforma intente reparar automáticamente una prueba que falle su validación, para aumentar la tasa de resultados utilizables sin intervención manual inmediata. |
| HU24 | EP06 | Sprint 4 | P1 | Reintentar una generación fallida | Como desarrollador de software, quiero reintentar manualmente una generación cuando los intentos automáticos no sean suficientes, para volver a procesar un objetivo fallido. |
| HU25 | EP07 | Sprint 4 | P0 | Mejorar la gestión de proyectos y resultados | Como desarrollador de software, quiero disponer de filtros, navegación y organización mejorada, para trabajar con múltiples proyectos, versiones y ejecuciones de forma eficiente. |
| HU26 | EP07 | Sprint 4 | P0 | Usar una experiencia visual consolidada | Como desarrollador de software, quiero utilizar una interfaz consistente tipo herramienta de análisis de código, para interpretar rápidamente proyectos, estados, validaciones y resultados. |

## Criterio de prioridad

- **P0:** imprescindible para cumplir el objetivo del sprint.
- **P1:** importante para completar el incremento; puede moverse si existe un bloqueo sin invalidar el núcleo.
- **P2:** diferible sin romper el incremento principal.

Los habilitadores técnicos se gestionan en `plan.md`/`tasks.md`; no se convierten artificialmente en historias de usuario.
