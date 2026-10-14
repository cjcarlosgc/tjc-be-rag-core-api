Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-064 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: CHANGES_REQUESTED** (un hallazgo medio de redacción del prompt; el resto verificado sin defectos).
Rango: `git diff 009fa85^..009fa85` (5 archivos). Implementer: claude-haiku-5-5; revisor independiente.

## Verificaciones ejecutadas
1. **No interferencia: OK.** El diff no toca retrieval/ranking/ContextBuilder/R-PHP/pesos/topK. `PHP_DEP_REPLAY_DIR=… vitest run php-dependency-replay.spec.ts`: 9/9. `calibrate.mjs --data calib-data`: 9 casos `OK linea base`, M5 10/10 en todos (nota: la herramienta escribe `report.json/md` en el directorio de datos del scratchpad; no es base real).
2. **Pareado: OK.** Sonda en worktree desechable (HEAD vs `009fa85^`, servicio real y ContextBuilder real sobre los 9 casos): al quitar el bloque de 3 líneas, el prompt RAG y las instrucciones del agente quedan byte a byte iguales a la versión previa en los 9 casos; las líneas aparecen una sola vez; ambos brazos usan la misma constante `PHP_PHPUNIT_CONVENTION_LINES`; prompt TypeScript idéntico byte a byte. Inserción RAG: tras «Extiende…», antes de ubicación/código/dependencias; agente: tras la línea de `use`, antes del límite de llamadas.
3. **Contenido:**
   - (a) assertEquals/assertSame: correcto (VO con `==`; `assertSame` para escalares/identidad).
   - (b) PHPUnit 11 no puede crear dobles de clases `final` ni de enums (enums son implícitamente `final`): afirmación cierta. **Defecto: ver H1.**
   - (c) FQCN: la cita «Dependencias del código objetivo» no confunde a consumidores: el encabezado solo se define en `php-dependency-context.ts` (y `harness/calibration/lib.mjs` lo reconstruye); `renderDependencySection` usa `context.dependencyContext.text`, no busca el encabezado en el prompt; el único detector era el test de WI-057, ya anclado con `/^…/m`. Para el agente (sin sección de dependencias) la cita nombra una sección inexistente (ver H2, bajo).
4. **Tokens:** las tres líneas = 35+44+36 = **115 tokens** (cl100k), recomputado. Con el prompt RAG real de los 9 casos: +11.2 % SAL-1, +13.2 SAL-2, +12.5 SAL-3, +12.0 RES-1, +11.9 RES-2, +10.5 RES-3, +8.9 SUB-1, +9.1 SUB-2, +9.6 SUB-3. **9/9 ≤ 15 %**; lo declarado (10.2–16.8 %, SAL-2/SAL-3 sobre 15 %) sobreestima (usa un prompt fijo estimado ≈187); el informe y la spec/CHANGELOG dicen «+10 % a +17 %» (ver H3). Agente: instrucciones 294–304 → +38 % (el agente no tiene prompt de contexto único, el criterio ≤15 % no le aplica de forma directa; no está declarado).
5. **Versión `php-prompt-2026-10-14.2`:** consistente en código (constante), spec 004, CHANGELOG, informe de replay y test.
6. **Mutantes (todos matados):** quitar una línea (falla «exactly three»), intercambiar orden (falla), línea solo en RAG o solo en agente (falla `inserts…` / `agent arm…`), redacción divergente en el agente (falla), alterar prompt TypeScript (3 fallos), mover las líneas tras la sección de dependencias (2 fallos).
7. **Alcance: OK.** Sin contrato público, migraciones, ranking ni herramientas; DEC-RAG-001 sigue PENDING; sin push.
8. **Gates:** vitest completo 145 archivos/2385 pruebas pasan (7/104 omitidos); `oxlint src` exit 0 sin hallazgos; `tsc --noEmit` 45 errores en HEAD y 45 en `009fa85^`, delta 0 por archivo (worktree, prisma generated enlazado); `validate-harness` pasa; `node --test` 57/57. Sin build. Worktrees propios eliminados; sin cambios en el repo.

