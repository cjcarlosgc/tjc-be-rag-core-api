# Convenciones

- Controladores REST; no GraphQL.
- DTOs validados; error envelope estándar con `statusCode`, `code`, `message`, `details`, `correlationId`, `timestamp`, `path`.
- No stack traces en respuestas.
- Estados asíncronos persistidos; errores posteriores al 202 se reflejan como estado FAILED/PARTIAL, no como HTTP tardío.
- IDs estables y timestamps ISO-8601.
- Configuración centralizada; modelos, topK, thresholds, token budgets y límites no se dispersan como literales.
- Services por responsabilidad: parser, chunking, embedding, retrieval, context, generation, validation, artifacts.
- El módulo de experimentos reutiliza el pipeline productivo; no duplica backend.
