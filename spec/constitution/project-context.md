# Contexto operativo del proyecto

**Estado:** APROBADO
**Alcance:** frontera de contexto para especificación, implementación y revisión; no agrega contratos funcionales.

## Identidad

`tjc-be-rag-core-api` es uno de los dos backends de una solución desarrollada como parte de una tesis de pregrado. Su usuario principal en la versión inicial es el desarrollador del área de desarrollo de la empresa participante que prepara, genera y valida pruebas unitarias asistidas por contexto del código.

## Núcleo del producto

El sistema indexa proyectos TypeScript y construye contexto RAG trazable para generación y validación de pruebas unitarias. No es un sistema genérico de preguntas y respuestas ni un simple wrapper de un LLM.

## Invariantes de diseño

- Distinguir recuperación de candidatos de construcción del contexto final: recuperar, seleccionar, ordenar y ajustar al presupuesto son responsabilidades diferentes.
- Combinar señales semánticas y estructurales cuando la feature aplicable lo requiera; un chunk semánticamente próximo no es automáticamente equivalente a una dependencia estructural.
- Mantener trazabilidad entre target, contexto recuperado, prueba generada y validación.
- Hacer esa trazabilidad inspeccionable como evidencia: candidatos/decisiones para RAG y tool calls/contenido observado para el agente, sin atribuir razonamiento interno.
- Proteger el flujo ZIP con identidad por correo y autorización por propietario; Supabase Auth no habilita acceso directo del navegador a datos de dominio o Storage.
- Mantener la V1 bajo control explícito del desarrollador. Integraciones PR/CI y automatización de nivel superior pertenecen a evolución futura salvo aprobación expresa.
- Permitir comparación reproducible entre la arquitectura RAG especializada y un agente generalista con exploración controlada del repositorio bajo condiciones equivalentes.
- Validar resultados en una empresa real e independiente. Repositorios públicos o entornos controlados pueden utilizarse para desarrollo y prevalidación, pero no sustituyen la evidencia final en la empresa participante.
- Mantener el alcance implementable exclusivamente en TypeScript. La tesis puede ubicarlo académicamente dentro del ecosistema JavaScript/TypeScript, pero eso no habilita archivos JavaScript puros en V1.
- Separar las responsabilidades de los tres proyectos: `tjc-fe-rag-developer-console` como frontend/cliente de referencia, `tjc-be-rag-core-api` como backend principal y `tjc-be-test-execution-sandbox` como backend de ejecución aislada. Este repositorio implementa únicamente RAG Core y su código vive en `app/`.

La autenticación básica de HU29 se rige por `DEC-WEB-AUTH-001`. Las condiciones empresariales restantes se rigen por `DEC-VAL-001`; GitHub/PR permanece futuro bajo `DEC-GH-001`.

## Dónde vive cada decisión

- Propósito y límites: `mission.md` y `roadmap.md`.
- Componentes, flujos y fronteras: `architecture.md`.
- Tecnologías y proveedores vigentes: `tech-stack.md`.
- Comportamiento funcional: `spec/features/`.
- Contratos compartidos: `spec/transversal/`.
- Priorización y trazabilidad: `spec/backlog.md`.
- Historia de cambios aprobados: `CHANGELOG.md`.

Este archivo no debe duplicar endpoints, esquemas, valores de configuración ni decisiones de proveedor ya definidas en esos documentos.

## Contexto excluido

No se incorpora aquí:

- contenido de papers, marco teórico o estado del arte;
- nombres de profesores, jurados u otros participantes académicos;
- Product Owner, Scrum Master u otros roles que no cambien un contrato implementable; para este SDD basta el rol desarrollador;
- reuniones, fechas administrativas, costos, SharePoint o estructura de capítulos;
- contexto de versiones antiguas de la tesis;
- título académico, hipótesis, población o muestra, salvo que una decisión aprobada los traduzca en un requisito implementable.

Las decisiones originadas en el trabajo académico ingresan mediante un handoff que separa lo aprobado de lo propuesto o pendiente. Hasta consolidarse en la spec canónica, ese material es solo insumo y no reemplaza `spec/`.
