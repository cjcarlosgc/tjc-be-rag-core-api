# WI-CORE-099 — alcance: aserciones CT-01…CT-10 de Core que faltan por probar, declaraciones y mapa de evidencia
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Aprobado por el usuario (chat de Core, 2026-10-25):** «pruebas CT (~25)… declarar G-02, G-04, G-05(b), G-06 (reformular), G-07 (lista permitida), G-08 y G-09(1)», dentro del inventario previo al tag `arch-v1.0` (cerrar los huecos y recrear el tag una sola vez). Documental y de pruebas: sin cambio de código de producto, contrato, DTO, enum, `ErrorCode`, variable de entorno ni migración; sin tocar otros repositorios. Fuente de las aserciones: `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` (IDs, texto, columna «Existente/Falta»).

## Pruebas nuevas (Core), en `app/src/ct/ct-NN-<tema>.spec.ts` (títulos `CT-NN-Ax: …`; reutilizar dobles del repo; sin duplicar lo ya cubierto, solo referenciarlo en el mapa)

| Grupo | Aserciones | Qué probar |
|---|---|---|
| A | CT-01-A1 | Un payload canónico de `spec/contracts/schemas/examples/github-webhook-event.*.json` (PR abierto/actualizado) entra por el receptor interno (controlador+servicio con dobles) y crea/actualiza un AnalysisRun con repo, PR y HEAD idénticos al payload. |
| A | CT-01-A4 | Evento no elegible o instalación sin permisos ⇒ no se crea Run y el estado queda indicado (nombrar como CT lo ya cubierto en `github-webhooks.service.spec.ts` y completar lo que falte). |
| A | CT-02-A3 | HEAD obsoleto ⇒ el Run pasa a obsoleto y no actualiza índice ni genera targets (handler de snapshot + servicio de Runs). |
| A | CT-02-A4 | Un símbolo/target no resoluble queda como estado explícito (HELD/TECHNICAL_GENERATION_FAILURE, no excepción) y los demás símbolos siguen (Validation; hay una prueba parcial por símbolo). |
| A | CT-03-A3, A4 | `RetrievalService`: conjunto vacío de candidatos = resultado explícito (lista vacía, sin excepción); los candidatos salen con score y orden determinista. |
| A | CT-03-A5, A6 (pg) | `*.pg`: cada retrieval persiste un `retrieval_id` consultable; la búsqueda vectorial real (`findSimilarByEmbedding`) devuelve candidatos con pgvector real, filtrados por `projectVersionId`. |
| B | CT-04-A2 | Reformulada (D-7, declaración G-04): ninguna regla no ACTIVE llega a `functionalRules` del contexto; documentado que en los Projects oficiales no existen reglas sin procedencia. |
| B | CT-04-A4 | Regla requerida sin respuesta o en conflicto ⇒ el flujo se detiene con ACTION_REQUIRED y no genera con reglas supuestas (nombrar lo existente y completar). |
| B | CT-04-A5 (pg) | Contra Postgres real: un usuario sin acceso al Project no lee las reglas (`findByProjectForOwner` + `accessibleProject`) ni resuelve el Project; la confirmación sin rol suficiente ya está en CT-04-A3. |
| B | CT-05-A3 | El contexto no contiene candidatos duplicados (mismo chunk). |
| B | CT-06-A3, A4, A5 | El request al Sandbox no contiene tokens, credenciales Git ni secretos; la respuesta aceptada trae `execution_id` y queda asociada al Run; perfil/job inválido y reintentos según el contrato (nombrar lo existente de resiliencia). |
| B | CT-07-A4 | La salida del Sandbox no trae veredicto funcional ni campos RAG; Core ignora cualquier campo semántico extra. |
| C | CT-10-A1, A2 | El almacenamiento de artefactos se consume vía `ObjectStorageService` y el adapter Supabase cumple su contrato; los embeddings se consumen vía `EmbeddingProvider` (errores incluidos). |
| C | CT-10-A4 | Reformulada (declaración G-06): un error de persistencia sale por el envelope como `500 INTERNAL_ERROR` con mensaje fijo y sin fuga de internals, y los conflictos que traducen los repositorios son errores tipados (FK, idempotencia). |
| C | CT-10-A5 | Test de arquitectura: fuera de repositorios/adapters no se importan SDK de proveedor ni se usa `PrismaService` directamente; lista permitida explícita (declaración G-07): `common/idempotency/idempotency.service.ts` se declara adapter de persistencia (D-6). |

Pruebas `*.pg.spec.ts`: ficheros `app/src/ct/*.pg.spec.ts`, activadas por `CT_TEST_DATABASE_URL` (solo localhost, como `jobs.repository.pg.spec.ts`), con ids únicos y limpieza de lo que crean (sin vaciar tablas ajenas). El leader añade `CT_TEST_DATABASE_URL` al job `postgres` de `.github/workflows/ci.yml`.

## Documentos
- Actualizar `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` con las declaraciones aprobadas: G-02 (F1 sin código propio), G-04 (CT-04-A2 reformulada), G-05(b) (CT-02-A2 redactada a la semántica implementada: archivos del CHANGESET = base↔HEAD; `DIRECTLY_CHANGED` = comparación de chunks frente a la versión indexada previa o todos los símbolos del archivo en BOOTSTRAP; limitación documentada, Projects oficiales nuevos por caso), G-06 (CT-10-A4 reformulada), G-07 (lista permitida), G-08 (CT-08-A2/A4 manuales, D-11), G-09(1) (la «versión» de la Tabla 63 = linaje `supersedesId` + `createdAt`), y CT-05-A5 reformulada a V1 (HELD/`TECHNICAL_GENERATION_FAILURE` en Validation; experimento `FAILED` sin repeticiones en Experiments; V2 limitación). Recontar la tabla resumen.
- Crear `harness/reports/arch-v1.0-ct-evidencia-mapa.md`: por cada aserción CT-01…CT-10 (52), estado (CUBIERTA, DECLARADA, MANUAL, EXTERNA a otro repo), prueba (`archivo :: título`) y comando exacto de vitest para registrar la evidencia (D-1: SHA, comando y resultado). Los conteos deben coincidir con lo ejecutado.

## Hecho cuando
Las pruebas nuevas pasan (y fallan si se rompe la lógica que dicen cubrir), las pruebas pg pasan contra un Postgres local descartable con las migraciones aplicadas, el mapa referencia pruebas reales, lint/build/test en verde, la CI queda configurada para las pruebas pg nuevas y el reviewer independiente aprueba.
