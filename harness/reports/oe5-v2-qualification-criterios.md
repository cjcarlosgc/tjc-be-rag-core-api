# Piloto v2 — puerta de qualification y runbook de preflight
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: criterios escritos ANTES de ejecutar (WI-CORE-105).** No contiene resultados. Describe cómo comprobar, sobre Projects `smoke-v2-*`, que las correcciones del Piloto v2 (WI-CORE-102 snapshot con fixtures, WI-CORE-103 contexto por capas, WI-CORE-104 sección de dependencias R2, WI-CORE-105 herramientas) hacen lo que dicen en el despliegue, y cómo se comprueba cada caso oficial antes y después. Los fallos de qualification **no son resultados** del experimento; se corrigen y se repite. Los 9 casos oficiales, las 3 reservas y sus oráculos NO se usan para calibrar nada.

## 1. Casos smoke (propuestos por cross; un Project por caso)
| Id | Fork | Target (método nuevo en la rama smoke) | Patrón | Project |
|---|---|---|---|---|
| S1 | persistence | `Mapping\Driver\FileDriver::getCachedClassNames(): array` | clase declarante abstracta | `smoke-v2-persistence-s1` |
| S2 | money | `MoneyBag::hasCurrency(Currency\|string): bool` | constructor privado y fábricas estáticas | `smoke-v2-money-s2` |
| S3 | casbin | `Enforcer::getPermissionsForUserByObject(string,string): array` | fixtures no-PHP (`examples/rbac_model.conf`, `rbac_policy.csv`) | `smoke-v2-casbin-s3` |
| S4 | money | `RationalMoney::fitsContext(Context): bool` | `use` ajeno al fragmento (`Brick\Money\Context\{Auto,Custom,Default}Context`) | `smoke-v2-money-s4` |
Para cada caso: Run de producto (Validation) **y** experimento de 3 repeticiones por brazo (flujo OE5), con PR `smoke-<repo>-sN` hacia `develop`, cerrado sin merge, y el Project borrado lógicamente al terminar.

## 2. Criterios de salida (todos deben cumplirse; «no ejercitado» se declara, no se da por cumplido)
| Id | Criterio | Cómo se mide |
|---|---|---|
| Q-a | S3: el ZIP del snapshot del experimento trae los fixtures y al menos una prueba que los lee pasa en el Sandbox | `snapshot-manifest.json` del extractor (entradas `examples/*.conf` y `*.csv`; `oe5-preflight after --expect-fixtures-min 60`) y ninguna repetición con `envSuspect` = `ENV-01` por archivo faltante |
| Q-b | S1 y S2: la clase declarante (y el constructor) salen `SELECTED` con `layer = DECLARING_CLASS` y el contexto ≤ `maxContextTokens` (8000); en S2 la sección de dependencias dice «constructor privado: no uses new» para `Money` y no sugiere `new` | `context-traces.json` (candidatos y `contextTokens`) y el texto de la sección no se persiste: se comprueba con la prueba de `acquireGenerationContext` y con el `tokenCount` de `dependencyContext` (> 0 y ≤ 500) |
| Q-c | Todas las trazas RAG llevan `configuration.strategy = LAYERED` y los parámetros esperados (umbral 0.60, tope capa 3 = 4000, capa 4 = 2000) | `oe5-preflight after` (comprobación d) |
| Q-d | S4: los identificadores del contexto (p. ej. `AutoContext`) tienen su FQCN en la sección | prueba de `acquireGenerationContext` con el escenario; en vivo, solo si la recuperación trae algún test que los use: si no, «no ejercitado» |
| Q-e | OE2 intacto y CT en verde en el commit desplegado | CI de `develop` (prueba dorada `retrieval-comparison-golden.spec.ts` y suites CT) |
| Q-f | Baseline sobre el MISMO conjunto de archivos que el Sandbox | `baseline-workspace.mjs --checkout <HEAD del PR> --manifest <snapshot-manifest.json> --out <dir>` con 0 faltantes y 0 distintos; la suite corre en el Sandbox sobre ese directorio (lo ejecuta cross) |
| Q-g | Configuración efectiva: `modelConfig` = `gpt-6-luna`/`medium`, `temperature` null, `budget` = 20/8000/120000 | `oe5-preflight after` (comprobación c) |
| Q-h | Las 6 repeticiones, los hashes sin discrepancias, los 9 enlaces (veredictos `PRESENT`; `NOT_APPLICABLE` justificado; ningún `INCONSISTENT`) y el VT clasificado | `oe5-preflight after` (comprobaciones a, b, f, g); el checklist manual de CT-08 sobre los Runs oficiales sigue siendo de cross |
| Q-i | S1b (WI-CORE-106): ninguna repetición RAG falla con `Fatal error … contains N abstract method` por métodos heredados y el `tokenCount` de `dependencyContext` supera el de la corrida S1 original (114 tokens: el bloque se persiste solo como tokens, no como texto; un `tokenCount` > 0 por sí solo no basta porque el glosario ya lo produce) | CSV del extractor (`failureType`/`errorSummary`) y la traza `dependencyContext.tokenCount` frente a 114; la presencia exacta del bloque se verifica en las pruebas unitarias; si siguen fallando, hallazgo de calibración, no se ajusta con los 9 casos |
Calibración: los umbrales y topes (0.60, 4000, 2000, 500, 4 fábricas, 30 del glosario) solo se ajustan con estos casos y ANTES del congelamiento, con un WI nuevo y su reporte (versión nueva del tratamiento); nunca con los 9 casos ni con sus oráculos, nunca después de ver resultados oficiales.

