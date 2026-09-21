# Product Backlog global

**Estado:** línea base global vigente SDD 2.1 / SYSTEM-2.4 / INTEROP-2.4

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

HU01-HU05 y HU07 (ZIP upload/indexación), HU06 (inventario sobre una versión ZIP), HU08-HU12 (modos manuales de generación), HU13-HU18 (progreso/validación/artefactos de runs manuales) y HU20/HU24 (historial y retry manual) quedan **RETIRED — SUPERSEDED BY SDD 2.0 / 013-pr-driven-analysis**: ya no son una ruta de producto vigente; el único disparador de análisis real es PR-driven (`AnalysisRun`). Esto es más estricto que la clasificación `ADAPT` registrada en `spec/backlog-migration-sdd-2.0.md` (reporte histórico de T-001, no se reescribe); esta nota es la vigente. HU19 (Experiments, RAG vs GENERALIST_AGENT) **se conserva** — su creación depende hoy de `TestTarget` producido por la indexación ZIP ahora retirada, por lo que queda sin una ruta vigente para generar targets nuevos hasta reapuntarla a `AnalysisRun` en un corte P1/P4 futuro (ver handoff de reorientación referenciado en `CHANGELOG.md`); esto no bloquea el desarrollo P0 (HU30-HU43) en curso.

## Criterio de prioridad

La prioridad se interpreta contra la arquitectura SDD 2.0: P0 materializa el nuevo norte de tesis; P1 habilita operación end-to-end; P2 preserva experimento/validación; P3 aporta producto; P4 corresponde a legado, limpieza o evolución futura. El orden histórico de HU01-HU29 no obliga a continuar trabajo que haya quedado superseded.

## Historias SDD 2.0

| HU | Épica | Hito | Prioridad | Nombre | Descripción |
|---|---|---|---|---|---|
| HU30 | EP10 | A | P0 | Vincular Project con repositorio | Como usuario autorizado, quiero descubrir repositorios visibles con mi identidad GitHub y vincular al Project uno autorizado por la GitHub App, eligiendo una rama real de integración, para habilitar análisis PR-driven sin confundir discovery con automatización. |
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

### Evoluciones posteriores de repository binding

- Soporte de GitHub Organizations (prioridad baja): discovery y binding de repositorios organizacionales, incluyendo políticas OAuth, aprobación administrativa cuando corresponda e instalación/restricción de la App. No forma parte del primer flujo end-to-end.
- Colaboración multiusuario (HU45, prioridad baja/media): el `RepositoryBinding`, los AnalysisRuns, Functional Knowledge y evidencia pertenecen al Project; una futura matriz de roles determinará quién configura y revisa. No se crean roles ni permisos nuevos en HU30.

### HU48-HU55 — registradas 2026-09-14, `PROPOSED` (no `APROBADO` — se formaliza la historia, no se aprueba todavía su implementación)

Capacidades que se discutieron como necesarias (en handoffs del usuario o en
hallazgos de auditoría propios) pero nunca tuvieron número de historia — el
usuario pidió cerrar ese hueco antes de planear implementación. Compartido
conceptualmente con `tjc-fe-rag-developer-console`/`tjc-be-test-execution-sandbox`
igual que el resto de este backlog. Formalizadas originalmente en
`tjc-fe-rag-developer-console`; espejadas aquí para evitar drift. Detalle
completo por historia en `harness/reports/console-backlog-formalization.md`
(repositorio Console).

