# Misión

**Estado:** aprobado

Diseñar e implementar el backend principal que materializa la arquitectura RAG de la tesis. El servicio analiza proyectos TypeScript, versiona snapshots, construye un índice recuperable del código, selecciona contexto relevante, genera pruebas unitarias mediante un LLM, coordina su validación en un Sandbox remoto y persiste resultados y métricas.

## Usuario principal

Desarrollador de software del área de desarrollo de la empresa participante en la validación. La API queda desacoplada para futuros clientes como plugins IDE o pipelines, pero esas integraciones autónomas quedan fuera del alcance V1.

## Principios

- La arquitectura RAG es el núcleo investigativo; la API no se reduce a un wrapper de LLM.
- El contexto recuperado debe ser trazable.
- `ProjectVersion` congela el snapshot usado por cada run.
- Proveedores LLM/embeddings se desacoplan mediante interfaces; Supabase Storage se encapsula detrás de la abstracción interna `ObjectStorageService`.
- El experimento principal compara la arquitectura RAG especializada contra un agente generalista contemporáneo que puede explorar el mismo snapshot del repositorio mediante herramientas controladas.
- La diferencia experimental de interés es la política de adquisición y construcción de contexto; no se usa como control un LLM artificialmente aislado del repositorio.
- La validación final debe producir evidencia con una empresa real; repositorios públicos o escenarios controlados pueden apoyar desarrollo y prevalidación, pero no reemplazar esa validación.
- Nivel 3 (PR/CI-CD autónomo) queda como evolución futura.
