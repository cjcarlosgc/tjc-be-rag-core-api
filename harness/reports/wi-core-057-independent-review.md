Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-057 — revisión independiente (ciclo 1 de 2, Modo fuera de casa)

**status: APPROVED** (sin hallazgos bloqueantes; 3 hallazgos Low y 2 informativos, todos no bloqueantes).

Alcance revisado: código `git diff 4bbed5f^..dcfee56` (cortes A–D, implementer claude-haiku-5-5), contrato `git diff 5e6d8a6^..5e6d8a6` y los reportes del WI. HEAD revisado: `b6e3f8b` (los commits posteriores a `dcfee56` solo tocan harness/CHANGELOG/reportes). Independiente del implementer; no se editó código ni specs, no se hizo commit. Sin acceso a la base real ni a `app/.env`; replay con los datos en el scratchpad (solo lectura). Worktrees desechables `rv-head` (HEAD) y `rv-base` (`4bbed5f^`) con `prisma generate`, eliminados al terminar.

## Checkpoint PULL de CONTRACT_SYNC
Outbox `CS-CORE-20261013-002` (source core, target console, `breaking: false`, `C-PENDING`, `scopePaths` = `interoperability-contract.md`) coherente con INTEROP-2.14; github-integration y sandbox no aplican (no consumen trazas RAG). Sin entradas entrantes que afecten al WI.

## Verificaciones (evidencia ejecutada)

1. **No interferencia: OK.**
   - `retrieval.service.ts`, pesos, `topK`, `minimumScore` y R-PHP1..5 no figuran en el diff; `context-builder.service.ts` cambia 4 líneas (import, parámetro opcional, spread `...(dependencyContext ? {dependencyContext} : {})`).
   - Sonda propia (replay con orden y puntaje): para los 9 casos, `audit.candidates` ordenados por rank (chunkId, rank, decision) coinciden con lo persistido y el `combinedScore` difiere < 1e-9; con y sin sección el contexto es idéntico (JSON salvo la clave `dependencyContext`), incluidos `relatedChunks`, `contextTokens`, `selectedChunks`, `retrievedChunks`; el prompt con sección es el prompt base más exactamente `text + "\n\n"`.
   - `contextTokens` de la traza proviene de `generationContext.contextTokens` (sin sección); el mutante que suma `tokenCount` a `contextTokens` falla en `context-builder.service.spec.ts`.
2. **Resolutor con sondas propias: OK, nunca inventa FQCN.** Resultados (entradas / no resueltos):
   - Promovidos `private readonly Foo $f`, nullable, uniones, intersecciones, DNF `(A&B)|null`, retorno, valor por defecto `= null`, variádicos y por referencia: resueltos correctamente.
   - Literal `\Vendor\Pkg\Thing` → LITERAL; `\DateTimeImmutable`/`\Exception` omitidos; escalares y `self`/`static` omitidos; `SelfHelper`/`StaticThing` (nombres con `Self`/`Static`) se tratan como tipos normales; `Selfish` fuera del índice → no resuelto.
   - Varios `use` con el mismo último segmento: gana el primero (PHP lo rechazaría de todos modos). Clase fuera del índice y sin `use` → no se lista, `unresolvedCount` +1. Sin chunk de constructor, clase sin constructor y generics de docblock: sin entradas espurias.
   - `SAME_NAMESPACE` solo si `knownTypes` contiene `namespace\Nombre`; con índice vacío → 0 entradas y 1 no resuelto.
   - Namespaces con llaves: lo cubre el parser (`parentSymbolName`/`symbolName` ya salen como FQCN).
   - Límites observados (todos seguros, ver hallazgos): atributos PHP 8 en parámetros, alias `use X as Y`, nombres globales omitidos antes de `SAME_NAMESPACE`.