| HU | Épica | Hito | Prioridad | Nombre | Descripción |
|---|---|---|---|---|---|
| HU48 | EP16 | G | P1 | Comparar RAG vs agente sobre un AnalysisRun existente | Como investigador de la tesis, quiero iniciar una comparación RAG vs agente generalista ("Run comparison") sobre un `AnalysisRun` existente, para medir ambas estrategias sobre la misma entrada real (PR, HEAD, changeset) en vez de una selección manual de target. |
| HU49 | EP16 | G | P4 | Capturar el próximo PR para una comparación en vivo | Como presentador de la tesis, quiero armar ("Capture next PR") la próxima comparación experimental sobre el siguiente `AnalysisRun` elegible que dispare un PR real, para demostrar en vivo que la comparación no está precalculada. |
| HU50 | EP10 | H | P1 | Mostrar cobertura de pruebas previa de un símbolo en Run Detail | Como usuario autorizado, quiero ver si el símbolo cambiado por un PR tenía cobertura de pruebas previa (ninguna/parcial/suficiente), para entender por qué el Run generó pruebas nuevas, completó lo faltante o no generó nada. |
| HU51 | EP11 | D | P1 | Detectar conflicto de conocimiento funcional en Focus Mode | Como usuario autorizado, quiero que Focus Mode me avise cuando la regla funcional que estoy por fijar contradiga una regla `ACTIVE` existente, para resolver el conflicto antes de que contamine el conocimiento persistido. |
| HU52 | EP11 | D | P2 | Trazar qué Runs usaron una regla de Functional Knowledge | Como usuario autorizado, quiero ver en el detalle de una regla de Functional Knowledge qué Analysis Runs la usaron, para entender su impacto y trazabilidad. |
| HU53 | EP10 | H | P1 | Mostrar el historial de transiciones de estado de un AnalysisRun | Como usuario autorizado, quiero ver el historial cronológico de transiciones de estado de un `AnalysisRun`, para entender cómo llegó a su estado actual sin adivinar a partir de 3 timestamps sueltos. |
| HU54 | EP08 | H | P1 | Extender Context Explorer con contexto funcional y de tests existentes | Como usuario autorizado, quiero que el árbol de contexto de un Run muestre también el conocimiento funcional y la evidencia de tests existentes que alimentaron el Context Builder, no solo candidatos RAG, para auditar el contexto completo detrás de una generación. |
| HU55 | EP10 | H | P1 | Listar Analysis Runs cross-proyecto para el Workspace Overview | Como usuario autorizado, quiero un listado de Analysis Runs que abarque todos mis proyectos, para ver de un vistazo qué necesita mi atención sin entrar proyecto por proyecto. |
| HU56 | EP01 | H | P1 | Eliminar un proyecto de forma lógica | Como usuario autorizado, quiero eliminar un proyecto para que deje de aparecer en la plataforma y su repositorio quede libre para vincularse a otro proyecto, sin borrar físicamente su evidencia. |
| HU57 | EP10 | H | P1 | Reactivar un binding desconectado y rechazar repositorios ya vinculados | Como usuario autorizado, quiero pausar y reactivar el binding de un Project y recibir un error claro si el repositorio elegido ya está vinculado a otro Project, para controlar cuándo se analizan los PR sin errores internos. |
| HU58 | EP15 | Future | P4 | Ver mis workspaces antes de listar proyectos | Como usuario autenticado con GitHub, quiero ver en el home mi cuenta personal y las organizaciones de las que soy miembro, para elegir en qué workspace trabajo antes de ver o crear Projects. |
| HU59 | EP15 | Future | P4 | Acceder automáticamente a los Projects de una organización | Como miembro de una organización, quiero ver los Projects cuyo repositorio vinculado puedo leer en GitHub, sin que nadie me invite, para trabajar con mi equipo sin administrar permisos por separado. |
| HU60 | EP15 | Future | P4 | Roles Admin, Maintainer y Reader derivados de GitHub | Como miembro de una organización, quiero que mi rol en un Project (Admin, Maintainer o Reader) salga de mi rol y permiso en GitHub, para que el acceso siempre coincida con el de la fuente de verdad. Redefine el alcance de HU45. |
| HU61 | EP15 | Future | P4 | Perder el acceso cuando GitHub lo revoca | Como owner de una organización, quiero que un usuario deje de ver los Projects cuando GitHub le retira el acceso, mediante webhook y una reconciliación periódica, sin depender de que vuelva a iniciar sesión. |
| HU62 | EP09 | Future | P1 | Autenticar únicamente con GitHub | Como usuario, quiero iniciar sesión solo con GitHub, para que cada persona tenga una identidad GitHub verificable de la que derivar roles y organizaciones. Retira el inicio de sesión con correo y contraseña. |
| HU63 | EP01 | Future | P4 | Crear, renombrar y eliminar Projects dentro de una organización | Como Admin (owner) de una organización, quiero crear un Project eligiendo la organización, renombrarlo y eliminarlo de forma lógica, para gestionar el ciclo de vida de los Projects del equipo. |
| HU64 | EP10 | Future | P4 | Vincular solo repositorios de la organización del Project | Como Admin o Maintainer, quiero que al vincular un repositorio solo se ofrezcan los de la organización del Project (en el workspace personal, solo los propios) y que se exija permiso maintain o write sobre él, para no ocupar repositorios ajenos ni hacer escribir a la GitHub App donde no puedo. Un Project tiene un solo repositorio y no se revincula.

