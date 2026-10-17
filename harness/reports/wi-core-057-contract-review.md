Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-057 — revisión contractual previa de INTEROP-2.14

**status: CHANGES_REQUESTED** (cambios de redacción menores; ninguna decisión de usuario nueva). Sin ellos, APPROVED.

## Hallazgos
1. **Aditividad (OK con condición).** `dependencyContext?` opcional en `RagContextTraceDetailResponse` es aditivo: §1 obliga a los consumidores a ignorar campos desconocidos y no hay rutas ni enums nuevos. §6.16 no cambia: `EvidenceBundleResponse`/`AnalysisRunTraceResponse` no reutilizan este DTO (traza = ids; evidencia «no incluye `excerpt` ni contenido de código», `schemaVersion '1'`). `contextTokens`, `selectedChunks`, `configuration` intactos. Condición de implementación: `ContextTracesService` arma el detalle campo a campo (l.~236), por lo que el campo se pierde salvo que se añada explícitamente al mapeo (`mapDependencyContext`, devolviendo `undefined` si falta o es inválido, nunca lanzando: los detalles viejos y TS no lo tienen) y a `makeRagDetail`. Sin eso el contrato sería falso. Recomiendo exponerlo: es lo que hace auditable la mejora (HU15/HU17) y coste cero para consumidores.
2. **Campos.** Nombres correctos. Cambios:
   - Añadir en el DTO `tokenCount` como «tokens del texto de la sección tal como entra al prompt, incluido el encabezado».
   - `unresolvedCount`: solo cuenta tipos candidatos (no escalares ni clases globales internas) que no resolvieron y por eso no se listan; es un entero, no expone nombres. No incluir los nombres no resueltos (no hay forma de verificarlos y podrían inducir a inventarlos).
   - `resolvedBy` ≠ `origin`: `origin` dice dónde se declaró el tipo; si el mismo FQCN aparece en ambos, se conserva `CONSTRUCTOR` (primer orden).
   - `entries` ordenado: constructor, luego firma; sin duplicados por `fqcn`; máx. 20.
   - `truncated=true` si se recortaron entradas por 20 o por 300 tokens; `unresolvedCount` no incluye las recortadas.
