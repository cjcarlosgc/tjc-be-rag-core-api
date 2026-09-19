# Convenciones

- Controladores REST; no GraphQL.
- DTOs validados; error envelope estándar con `statusCode`, `code`, `message`, `details`, `correlationId`, `timestamp`, `path`.
- No stack traces en respuestas.
- Estados asíncronos persistidos; fallos posteriores al 202 se clasifican en el vocabulario de AnalysisRun/ejecución, no como HTTP tardío.
- IDs estables y timestamps ISO-8601.
- Configuración centralizada; modelos, topK, thresholds, token budgets y límites no se dispersan como literales.
- Services por responsabilidad: parser, chunking, embedding, retrieval, context, generation, validation, artifacts.
- El módulo de experimentos reutiliza el pipeline productivo; no duplica backend.
- GitHub webhook handlers validan firma sobre body crudo, retornan rápido y encolan jobs DB-backed; nunca ejecutan el pipeline completo en el request.
- Código dependiente de lenguaje/test framework vive detrás de adapters/perfiles; no se dispersan condicionales PHP/TypeScript por el dominio.