## Hallazgos
- **H1 (medio, corrección del prompt):** la línea (2) dice «No uses createMock/… con clases `final` ni enums: **instáncialas con `new`**». Un enum PHP no se puede instanciar con `new` (error fatal «Cannot instantiate enum»); se usa un caso (`Enum::Caso`). Además contradice la línea ya existente de WI-058 en la sección de dependencias («new, o un caso si es un enum»). Induce un error real en las pruebas generadas para tipos enum (p. ej. `SubscriptionStatus`). El test «agreed wording (v)» fija el texto defectuoso.
- **H2 (bajo):** la línea (3) cita «Dependencias del código objetivo» también en el agente, que no recibe esa sección; el alcance aprobado decía «si existe». Inocuo, pero la redacción única la presenta como incondicional.
- **H3 (bajo, documentación):** las cifras de tokens declaradas (+10 %/+17 %, 7/9 ≤ 15 %) no coinciden con el prompt real (+8.9 %/+13.2 %, 9/9); conviene corregir informe, spec 004 y CHANGELOG, o aclarar que son estimaciones.

## recommendedNextStep
Corregir la redacción de la línea (2) en `php-phpunit-conventions.ts` (p. ej. «instáncialas con `new`, o usa un caso si es un enum») y mantener la misma constante en ambos brazos; ajustar los tests de redacción (v), opcionalmente condicionar «si existe» en (3) y alinear cifras de tokens en informe/spec/CHANGELOG; subir la versión del prompt (`.3`) si cambia el texto y repetir sonda de pareado, replay y vitest. Ciclo 2 de 2 sobre ese corte.

filesAffected (revisados): `app/src/generation/php-phpunit-conventions.ts`, `app/src/generation/prompt-builder.service.ts`, `app/src/experiments/experiment-job.handler.ts`, sus specs. blockers: ninguno.


## Ciclo 2 de 2 (Modo fuera de casa) — rango `009fa85..dc45e1e`

**Veredicto final: APPROVED.** Revisor independiente del implementer; sin base real.

- **H1 resuelto:** la línea 2 dice «instancia las clases con `new` (un enum, con uno de sus casos)»; coherente con la marca de WI-058 («new, o un caso si es un enum»). Sin contradicción.
- **H2 resuelto:** la línea 3 dice «(si hay una sección de dependencias, también los de ella)»; no cita el encabezado entre comillas (comprobado sobre los 9 prompts RAG y las 9 instrucciones del agente: sin «Dependencias del código…» citado); coherente con el agente.
- **H3 resuelto:** sonda sobre el prompt RAG real de los 9 casos (HEAD vs `1d22c2e`): las tres líneas = 35+52+39 = **126 tokens** cl100k; delta de prompt RAG 126 en 9/9 → +9,8 % a +14,4 % (SUB-1 9,8; SUB-2 9,9; SUB-3 10,5; RES-3 11,5; SAL-1 12,2; RES-2 13,0; RES-1 13,1; SAL-3 13,7; SAL-2 14,4), 9/9 ≤ 15 %. Spec 004, CHANGELOG y informe de replay declaran 126 y «≈ +10 % a +14,5 %»/«+9,8 % a +14,5 %» (redondeo conservador del máximo 14,4; aceptable). Agente: +126 tokens.
- **Versión:** `php-prompt-2026-10-14.3` consistente en constante, test, spec 004, CHANGELOG e informes; sin restos de `.2` (salvo el texto histórico de mi ciclo 1).
- **Pareado y TypeScript:** cada línea aparece exactamente una vez en el prompt RAG y una vez en las instrucciones del agente (misma constante); prompt TypeScript byte a byte idéntico a la base en 9/9.
- **Mutantes (ambos detectados):** volver a «instáncialas con `new`» y volver a citar el encabezado fallan «exports exactly the three convention lines in the agreed wording (v)».
- **Gates:** vitest completo 145 archivos/2385 pruebas (7/104 omitidos); `oxlint src` exit 0; `tsc --noEmit` 45 errores en HEAD y 45 en la base (delta 0); `validate-harness` pasa; `node --test harness/*.test.mjs harness/calibration/*.test.mjs` 57/57. Worktrees eliminados; sin cambios en el repo.

**Pendiente (no bloquea):** el efecto real de las instrucciones sobre la calidad de las pruebas no es medible sin LLM; requiere el experimento no oficial con el criterio de verificación del informe de replay (versiones declaradas, `promptSha256` distinto). La versión del prompt no se persiste en la traza. Cierre del WI y push quedan para el usuario/leader.
