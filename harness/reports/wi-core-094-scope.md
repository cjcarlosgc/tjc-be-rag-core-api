# WI-CORE-094 — extractor de evidencia de solo lectura (script en `app/scripts`)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de Core el 2026-10-24: «Apruebo el WI del extractor de evidencia de solo lectura en app/scripts: rol propietario en transacción READ ONLY, SUPABASE_SECRET_KEY solo con download, paquete con manifiesto, redacción en copia aparte y manejo de PII; yo pongo las credenciales en mi shell. Mi decisión sobre código de terceros en» (el texto llegó **truncado** por el límite de 300 caracteres del botón; la opción elegida se llamaba «Aprobar extractor» y la frase completa que ofrecía era «…código de terceros en mi disco: permitido para los pilotos»). **Pendiente de confirmar por el usuario:** la decisión 4 (guardar en su disco el código de terceros que contengan los tests generados de los pilotos, repos públicos); el extractor no depende de ella para construirse y el default del diseño es escribir solo lo que el análisis define (tests generados, evidencia y metadatos), nada del código fuente del repo piloto. Base: `harness/reports/extractor-evidencia-analisis.md` (WI-CORE-093, revisado en 2 ciclos) y el pedido de cross del 2026-10-24.

## Alcance aprobado

Un script versionado, **fuera del producto** (sin endpoints, DTO, contratos ni cambios en `app/src`), en `app/scripts/` (fuera de `dist` y del build; sus pruebas corren en CI con `vitest`), que dado un AnalysisRun y/o un ExperimentRun escribe un **paquete** (carpeta JSON + CSV) con lo que el análisis marcó como PERSISTIDO o CALCULABLE:
1. test generado por repetición e intento (`experiment_repetition_artifacts.testContent`, con marca de truncado y `testContentSha256`) y la última versión por símbolo del AnalysisRun (`generated_test_proposals`, contenido leído de Storage con `download`);
2. `sandboxEvidence` (stdout/stderr acotado y saneado; solo experimentos) y hechos del resultado del Sandbox; `modelConfig` y `generation`;
3. trace de 9 enlaces en sentido directo y **chequeo inverso** con joins de solo lectura (con identificadores entre comillas dobles y la comprobación `<>` que debe dar 0 filas);
4. SHA-256: verificación de los hashes persistidos sobre los **bytes de la BD** (`hash-verification`), y manifiesto con el SHA-256 de cada archivo del paquete;
5. campos automáticos de la Tabla 70 (Fecha, Proyecto/snapshot/Run y, parcial, Tipo) y tokens/tiempos/intentos/budgets;
6. **manifiesto** (`manifest.json`): versión del esquema del paquete, `generatedAt`, identificadores, archivos con tamaño y SHA-256, y la lista de **ausencias y truncados** (lo no persistido: prompt completo, respuesta cruda del LLM, contexto RAG completo, trazas completas del agente, oráculo, log completo de `composer install`; migraciones no aplicadas).

## Decisiones aprobadas (el usuario) y defaults del leader

- **Acceso a BD:** rol propietario (el de `DATABASE_URL` que el operador exporta en su shell) dentro de `BEGIN; SET TRANSACTION READ ONLY` y solo `SELECT`; las tablas tienen RLS sin políticas, por lo que un rol de lectura sin `BYPASSRLS` vería 0 filas (no se crea un rol nuevo). Una prueba demuestra que cualquier escritura falla.
- **Storage:** `SUPABASE_URL` y `SUPABASE_SECRET_KEY` en el shell del operador; **solo `download`**, cliente propio (sin reutilizar el adaptador del producto, que crea buckets).
- **Credenciales:** el script **no carga `.env`**; nunca imprime ni escribe `DATABASE_URL` ni claves; los errores no hacen eco de valores.
- **Redacción:** de secretos **en una copia aparte** (la utilidad de producto mutilaría un test PHP/TS); el hash se verifica sobre los bytes originales de la BD y el manifiesto registra ambos hashes.
- **PII (default del leader dentro de «manejo de PII»):** `actorLogin`, `prTitle`, refs/`branchName` y la URL del companion PR **se omiten o anonimizan (hash estable) por defecto** y solo se incluyen con un flag explícito (`--include-pii`); el manifiesto registra qué se omitió.
- **Salida:** la carpeta de salida es obligatoria (`--out`) y se rechaza si está dentro del repositorio salvo flag explícito; sin dependencias nuevas (`@prisma/adapter-pg` y `@supabase/supabase-js` ya son directas).
- **Migraciones:** el script **no aplica nada**; comprueba que existan las tablas (`20261013100000` y `20261013110000`) y, si faltan, lo declara en el manifiesto en vez de fallar a medias.

## Fuera de alcance

Persistir algo nuevo (prompt, respuesta cruda, contexto RAG, trazas del agente, logs completos de `composer install`: funcionalidad posterior al tag), endpoints o botones, cambios en `app/src`, contratos, esquemas, migraciones, lint (`app/scripts` no entra en `oxlint` salvo decisión aparte), `Tesis-Validacion`, consultar la base real durante el desarrollo (las pruebas usan fixtures), push de datos o credenciales.

## Criterios

Lint, tests y build verdes; el script y sus pruebas no rompen el CI; una prueba verifica transacción READ ONLY y solo SELECT; pruebas con fixtures del paquete (estructura, manifiesto, hashes, truncados, ausencias, redacción en copia aparte, PII por defecto, rechazo de `--out` dentro del repo, migraciones ausentes); sin secretos en ninguna salida; revisión independiente del `reviewer` con foco en seguridad.
