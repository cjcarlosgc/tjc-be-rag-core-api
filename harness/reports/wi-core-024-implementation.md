# WI-CORE-024 — Informe de implementación
Modelo: implementer · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low (leader: claude-sonnet-5-5, medium; commits y trailers por el leader)

**Fecha:** 2026-10-08 (America/Lima). Sin push. Sin escalar a implementer-high.

## Commits (locales)
| Corte | Commit | Contenido |
|---|---|---|
| A | `d062668` | `WorkspaceAgentTools` sin filtro de pruebas existentes; descripciones y mensajes; enumeración de herramientas |
| B | `dfc3f58` | tope por tool calls ejecutadas (`AGENT_MAX_TOOL_CALLS`, `@Max(100)`), presupuesto de contexto acumulado en tokens cl100k, campos por paso |
| C | `29b64de` | handler sin `testFilePaths`, `detail.budget` en `ContextTrace.detail`, instrucciones con tope y presupuesto reales |
| D | `701a3d8` | `RETRIEVAL_MAX_CONTEXT_TOKENS` 6000 a 8000 (decisión del usuario) |

A y B solos no compilan (el handler se ajusta en C); el árbol compila desde `29b64de`. Pueden unirse si el revisor lo prefiere.

## Interpretaciones a confirmar por el reviewer
1. «Cada resultado se trunca para no superar contextTokenBudget» se interpretó como presupuesto **acumulativo** (paridad con RAG). Un tope por resultado sería un ajuste menor.
2. El marcador de truncado no cuenta en `contextTokens`.
3. `list_files` conserva `truncated=true` con `CHAR_LIMIT`; el recorte de 20.000 caracteres de `read_file` sigue en `WorkspaceAgentTools`.
4. No hay prueba directa del argumento del constructor de `WorkspaceAgentTools` en el handler; la garantía es por compilación.
5. Cambio de producto aprobado: el límite compartido sube a 8000, lo que afecta al RAG del producto (más contexto, mayor costo por llamada). El `app/.env` local que fije 6000 debe actualizarse (no se tocó).

## Contrato
`contractImpact=false`: sin DTO, ruta, enum, `ErrorCode` ni migración; trayectoria y `budget` viven en `ContextTrace.detail` interno. El Contract Sync de experimentos lo emite WI-CORE-025.

## Verificaciones
Desde `app/` con DATABASE_URL/DIRECT_URL = postgresql://nouser:nopass@127.0.0.1:1/none: `pnpm lint` exit 0; `pnpm test` 110 archivos pasan, 1 omitido, 1392 tests pasan, 36 omitidos; `pnpm build` exit 0; `pnpm test:e2e` 7 archivos, 222/222; `node harness/validate-harness.mjs` pasa.
