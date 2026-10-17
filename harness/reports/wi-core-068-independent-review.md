# WI-CORE-068 — revisión independiente (Modo fuera de casa, ciclo 1/2)
Rol: reviewer · rango 23e6ec8..HEAD (código e992951) · rama feature/jean

## Veredicto: APPROVED

Sin hallazgos bloqueantes ni mayores.

## Verificación de los puntos críticos
1. `enum` no llega a traza/DTO/handler: la entrada interna `PhpDependencyEntry.enum` solo vive en memoria. La persistencia en `experiment-job.handler.ts` (dependencyEvidence) copia por lista blanca typeName/fqcn/origin/resolvedBy/final; el mapeo de lectura `mapDependencyEntry` en `context-traces.service.ts` es igualmente lista blanca. La prueba nueva de context-traces cubre una entrada almacenada con `enum: true` y confirma que no se expone. Sin cambios en DTO, contrato ni handler.
2. Un enum conserva `final: true`: `isFinalPhpDeclaration` devuelve true para `symbolKind === 'ENUM'`; `enumTypes` es subconjunto de `finalTypes` y el servicio afirma `entries[0].final === true`.
3. No se marca dos veces ni pierde marca bajo el tope: el render usa `enum ? ENUM_MARK : final ? FINAL_MARK` (una sola marca). `applyDependencyTokenCap` copia entradas con spread (conserva `enum`), solo retira firmas/entradas; prueba con 20 enums bajo 300 tokens confirma marca en todas las restantes y cuenta de tokens coherente. Profundidad 2 solo admite `CLASS`, por lo que no hay enums transitivos.
4. `final class` sin mención a enums: FINAL_MARK = « — final: no se puede mockear; usa una instancia real con new»; prueba afirma ausencia de «enum» y «un caso».
5. Convenciones: solo cambia `PHP_PROMPT_CONVENTIONS_VERSION` a `.7`; las líneas de convención no se tocan (diff de php-phpunit-conventions.ts: 1 línea). Sin cambios en recuperación, ranking, pesos, R-PHP, targets ni agente.
6. Secretos: ninguno en el diff. Sin build, push ni migraciones.

## Cifras (re-medidas con el tokenizador del repo)
- Marca enum: 24 tokens; final nueva: 15; final previa: 24. Coincide con el informe (final 24→15).
- Deltas M4 del informe (−9 a −26) coherentes con 1 o 2 marcas final por sección.

## Pruebas
`npx vitest run src/retrieval src/generation src/context-traces`: 23 archivos pasan, 3 omitidos; 365 pruebas pasan, 13 omitidas. (Los WARN del log son de pruebas de error esperado.)

## Observaciones menores (no bloqueantes)
- `GenerationContextDependencyContext.entries` no declara `enum`; en memoria el campo viaja por tipado estructural. Es inocuo por la lista blanca, pero un futuro serializador por spread lo filtraría; considerar ocultarlo si se añade uno.
- Si `finalTypes` queda vacío se usa `firstPass` y `enumTypes` no se calcula; correcto porque un enum implica final (nunca queda enum sin final).
- La spec 004 y el changelog quedan consistentes con el alcance aprobado; el efecto sobre el LLM sigue sin medirse (declarado en el informe).
