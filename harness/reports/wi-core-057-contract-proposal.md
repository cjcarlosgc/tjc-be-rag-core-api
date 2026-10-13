# WI-CORE-057 — propuesta de contrato INTEROP-2.14 y diseño (previo a editar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Diseño técnico (SDD breve)
- **Resolución (pura, solo PHP):** entradas: chunk del método objetivo (`content`, `importsUsed`, `parentSymbolName`), chunk `CLASS` y chunk `CONSTRUCTOR` de la clase declarante (mismo archivo y versión) y el conjunto de tipos conocidos de la versión (FQCN de chunks `CLASS`/`INTERFACE`/`TRAIT`/`ENUM` PHP). Extrae los tipos de los parámetros del constructor (incluidos los promovidos `private X $x`) y de la firma del método (parámetros y tipo de retorno), con `?`, `|` y `&`; descarta tipos escalares/pseudo-tipos (`int`, `string`, `self`, `static`, `array`, `callable`, `mixed`, `void`, `null`, `iterable`, `object`, `never`, `false`, `true`) y clases globales internas de PHP sin `use`. Resolución por tipo, en orden: (1) literal con `\` inicial; (2) FQCN presente en `importsUsed` del método, el constructor o la clase cuyo último segmento coincide; (3) `namespace(clase declarante)\Nombre` **solo si existe en el índice de tipos de la versión**; si no, el tipo cuenta como no resuelto y no se lista.
- **Orden y límites:** constructor primero y luego firma del método; sin duplicados por FQCN; máximo 20 entradas y 300 tokens (mismo tokenizador del contexto); marca `truncated`. Se cuenta aparte: `contextTokens`, `selectedChunks`, ranking, pesos, `topK` y relaciones R-PHP1..5 no cambian.
- **Prompt (solo PHP):** sección «Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`)» tras el código objetivo y antes del contexto relacionado; ausente si no hay entradas.
- **Cableado:** `PhpDependencyContextService` (retrieval) invocado por el brazo RAG de experimentos y por la validación de PR, pasado a `ContextBuilder.build` como parámetro adicional (patrón de `functionalRules`); `GenerationContext.dependencyContext` opcional.

## Contrato (aditivo) — INTEROP-2.14
`RagContextTraceDetailResponse` (§6.x de trazas) agrega, solo para trazas RAG con target PHP, el campo opcional:
```ts
dependencyContext?: { // INTEROP-2.14; ausente en trazas anteriores y en TypeScript
  entries: Array<{
    typeName: string // nombre corto tal como aparece en el código
    fqcn: string // nombre completo resuelto
    origin: 'CONSTRUCTOR' | 'METHOD_SIGNATURE'
    resolvedBy: 'LITERAL' | 'IMPORT' | 'SAME_NAMESPACE'
  }>
  unresolvedCount: number // tipos que no se resolvieron y no se listaron
  tokenCount: number // tokens de la sección (no incluidos en contextTokens)
  truncated: boolean
}
```
Semántica: no forma parte del ranking ni de `contextTokens`; los consumidores deben tolerar su ausencia. Evidencia §6.16 (`schemaVersion '1'`) sin cambio. Versión: INTEROP-2.14 aditiva, `breaking: false`, Contract Sync a console.
