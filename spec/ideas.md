# Ideas de producto

Una idea no es una HU, subtarea ni autorización para implementar. Este registro permite conservar propuestas de baja prioridad sin inflar las 18 HU. Antes de seleccionar una idea se revisa si cabe en una HU existente; si no cabe, se consulta al usuario.

| ID | Idea | Estado | Motivo o siguiente revisión |
| --- | --- | --- | --- |
| IDEA-001 | Mutation testing como criterio/métrica del pipeline | I-DECLINED | El usuario decidió no incorporarlo a este alcance. La mención histórica permanece en Git y `CHANGELOG.md`; no genera WI. |
| IDEA-002 | Reevaluar retrieval test-aware (`DEC-RAG-001`) | I-BACKLOGGED | Requiere investigación y aprobación antes de alterar ranking; no autoriza implementación. Posible relación con HU05/HU17. |
| IDEA-003 | Cambiar modelo o dimensionalidad de embeddings | I-BACKLOGGED | Solo si una evaluación experimental lo justifica; implicaría adapter, migración pgvector y reindexación. Posible relación con HU03/HU05. |
| IDEA-004 | Cobertura secundaria como métrica experimental | I-BACKLOGGED | Su inclusión en HU17 depende de aprobación; no se cuenta como criterio actual. |
