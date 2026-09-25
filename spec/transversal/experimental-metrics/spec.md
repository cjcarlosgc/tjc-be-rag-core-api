# experimental-metrics — Especificación

**Estado:** aprobado salvo elementos marcados PENDING/PROPOSED.
**Historias:** capacidad técnica transversal

## Objetivo

Conservar datos objetivos para análisis estadístico posterior sin fijar todavía muestra o prueba estadística.

## Reglas y comportamiento

- Conservar por repetición la estrategia, configuración del modelo, métricas de compilación/ejecución/validez, failure type, tiempos, tokens y costo cuando estén disponibles.
- Conservar trazas explicativas de adquisición de contexto propias de cada estrategia sin convertir un dato ausente en cero.
- Exponer datos y agregados reproducibles; el backend no concluye significancia estadística ni declara automáticamente un ganador.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- Mutation testing no forma parte de este alcance; la decisión de descarte está en `spec/ideas.md`.
