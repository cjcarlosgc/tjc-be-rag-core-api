# experimental-metrics — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Conservar datos objetivos para análisis estadístico posterior sin fijar todavía muestra o prueba estadística.

## Reglas y comportamiento

- Conservar por repetición la estrategia, configuración del modelo, métricas de compilación/ejecución/validez, failure type, tiempos, tokens y costo cuando estén disponibles.
- Conservar trazas explicativas de adquisición de contexto propias de cada estrategia sin convertir un dato ausente en cero.
- Exponer datos y agregados reproducibles; el backend no concluye significancia estadística ni declara automáticamente un ganador.

Mutation score es una mejora prioritaria deseada y potencialmente más informativa que cobertura, pero no es todavía una métrica aprobada ni implementable mientras `DEC-MET-001`, cuyo propietario es `spec/contracts/system-contract.md`, siga PENDING.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
