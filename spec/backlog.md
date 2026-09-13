# Product Backlog global

**Estado:** línea base global vigente SDD 2.0 / SYSTEM-2.0 / INTEROP-2.0

Este backlog es compartido conceptualmente por los tres repositorios. Cada SDD local indica su participación concreta. La numeración expresa trazabilidad y orden lógico, no ejecución estrictamente secuencial.

## Épicas

- **EP01 — Gestión e indexación versionada de proyectos**
- **EP02 — Generación RAG de pruebas unitarias**
- **EP03 — Seguimiento y validación automática**
- **EP04 — Artefactos, diff y descarga**
- **EP05 — Evaluación experimental RAG vs agente generalista**
- **EP06 — Historial, tiempo real y resiliencia**
- **EP07 — Experiencia de producto**
- **EP08 — Trazabilidad visual del contexto**
- **EP09 — Identidad y acceso a la consola**
- **EP10 — GitHub App y lifecycle PR-driven**
- **EP11 — Changeset y conocimiento funcional**
- **EP12 — Control plane human-in-the-loop**
- **EP13 — Soporte PHP/Laravel/PHPUnit**
- **EP14 — Checks y publicación de pruebas**
- **EP15 — Evolución y validación**

## Historias

| HU | Épica | Sprint | Prioridad | Nombre | Descripción |
|---|---|---|---|---|---|
| HU01 | EP01 | Sprint 1 | P0 | Crear proyecto de análisis | Como desarrollador de software, quiero crear un proyecto de análisis en la plataforma, para disponer de un espacio donde cargar y procesar versiones de mi código fuente. |
| HU02 | EP01 | Sprint 1 | P0 | Cargar una versión del proyecto mediante ZIP | Como desarrollador de software, quiero cargar una versión de mi proyecto TypeScript en formato ZIP, para que la plataforma pueda analizarla e indexarla. |
| HU03 | EP01 | Sprint 1 | P0 | Validar proyecto cargado | Como desarrollador de software, quiero conocer si el ZIP y el proyecto son válidos y compatibles, para corregir problemas antes de iniciar el análisis. |
| HU04 | EP01 | Sprint 1 | P0 | Consultar progreso del análisis | Como desarrollador de software, quiero consultar el estado y progreso de la indexación, para saber cuándo el proyecto está listo para generar pruebas. |
| HU05 | EP01 | Sprint 1 | P0 | Consultar resultado del análisis | Como desarrollador de software, quiero revisar el resumen del proyecto analizado, para conocer archivos procesados, framework detectado y resultados de indexación. |
| HU06 | EP01 | Sprint 1 | P1 | Consultar cobertura de pruebas existente | Como desarrollador de software, quiero conocer qué objetivos testables ya tienen pruebas, para identificar aquellos que aún requieren cobertura. |
| HU07 | EP01 | Sprint 1 | P1 | Reindexar una nueva versión del proyecto | Como desarrollador de software, quiero cargar una nueva versión del proyecto sin perder la anterior, para mantener trazabilidad entre análisis y generaciones. |
| HU08 | EP02 | Sprint 2 | P0 | Generar pruebas para un objetivo específico | Como desarrollador de software, quiero generar pruebas unitarias para un método o función específica, para trabajar sobre un objetivo puntual del código. |
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
| HU19 | EP05 | Sprint 2 | P0 | Comparar RAG contra un agente generalista | Como desarrollador de software, quiero comparar la generación de pruebas mediante la arquitectura RAG y un agente generalista que explora el repositorio, para evaluar bajo condiciones reproducibles el efecto de una política especializada de adquisición y construcción de contexto sobre la calidad y el costo. |
| HU20 | EP06 | Sprint 3 | P1 | Consultar historial de generaciones | Como desarrollador de software, quiero consultar generaciones anteriores de una versión del proyecto, para revisar sus resultados, validaciones y artefactos. |
| HU21 | EP06 | Sprint 3 | P0 | Recibir progreso de análisis en tiempo real | Como desarrollador de software, quiero recibir actualizaciones del análisis mediante WebSockets, para evitar consultas periódicas por polling. |
| HU22 | EP06 | Sprint 3 | P0 | Recibir progreso de generación en tiempo real | Como desarrollador de software, quiero recibir en tiempo real los cambios de estado de generación y validación, para seguir el proceso sin polling. |
| ~~HU23~~ | EP06 | ~~Sprint 3~~ | — | ~~Corregir automáticamente pruebas inválidas~~ | **Descartada.** Decisión definitiva de arquitectura (ver `tjc-be-rag-core-api/spec/features/009-history-realtime-repair/spec.md`): una generación validada = una ejecución en el Sandbox; sin autorreparación automática ni corrección vía LLM. No es una evolución futura pendiente. |
| HU24 | EP06 | Sprint 3 | P1 | Reintentar una generación fallida | Como desarrollador de software, quiero reintentar manualmente una generación que quedó `INVALID`/`FAILED`, para volver a procesarla desde cero cuando lo considere necesario. (Redactada originalmente en función de HU23 — "cuando los intentos automáticos no sean suficientes" —; sin HU23 pasa a ser simplemente un reintento manual explícito, sin corrección automática de por medio). |
| HU25 | EP07 | Sprint 4 | P0 | Mejorar la gestión de proyectos y resultados | Como desarrollador de software, quiero disponer de filtros, navegación y organización mejorada, para trabajar con múltiples proyectos, versiones y ejecuciones de forma eficiente. |
| HU26 | EP07 | Sprint 4 | P0 | Usar una experiencia visual consolidada | Como desarrollador de software, quiero utilizar una interfaz consistente tipo herramienta de análisis de código, para interpretar rápidamente proyectos, estados, validaciones y resultados. |
| HU27 | EP08 | Sprint 4 | P0 | Explorar el contexto RAG de una generación | Como desarrollador de software, quiero inspeccionar el árbol de contexto RAG de un run completo o de un artefacto seleccionado, incluidos candidatos elegidos y descartados con sus señales y motivos, para comprender qué evidencia fue entregada al generador. |
| HU28 | EP08 | Sprint 4 | P0 | Explorar el contexto observado por el agente | Como desarrollador de software, quiero revisar la trayectoria cronológica de herramientas y el contenido observable entregado al agente generalista en cada repetición experimental, para auditar su exploración sin atribuirle razonamiento interno no observable. |
| HU29 | EP09 | Sprint 4 | P0 | Acceder de forma segura al flujo ZIP | Como desarrollador de software autorizado, quiero autenticarme con correo electrónico y acceder únicamente a mis proyectos y ejecuciones, para usar el flujo ZIP en un entorno empresarial sin exponer código a usuarios no autorizados. |

