# experimental-metrics — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Conservar datos objetivos para análisis estadístico posterior sin fijar todavía muestra o prueba estadística.

## Reglas y comportamiento

- Conservar por repetición la estrategia, configuración del modelo, métricas de compilación/ejecución/validez, failure type, tiempos, tokens y costo cuando estén disponibles.
- Conservar trazas explicativas de adquisición de contexto propias de cada estrategia sin convertir un dato ausente en cero.
- Exponer datos y agregados reproducibles; el backend no concluye significancia estadística ni declara automáticamente un ganador.

### DEC-MET-001 — Mutation score y StrykerJS

**Estado:** PENDING

**Blocks:** únicamente un work item futuro que pretenda implementar mutation testing o promover mutation score a métrica experimental; no bloquea HU19 ni el cierre del núcleo de Sprint 2

**Pregunta:** inmediatamente después del núcleo de Sprint 2, investigar viabilidad homogénea en proyectos TypeScript con Jest/Vitest, alcance del mutation testing, costo/tiempo, configuración de StrykerJS, aislamiento en Sandbox y significado del indicador. Presentar el análisis para aprobación antes de diseñar o implementar.

Mutation score es una mejora prioritaria deseada y potencialmente más informativa que cobertura, pero no es todavía una métrica aprobada ni implementable mientras `DEC-MET-001` siga PENDING.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