## 3. Runbook de preflight por caso oficial
**Antes** (cross; lo automatizable lo hace `oe5-preflight before`):
1. `oe5-preflight before --core-url <Core> --integration-url <Integration> --wait-ms 90000`: `/health` en 200 de ambos (arranque en frío de Render).
2. SHA desplegado en Render de Core e Integration igual al del tag `arch-v1.0` vigente (CLI de Render: `render deploys list`), y VM del Sandbox viva con la imagen congelada (digest de `imagen-sandbox-php.md`). `/health` no expone el SHA (hacerlo exigiría contrato).
3. Variables de Core en Render sin cambios desde el congelamiento (`LLM_MODEL`, `LLM_REASONING_EFFORT`, `AGENT_MAX_TOOL_CALLS`, `RETRIEVAL_*`, `GENERATION_TIMEOUT_MS`, `EXPERIMENT_LLM_*`): el operador las lee en la pestaña Environment; `modelConfig` solo es observable después de crear el experimento (se persiste al crearlo).
4. Project nuevo `oficial-<repo>-<caso>`, binding a `develop`, FK respondidas según la regla EV-OE5-001, PR después.
**Después** (por caso):
5. Extraer: `node scripts/extract-evidence.mjs --out <carpeta> --experiment <id>` con `DATABASE_URL` y las variables de Storage en el shell del operador (el manifiesto del snapshot necesita Storage; subir `--storage-max-bytes` si el ZIP lo supera).
6. `node scripts/oe5-preflight.mjs after --package <carpeta> --expect-fixtures-min <n si aplica>`: sin ⛔; revisar los ⚠️ y las repeticiones «entorno sospechoso (revisar)».
7. Un caso con ⛔ de configuración (`modelConfig`, `budget`, estrategia) o de ejecución incompleta se invalida y se registra: no se puntúa ni se repite hasta corregir la causa y declarar la versión.
**Clasificación VT (estrategia frente a entorno):** `envSuspect` es solo informativo (reglas `ENV-01` archivo o recurso bajo `/app/` no encontrado, `ENV-03` memoria, `ENV-04` red/resolución al instalar dependencias); no es veredicto ni puntúa. Un fallo sin regla se trata como de estrategia. La reclasificación de un resultado ya visto toca el scoring: se decide ex ante o se declara.