La experiencia HU26 de GitHub login -> repositorios -> selección/importación corresponde a una exploración anterior y queda **SUPERSEDED BY SDD 2.0 / T-001**. Sus componentes reutilizables pueden conservarse, pero la demo vigente debe representar una GitHub App ya instalada, un repository binding y un PR que dispara análisis automático. Ningún dato mock constituye evidencia científica o empresarial.

## Criterio de prioridad

La prioridad se interpreta contra la arquitectura SDD 2.0: P0 materializa el nuevo norte de tesis; P1 habilita operación end-to-end; P2 preserva experimento/validación; P3 aporta producto; P4 corresponde a legado, limpieza o evolución futura. El orden histórico de HU01-HU29 no obliga a continuar trabajo que haya quedado superseded.

## Historias SDD 2.0

| HU | Épica | Hito | Prioridad | Nombre | Descripción |
|---|---|---|---|---|---|
| HU30 | EP10 | A | P0 | Vincular Project con repositorio | Como usuario autorizado, quiero instalar/configurar la GitHub App y vincular un repositorio a un Project, para habilitar análisis PR-driven sin confundirlo con mi login. |
| HU31 | EP10 | B | P0 | Ingerir eventos de Pull Request | Como plataforma, quiero verificar, normalizar y deduplicar eventos relevantes de Pull Request, para iniciar análisis automáticos únicamente sobre PR vinculados. |
| HU32 | EP10 | A | P0 | Gestionar AnalysisRun por PR y HEAD | Como desarrollador, quiero que cada análisis represente un HEAD concreto y vuelva obsoleto al anterior, para confiar en que resultados y Checks corresponden al código vigente. |
| HU33 | EP11 | C | P0 | Construir PR CHANGESET e INDEX DELTA | Como plataforma, quiero separar qué propone el PR de qué debe reindexarse, para validar el cambio completo y mantener el índice eficientemente. |
| HU34 | EP11 | C | P0 | Detectar símbolos cambiados e impactados | Como desarrollador, quiero identificar símbolos directos y potencialmente impactados, para orientar pruebas más allá de archivos modificados. |
| HU35 | EP11 | D | P0 | Persistir conocimiento funcional | Como usuario autorizado, quiero conservar reglas funcionales versionadas por Project y scope, para reutilizarlas trazablemente sin sobrescribir historia. |
| HU36 | EP11 | D | P0 | Solicitar y continuar contexto funcional | Como usuario autorizado, quiero responder preguntas adaptativas cuando un Run requiera contexto y reanudar el mismo Run si el HEAD no cambió, para completar el análisis sin workers bloqueados. |
| HU37 | EP12 | UX | P0 | Usar Focus Mode de contexto funcional | Como usuario autorizado, quiero responder una pregunta por vez con contexto técnico y ayuda visual, para tomar decisiones informadas sobre un Run concreto. |
| HU38 | EP12 | UX | P0 | Consultar bandeja Action Required | Como usuario autorizado, quiero ver todos mis Runs pendientes y abrirlos desde Console o un deep link, para resolver bloqueos sin perder el destino tras autenticarme. |
| HU39 | EP14 | F | P1 | Publicar GitHub Checks por HEAD | Como desarrollador, quiero recibir una conclusión objetiva y trazable en el PR, para conocer el resultado vigente sin confundirlo con la política de merge. |
| HU40 | EP14 | F | P1 | Revisar y publicar tests por companion PR | Como usuario autorizado, quiero revisar propuestas, verificar freshness y publicarlas mediante un companion PR a la feature branch, para incorporar tests sin escritura ni merge automáticos. |
| HU41 | EP13 | E | P1 | Analizar PHP/Laravel estructuralmente | Como desarrollador PHP, quiero que Core detecte archivos, símbolos, relaciones y convenciones Laravel, para construir contexto semántico-estructural del changeset. |
| HU42 | EP13 | E | P1 | Generar pruebas PHPUnit | Como desarrollador PHP, quiero generar propuestas PHPUnit con el mismo contexto trazable, para validar cambios Laravel sin dispersar lógica específica por Core. |
| HU43 | EP13 | E | P1 | Ejecutar perfil PHP/Laravel/PHPUnit | Como Core, quiero solicitar una ejecución PHP aislada con Composer y PHPUnit, para recibir evidencia objetiva normalizada preservando la ceguera del Sandbox. |
| HU44 | EP10 | Cleanup | P4 | Retirar integración GitHub superseded | Como mantenedor, quiero eliminar adapters y mocks de login/importación GitHub que ya no tengan consumidores, para evitar dos arquitecturas aparentes. |
| HU45 | EP15 | Future | P4 | Gestionar miembros y roles del Project | Como owner, quiero administrar miembros Owner/Maintainer/Reviewer, para habilitar colaboración multiusuario en una evolución posterior. |
| HU46 | EP15 | Research | P2 | Investigar mutation testing | Como investigador, quiero evaluar mutation testing por stack y costo, para decidir su aporte sin volver Mutation Score obligatorio prematuramente. |
| HU47 | EP15 | Infra | P2 | Desplegar Sandbox remoto | Como operador, quiero seleccionar y desplegar una VM Sandbox con aislamiento, red y retención aprobados, para validar fuera del entorno local cuando `DEC-INF-001` se resuelva. |

- **P0:** necesario para materializar la nueva arquitectura de tesis.
- **P1:** necesario para la operación end-to-end de SDD 2.0.
- **P2:** necesario para experimento, validación o infraestructura posterior.
- **P3:** capacidad de producto útil sin bloquear el núcleo.
- **P4:** legado, limpieza o evolución futura.

Los habilitadores técnicos se gestionan en `plan.md`/`tasks.md`; no se convierten artificialmente en historias de usuario.