3. **Sensibilidad.** `typeName`/`fqcn` son nombres de símbolos ya presentes en el snapshot y en excerpts de la misma traza; no añaden código, rutas ni secretos. Riesgo bajo; basta repetir la regla de §6.7 (datos potencialmente confidenciales) y decir que solo se emiten FQCN verificados contra el índice de la versión (no cadenas arbitrarias del código ni literales). `fqcn` sin `\` inicial.
4. **Versionado y Contract Sync.** INTEROP-2.14, `Compatible con: SYSTEM-2.12` sin cambio (SYSTEM no se toca: no hay cambio de capacidades/estados globales), fecha 2026-10-13 o la del corte. Añadir al §1 la nota de versión como las anteriores (WI-CORE-057, aditiva, sin cambio de rutas, §6.16 ni `contextTokens`). CONTRACT_SYNC: `source: core`, `sourceWorkItem: WI-CORE-057`, `targets: [console]`, `scopePaths: [spec/contracts/interoperability-contract.md]`, `breaking: false`. github-integration y sandbox: NO (no consumen trazas RAG; Sandbox sigue en línea base propia). Los dos eventos históricos globales ya constan `NOT_RELEVANT` en `wi-core-057-contract-sync-scope-review.md`.
   - `changed`: «INTEROP-2.14: RagContextTraceDetailResponse (§6.7) agrega dependencyContext? {entries[{typeName,fqcn,origin,resolvedBy}], unresolvedCount, tokenCount, truncated}, solo trazas RAG de proyectos PHP generadas tras el cambio; aditivo; contextTokens, selectedChunks y la evidencia §6.16 (schemaVersion '1') sin cambio».
   - `requiredAction`: «Sincronizar el espejo INTEROP-2.14 byte a byte; opcionalmente mostrar las dependencias resueltas en el detalle de traza RAG, tolerando su ausencia (trazas anteriores y TypeScript) y sin sumarlas a contextTokens».
5. **Spec 004 / decisiones.** `DEC-RAG-001` (test-aware) sigue `PENDING` y no se toca: la sección no es señal test-aware ni recupera pruebas. Corrección factual: `DEC-PHP-RET-001` ya está **APROBADA** (spec 018 l.110/145), no PENDING; la sección no la modifica (R-PHP1..5 intactas). Sí conviene declarar en spec 004 (Alineación o regla del `ContextBuilder`) y en tasks: «La sección de dependencias PHP es contexto determinista no rankeado: no es candidato, no participa en selección (los 10 primeros), `minimumScore`, `topK`, `maxContextTokens`, `contextTokens` ni métricas; se calcula solo desde el chunk objetivo, su constructor y el índice de tipos de la versión; no es recuperación estructural por similitud ni señal test-aware (`DEC-RAG-001`)». Declararlo también en §6.7 (regla) para que Console no lo interprete como candidato.
6. **Riesgos.**
   - Tokens fuera de `maxContextTokens`: hasta 300 tokens extra al prompt (≤ ~+3-5 %). Debe declararse que el presupuesto efectivo del prompt = `maxContextTokens` + sección; cualquier cálculo de límite de entrada del LLM debe sumar `dependencyContext.tokenCount`. Mantener tope fijo 300 y marcar `truncated`.
   - Comparabilidad OE2: la comparación SE vs SEM (§6.15) es solo retrieval, sin LLM ni prompt; la sección no aplica y no cambia P@/R@. No hay desequilibrio. En experimentos OE5 (RAG vs Agente) el brazo RAG recibe información que el Agente obtiene explorando; es el efecto buscado, pero debe documentarse como parte del tratamiento RAG-PHP y no mezclarse con corridas V1 congeladas (los resultados post-WI no son comparables con el piloto V1 sin anotar la versión). Recomiendo sumar `PhpDependencyContextService` solo a la rama `strategy RAG`; no darlo al Agente ni a PRs TS.
   - Validación de PR del producto también recibe la sección (propuesta lo contempla): el trace de AnalysisRun no la expone (solo ids); es correcto, anotarlo.
   - Trazas anteriores: sin backfill; ausencia = «no calculado», no «sin dependencias» (una lista vacía con `unresolvedCount>0` es observación real; un objeto con `entries: []` y 0 puede emitirse o omitirse: definir que se omite si no hay ni entradas ni no resueltos).

## Texto exacto a incorporar (§6.7, antes de `RagContextTraceDetailResponse`)
```ts
type RagDependencyOrigin = 'CONSTRUCTOR' | 'METHOD_SIGNATURE'
type RagDependencyResolvedBy = 'LITERAL' | 'IMPORT' | 'SAME_NAMESPACE'

interface RagDependencyEntryResponse {
  typeName: string // nombre corto tal como aparece en el código
  fqcn: string // nombre completo verificado contra el índice de la versión, sin '\' inicial
  origin: RagDependencyOrigin
  resolvedBy: RagDependencyResolvedBy
}

interface RagDependencyContextResponse {
  entries: RagDependencyEntryResponse[] // máximo 20; constructor primero, luego firma; sin duplicados por fqcn
  unresolvedCount: number
  tokenCount: number
  truncated: boolean
}
```
y en `RagContextTraceDetailResponse`: `dependencyContext?: RagDependencyContextResponse // INTEROP-2.14; solo PHP; ausente en trazas anteriores y en TypeScript`.

Regla (lista «Reglas» de §6.7): «`dependencyContext` (INTEROP-2.14) es contexto determinista no rankeado: no es un candidato, no participa en `minimumScore`, `topK`, `maxContextTokens` ni en `contextTokens`, y sus `tokenCount` (máximo 300) se suman al prompt aparte. Solo lista FQCN verificados contra el índice de tipos de la versión; `unresolvedCount` cuenta los tipos no resueltos sin nombrarlos. Los consumidores deben tolerar su ausencia. La evidencia §6.16 no lo incluye (`schemaVersion '1'`)».

## Archivos afectados (previstos)
`spec/contracts/interoperability-contract.md` (cabecera, §1, §6.7), `spec/features/004-rag-retrieval-context/spec.md`, `app/src/context-traces/context-traces.service.ts`, `app/src/experiments/experiment-job.handler.ts` (`makeRagDetail`, `initializeTraceDetail`), `app/src/retrieval/generation-context.ts`, outbox CONTRACT_SYNC nuevo, espejo Console (por el consumidor).

## Siguiente paso
Aplicar los cambios de texto, editar INTEROP-2.14 y spec 004, implementar con el mapeo explícito en `ContextTracesService` más una prueba que lo verifique (campo presente en PHP y ausente en TS), emitir el CONTRACT_SYNC a console.
