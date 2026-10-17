Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-058 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**Veredicto: CHANGES_REQUESTED** (hallazgos menores y acotados; sin decisión abierta ni cambio de alcance).
Rango: contrato `4b0f34a^..4b0f34a`, código `334708c^..334708c`. Independiente del implementer (claude-haiku-5-5). Sin acceso a DB real ni `.env`; replay en solo lectura.

## Hallazgos
| # | Severidad | Hallazgo |
|---|---|---|
| F1 | MEDIA | Un FQCN con dos declaraciones en el índice se marca por una sola elegida de forma no determinista. `findPhpTypeDeclarations` ordena solo por `partIndex` y luego por rango CLASS/ENUM antes que INTERFACE/TRAIT; con dos `CLASS` del mismo FQCN en archivos distintos (ambas `partIndex` 0) gana el orden arbitrario de la DB. El contract-review (§2) exigía «varias declaraciones con el mismo FQCN: no se marca» y el contrato dice «no afirma lo no determinado»; el implementer lo reconoce como límite en technical-checks, pero no está en la spec ni se cumple la condición aprobada. Riesgo práctico bajo (falsa marca `final` lleva al LLM a instanciar en lugar de mockear una clase mockeable; falso negativo equivale al estado previo), pero es una afirmación sin base. También CLASS+INTERFACE del mismo nombre prefiere CLASS sin señalar ambigüedad. |
| F2 | BAJA | `CodeChunksRepository.findPhpTypeDeclarations` (consulta, orden, deduplicación, filtro `.php`) no tiene prueba propia; el replay y el servicio usan un doble que reimplementa su semántica, así que una regresión del método real no la detecta ningún spec. Aceptable solo si F1 se corrige en el servicio con prueba; lo adecuado es una prueba unitaria con prisma simulado (dos filas del mismo `symbolName` → ambigua / no marcada; orden CLASS antes que INTERFACE; `symbolNames` vacío → sin consulta). |
| F3 | BAJA | Mutantes que sobreviven: (a) `final function`/`final public function` aceptado como clase (regex con `function`): sin sonda en el spec (hoy no alcanzable porque el `symbolKind` del repositorio es de tipos, pero no hay red de seguridad); (b) quitar `.slice(0, 20)` del servicio: ninguna prueba con más de 20 FQCN; (c) `catch` devolviendo `finalTypes` en vez de un `Set` nuevo es equivalente. Se piden dos casos de spec triviales (a, b). |
| F4 | INFO | `findPhpTypeDeclarations` selecciona `content` de todas las partes de hasta 20 símbolos (descarta las posteriores en memoria); costo menor, mejora posible con `partIndex: 0`/primera parte. No bloquea. |

## Verificación (evidencia ejecutada)
1. **No-interferencia:** replay `php-dependency-replay.spec.ts` con `PHP_DEP_REPLAY_DIR` (solo lectura): 9/9 pasan; `relatedChunks`, `audit.candidates`, `contextTokens`, `selectedChunks`, `retrievedChunks` idénticos con y sin sección/marcas y SELECTED = persistido. El diff de producción no toca ranking, pesos, topK, minimumScore ni R-PHP; el agente generalista y TypeScript (`language !== 'php'` → null) sin cambio.
2. **`isFinalPhpDeclaration`, 34 sondas propias, todas OK:** `final class`, `final readonly class`, `readonly final class`, `FINAL CLASS`, `final\nclass` → true; `abstract final` y `final abstract` → false; atributos multilínea/anidados/con `]` en cadena antes → true; docblock con «final class» dentro → false; `//` y `#` con `final class` → false; `class A { // final class }` → false; método/propiedad llamado `final` en clase no final → false; `final function`/`final public function` → false; interface/trait/abstract/readonly sin final → false; ENUM por `symbolKind` → true (y `enum` con `symbolKind` CLASS → false); contenido con `namespace`/`<?php` antes de la declaración → false (conservador; el chunker entrega el nodo de declaración, confirmado en los chunks del replay); vacío, basura, comentario sin cerrar, `undefined`/`null` → false sin lanzar.
3. **Servicio:** consulta solo los FQCN resueltos únicos (`slice` a 20); tipo fuera del índice no se marca; error del repositorio → warn solo con el nombre del error, sin marcas y con las entradas intactas. Dos declaraciones: ver F1.
4. **Prompt:** texto de marca exacto = el aprobado; recorte de 300 tokens se aplica al texto ya marcado y `tokenCount` = `countTokens` del texto final (mutante «cap sin marcas» falla el spec).
5. **Traza:** `mapDependencyEntry` y el handler emiten solo `final: true` (mutantes `false`/truthy/«any» fallan); INTEROP-2.15 (cabecera, §1, interfaz §6.7, regla), DTO `RagDependencyEntryResponse`, `GenerationContextDependencyContext` y spec 004 coinciden; trazas previas sin `final` siguen válidas (spec «keeps a previous trace without final»).
6. **Replay:** tabla reproducida: +24 tokens por marca (48 con dos), secciones 139/139/101/99/112/112/0/0/0, todas ≤ 300; base y porcentajes iguales a replay-y-verificacion.
7. **Mutantes** (contra los 5 specs del cambio): abstract→marcado, interface marcada, sin lectura de atributos, `final:false` (resolutor, traza, handler), traza truthy, tipo fuera del índice marcado, sin marca en render, cap sin marcas → todos fallan. Sobreviven solo los de F3.
8. **Alcance:** sin migraciones, sin `sandbox/`, evidencia §6.16 ni métricas; `DEC-RAG-001` PENDING y no aplicable (señal no test-aware); Contract Sync a Console correcto según contract-review.
9. **Gates:** `vitest` completo 144 archivos / 2312 pruebas pasan (104 omitidas); `oxlint src` limpio; `tsc --noEmit` delta 0 por archivo contra `334708c^` (worktree desechable con `prisma generate`; 16 archivos con errores previos idénticos); `validate-harness` pasa; `node --test harness/*.test.mjs` 31/31. Sin build (por instrucción). Worktrees propios eliminados.

