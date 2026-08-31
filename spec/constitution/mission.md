# Misión

**Estado:** aprobado

Diseñar e implementar el backend principal que materializa la arquitectura RAG de la tesis. El servicio analiza proyectos TypeScript, versiona snapshots, construye un índice recuperable del código, selecciona contexto relevante, genera pruebas unitarias mediante un LLM, coordina su validación en un Sandbox remoto y persiste resultados y métricas.

## Usuario principal

Desarrollador de software. La API queda desacoplada para futuros clientes como plugins IDE o pipelines, pero esas integraciones autónomas quedan fuera del alcance V1.

## Principios

- La arquitectura RAG es el núcleo investigativo; la API no se reduce a un wrapper de LLM.
- El contexto recuperado debe ser trazable.
- `ProjectVersion` congela el snapshot usado por cada run.
- Proveedores LLM/embeddings y Object Storage se desacoplan mediante interfaces.
- El experimento principal compara RAG vs baseline bajo condiciones equivalentes.
- Nivel 3 (PR/CI-CD autónomo) queda como evolución futura.