3. **Prompt: OK.** Sección solo en `buildPhp`; TypeScript no la renderiza aunque el campo exista (prueba existente + mutante); orden objetivo → dependencias → reglas funcionales → contexto relacionado; sin entradas no hay encabezado. Tope aplicado de verdad con cl100k: 20 FQCN largos → 10 entradas, 285 tokens, `truncated`; con tope 100 → 2 entradas, 77 tokens; 30 tipos → 20 entradas y `truncated`. `countTokens(text) === tokenCount` y ≤ 300 en los 9 casos.
4. **Traza: OK.** Mapeo explícito en `ContextTracesService.mapDependencyContext` (campo a campo, `text` nunca serializado: lo verifican `makeRagDetail` y el mapeo; mutantes M4/M4b matan); PHP presente, ausente/inválido → omitido sin lanzar, entradas inválidas descartadas, `fqcn` con `\` inicial descartado. Forma coincide con INTEROP-2.14 (`entries[{typeName,fqcn,origin,resolvedBy}]`, `unresolvedCount`, `tokenCount`, `truncated`). `toAnalysisContextEvidence` (§6.16/AnalysisRun) solo lee `audit` y `contextTokens`: no expone la sección.
5. **Cableado: OK.**
   - Brazo RAG de experimentos y validación de PR reciben la sección; el agente generalista no (spec: `resolve` se llama 3 veces, solo RAG; mutante que lo llama en el brazo agente falla).
   - Fallo del repositorio: el cuerpo completo de `resolve` está en `try/catch`, warn y `null`; la generación continúa.
   - DI: sonda con `Test.createTestingModule` (Prisma simulado) resuelve `PhpDependencyContextService` con `CodeChunksRepository` y ejecuta `resolve` end-to-end (consulta con `projectVersionId` y `symbolKind in [CLASS, INTERFACE, TRAIT, ENUM]`). Metadatos de módulo: `RetrievalModule` provee y exporta el servicio e importa `ProjectVersionsModule` (exporta `CodeChunksRepository`); `ExperimentsModule` y `ValidationModule` importan `RetrievalModule`; `design:paramtypes` de ambos handlers incluye el servicio y el del agente generalista no. Un módulo completo con `AppModule` no es viable sin entorno (dependencias de otros módulos globales), por lo que la cadena real de módulos se verificó por metadatos.
6. **Replay: OK.** `PHP_DEP_REPLAY_DIR` → 9/9 pasan (spec del implementer) y mi sonda ampliada (rank y puntaje) también. Tabla de tokens reproducida: SAL-1 51/517, SAL-2 0/457, SAL-3 0/478, RES-1 64/444, RES-2 64/448, RES-3 0/654, SUB-1 91/700, SUB-2 91/678, SUB-3 53/647; SUB-1/SUB-2 resuelven `RenewalDatePolicy → Pilot\Subscriptions\Services\RenewalDatePolicy` (SAME_NAMESPACE, constructor), sin `Contracts\RenewalDatePolicy`. Coincide con `wi-core-057-replay-y-verificacion.md`.
7. **Mutantes: 15/15 muertos por los specs versionados** (sin contar mis sondas): SAME_NAMESPACE sin índice, no excluir escalares, sin tope de tokens, sin tope de 20, servicio sin tope, `text` en la traza (handler) y en el mapeo, sección al agente, orden de candidatos alterado, `contextTokens` + sección, mapeo ausente, TS recibe sección, validación de PR sin sección, brazo RAG sin sección, orden del prompt alterado.
8. **Contrato: OK.** INTEROP-2.14 (tras `dcfee56`) describe lo que hace el código: IMPORT y LITERAL toman el nombre del código y no se verifican contra el índice; solo `SAME_NAMESPACE` se verifica; escalares y clases globales internas no se listan; objeto omitido sin entradas ni no resueltos; `tokenCount` incluye encabezado; presupuesto efectivo = `maxContextTokens` + sección. Coherente con spec 004 (declara "no rankeado", `DEC-RAG-001` PENDING, R-PHP1..5 intactas, TS y agente sin sección). Reglas de §6.16 sin cambio. La redacción "tipos candidatos" de `unresolvedCount` incluye tokens basura de parámetros con atributos (ver H1), sin consecuencia contractual.
9. **Alcance: OK.** Sin migraciones, sin `sandbox/`, sin evidencia ni métricas; `DEC-RAG-001` no se modificó (solo se menciona como PENDING); solo ficheros previstos en el contrato-propuesta más `README.md`, `CHANGELOG.md`, outbox y harness.
10. **Gates (en worktree desechable, sin build): OK.**
    - `npx vitest run` completo: 144 archivos pasan, 7 omitidos; 2276 pruebas pasan, 104 omitidas (igual que lo declarado).
    - `oxlint src/ test/`: salida vacía, exit 0.
    - `tsc --noEmit`: 45 errores en HEAD y 45 en `4bbed5f^`; conteo idéntico por archivo (delta 0; ningún archivo de producción del WI aparece, los 45 son preexistentes en specs/otros).
    - `node harness/validate-harness.mjs`: "Harness V3 validation passed", exit 0. `node --test harness/*.test.mjs`: 31/31 pasan.

## Hallazgos

| ID | Severidad | Hallazgo | recommendedNextStep |
|---|---|---|---|
| H1 | Low | Parámetros con atributos PHP 8 (`#[Autowire] private Foo $f`, `#[SensitiveParameter] \A\B $a`) pierden el tipo: `parameterType` no descarta `#[...]`; el candidato queda no resuelto (no se inventa nada) y sube `unresolvedCount` con un nombre basura. Es una brecha de cobertura frecuente en Symfony/Laravel moderno. | No bloquea. Anotar como deuda del WI/Fase 2 (quitar `#[...]` antes de extraer el tipo) con un caso en `php-dependency-context.spec.ts`. |
| H2 | Low | Una clase del mismo namespace con nombre de la lista global (`Exception`, `Iterator`, `Closure`, `DateTime`…) sin `use` se omite antes de consultar `SAME_NAMESPACE`, aunque PHP la resolvería al namespace actual. Omisión silenciosa (ni listada ni contada), nunca un FQCN falso. | No bloquea. Si se corrige, intentar `SAME_NAMESPACE` antes de la omisión por lista global cuando el namespace no es global. |
| H3 | Low | `importsUsed` guarda solo el FQCN, no el alias: `use A\Foo as Bar` + `Bar $x` queda no resuelto (seguro); con `use A\Foo as Bar` y un `Foo` del mismo namespace usado sin alias, el resolutor lo etiqueta `IMPORT A\Foo` (FQCN equivocado, muy improbable). No documentado en spec 004/contrato. | No bloquea. Documentar el límite en spec 004 o aceptar como deuda; resolverlo exige propagar el alias desde el parser (fuera de este WI). |
| H4 | Info | Cada repetición RAG ejecuta `findByFile` y `findPhpTypeSymbolNames` (todos los tipos PHP de la versión). Correcto, ligero a esta escala; podría cachearse por `projectVersionId` si crecen las versiones. | Sin acción ahora. |
| H5 | Info | El spec de replay del implementer solo compara el *conjunto* SELECTED con lo persistido; mi sonda verificó además rank y puntaje (idénticos). Constructores o métodos cuyo primer chunk excede `INDEXING_MAX_CHUNK_TOKENS` (1500) pierden la sección (paréntesis sin cerrar → sin entradas): seguro, raro. | Sin acción. |

## Veredicto

**APPROVED.** La sección no altera ranking, selección ni contadores; no inventa FQCN; el contrato es honesto con el código; el cableado y el DI son correctos; los gates pasan con delta 0 de tsc y 15 mutantes muertos. No hay decisión `DEC` abierta que bloquee este WI (`DEC-RAG-001` sigue PENDING y no se toca). Esta aprobación no sustituye la decisión de alcance/arquitectura del usuario ni autoriza push, PR ni infraestructura externa; el push exige la revisión acumulada del rango completo.

Archivos de evidencia (solo lectura): `/private/tmp/claude-501/-Users-jean-Tesis-workspaces-tjc-be-rag-core-api/21ca7d6e-6f1a-4e4b-8d29-926b10f078f3/scratchpad/rv-probes-saved/`, `rv-probe-out.txt`, `rv-replay2-out.txt`, `rv-tsc-head.txt`, `rv-tsc-base.txt`.
