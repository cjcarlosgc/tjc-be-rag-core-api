# Roadmap

## Sprint 1 — base operativa e indexación
Meta acumulada aproximada: BE RAG 45%. HU01-HU07. Implementar Project/ProjectVersion, ZIP seguro, snapshot, parsing, inventario, chunks, embeddings, pgvector y APIs de estado/resultados.

## Sprint 2 / PI1 — generación, validación y experimento
Meta acumulada aproximada: BE RAG 80%. HU08-HU19. Retrieval/context, cinco modos, generación, orquestación Sandbox, artifacts/diff/descarga y comparación first-shot entre RAG y agente generalista.

## Puerta de investigación posterior al núcleo de Sprint 2

Antes de comprometer implementación adicional, investigar y presentar para decisión humana: mutation score/StrykerJS (`DEC-MET-001`) y la posible señal test-aware (`DEC-RAG-001`). Ambos son mejoras próximas deseadas, pero permanecen PENDING y no bloquean el cierre del núcleo de Sprint 2.

## Sprint 3 — evolución
Meta acumulada aproximada: 92%. HU20-HU23. Historial, WebSockets y autorreparación acotada del modo normal.

## Sprint 4 — cierre
Meta: 100%. HU24-HU26 según participación backend. Reintento manual, estabilización, observabilidad, performance y soporte a UX consolidada. Coverage experimental puede incorporarse como métrica secundaria si resulta homogénea y viable.

## Futuro
PR/CI-CD autónomo, plugins IDE, JavaScript puro u otros lenguajes, full regression, escalado/Kubernetes y experimentos adicionales.