## Estado y siguiente paso
- `status`: CHANGES_REQUESTED · `blockers`: ninguno externo · `filesAffected`: `app/src/project-versions/persistence/code-chunks.repository.ts`, `app/src/retrieval/php-dependency-context.service.ts`, specs correspondientes.
- **recommendedNextStep:** implementer corrige F1 (el repositorio devuelve todas las filas y el servicio no marca un FQCN con más de una declaración de tipo, o devuelve un indicador de ambigüedad; sin cambiar contrato ni spec salvo aclarar «declaración única» en 004 si el leader lo aprueba) y agrega pruebas F2/F3 (duplicado → no marcado, repositorio con prisma simulado, `final function`, >20 FQCN); luego ciclo 2 de revisión. Sin push.

---

# Ciclo 2 de 2 (Modo fuera de casa) — rango `334708c..3d209a4`

**Veredicto final: APPROVED** (con observaciones no bloqueantes). Independiente del implementer. Sin acceso a DB real; sin edición de código ni commit.

## Verificación de F1-F4
- **F1 corregido.** `findPhpTypeDeclarations` filtra `partIndex: 1`, ordena por `(symbolName, filePath, partIndex)`, agrupa por `symbolName` y omite todo FQCN con más de una declaración (mismo nombre en archivos distintos, o CLASS junto a INTERFACE/TRAIT/ENUM). La ambigüedad vive en el repositorio; el servicio solo consume lo devuelto. Los parsers PHP y TS numeran las partes desde 1 (`partIndex: index + 1`; columna `@default(1)`), por lo que `partIndex = 1` no pierde declaraciones legítimas; una declaración troceada devuelve su parte 1 (donde están los modificadores) y las partes 2+ no cuentan como otra declaración.
- **F2 cubierto.** El spec con prisma simulado cubre: sin consulta con lista vacía, `where` exacto (versión, kinds, nombres únicos, `.php`, `partIndex: 1`), `select`, `orderBy`, mapeo, omisión por duplicado entre archivos, omisión CLASS+INTERFACE y descarte de partes no iniciales.
- **F3 aceptado.** Casos de servicio agregados (clase no final con método `final public function` no se marca; >20 FQCN envía 20 únicos). El mutante «quitar `.slice(0, 20)`» del servicio sobrevive: se acepta como equivalente porque el resolutor ya limita a 20 aguas arriba. Sigue sin sonda unitaria de `isFinalPhpDeclaration('final function …', 'CLASS')` (el mutante `class|function` sobrevive); inalcanzable en producción porque el `symbolKind` proviene de tipos, no bloquea.
- **F4** sin impacto (la consulta ahora solo trae la parte 1).

## Mutantes del repositorio (todos muertos por los specs)
Sin filtro `partIndex` en `where`; sin descarte de partes no iniciales en el bucle; sin omisión de duplicados (`>= 1`); sin `projectVersionId` (mezcla de versiones/proyectos); sin `endsWith('.php')`; sin `orderBy` determinista. Base 20/20 pasan; cada mutante falla al menos 1 prueba.

## Gates
`vitest` completo: 144 archivos / 2320 pruebas pasan (104 omitidas); `oxlint src` limpio (exit 0); `tsc --noEmit` delta 0 por archivo contra `334708c` (17 archivos con errores previos idénticos, worktrees desechables con `prisma generate`); `validate-harness` pasa; `node --test harness/*.test.mjs` 31/31. Sin build (por instrucción). Worktrees propios eliminados (queda un worktree ajeno `wt-php` en el scratchpad).

## Pendiente
- Nada bloqueante. Opcional: sonda unitaria `final function` y retirar o documentar el `slice` redundante del servicio.
- Aprobación humana de alcance/arquitectura y push siguen reservados al usuario; el Modo fuera de casa no los sustituye.