HU56-HU57 — registradas 2026-09-20 por Console (`CONTRACT_SYNC` CS-20260920-001) a partir de probar el binding contra Core real (`500` al vincular un repositorio ya usado por otro Project). Aprobadas por el usuario el 2026-09-20 junto con dos decisiones: un binding `REVOKED` se reactiva por `POST .../enable` si la App recuperó acceso, y el fix de `disable()` sobre `REVOKED` y la validación de binding en los job handlers entran en el mismo work item (`T-002-binding-lifecycle`). Contrato en INTEROP-2.3 §6.1/§6.8; implementado en Core (`T-002-binding-lifecycle`).

HU58-HU64 — registradas y aprobadas para implementación el 2026-09-20 (`DEC-ORG-001` `APROBADO`). Salen de `DEC-ORG-001` (`spec/contracts/system-contract.md`): GitHub es la fuente de verdad de la autorización y el "equipo" es la organización; Core persiste solo el vínculo `userId -> githubUserId`, la organización del Project y un registro de acceso revocable por webhook. HU60 redefine el alcance de HU45 (los miembros y roles se gestionan en GitHub, no en Core) y HU63 hace que eliminar un Project (HU56) sea una acción solo de Admin. Las rutas, DTOs, errores y la matriz rol -> operación quedaron definidos en INTEROP-2.4 (§6.1, §6.8, §6.9, §6.13; pendientes de implementación) y el detalle de cortes en `spec/features/014-organizations-access/`; `HU62` ya está consolidada en `012-web-authentication` (login solo con GitHub) y su despliegue exige deshabilitar el correo en Supabase. Dependencias: HU62 -> HU58 y HU63 (identidad GitHub); HU63 y HU58 -> HU59 y HU60 (workspace y `role` de `ProjectResponse`); HU60 -> HU64 (permiso mínimo `maintain`/`write`) y HU61 (los registros de acceso que se revocan); HU59, HU60 y HU61 se publican juntas, porque conceder acceso sin poder revocarlo no es aceptable. `DEC-ORG-002` (`PROPOSED`) bloquea HU59, HU60 y HU64 hasta que el usuario responda sus casos borde.

2026-09-15: los 4 contratos que Core debía definir para desbloquear a
Console quedaron definidos y hoy están consolidados en **INTEROP-2.2** (`spec/contracts/interoperability-contract.md`
§6.5, §6.10, §6.11) y `spec/contracts/system-contract.md`, cada bloque
marcado explícitamente "Definido, pendiente de implementación": HU48
(`CreateExperimentRequest` reapunta a `analysisRunId`+símbolo en vez de
`TestTarget`), HU51 (`409 FUNCTIONAL_KNOWLEDGE_CONFLICT` +
`conflictResolution` en `SubmitFunctionalAnswerRequest`), HU53
(`AnalysisRunDetailResponse.history`) y HU55
(`GET /analysis-runs` sin `projectId`, scope = todos los Projects del
usuario autenticado). Ninguno de los 4 está implementado todavía — solo
el contrato HTTP. Ver mensaje de Console del 2026-09-14 y su reporte para
el detalle original.

- **P0:** necesario para materializar la nueva arquitectura de tesis.
- **P1:** necesario para la operación end-to-end de SDD 2.0.
- **P2:** necesario para experimento, validación o infraestructura posterior.
- **P3:** capacidad de producto útil sin bloquear el núcleo.
- **P4:** legado, limpieza o evolución futura.

Los habilitadores técnicos se gestionan en `plan.md`/`tasks.md`; no se convierten artificialmente en historias de usuario.
