Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-058 — revisión contractual previa de INTEROP-2.15

**status: APPROVED** con los ajustes de redacción de abajo (sin decisión de usuario nueva; `DEC-RAG-001` sigue `PENDING` y no aplica).

## 1. `final?: true` vs `boolean | null`
OK. Campo opcional nuevo en una entrada ya opcional: aditivo y retrocompatible (§1: los consumidores ignoran campos desconocidos; sin rutas, enums ni códigos nuevos). Es la forma correcta: `false` afirmaría «no final» cuando solo se sabe «no determinado» (tipo de `vendor/`, fuera del índice, declaración ilegible), y `null` obliga a todo consumidor a distinguir tres estados. Con `final?: true`, ausencia = «no determinado o no marcado como final».

## 2. Enums, `kind`, abstract/interface/trait
- Enum: veraz. Los enums de PHP 8.1 son implícitamente `final` y PHPUnit no puede crear un doble de ellos (`createMock` falla; los casos son singletons). Incluirlos es correcto.
- `kind`: NO hace falta en el contrato. `final` responde la pregunta operativa («¿puedo mockearlo?»); un `kind` ampliaría la superficie sin consumidor. Matiz de prompt (interno, no contractual): la guía «instancia con `new`» es falsa para un enum. Texto de la línea: `final: no se puede mockear; usa una instancia real (new, o un caso si es un enum)`; Core ya sabe internamente si es enum.
- `readonly class` sin `final` NO es final; solo se marca con `final` explícito. `abstract class` (mockeable), `interface` y `trait`: no se marcan (ausente). Tipo fuera del índice o declaración ambigua (p. ej. varias declaraciones con el mismo FQCN, o chunk truncado antes de la palabra `class`): no se marca.
- Salvedad de veracidad: herramientas externas (p. ej. bypass-finals) pueden eludir `final`; el contrato dice «no se puede mockear con PHPUnit estándar», no «imposible».

## 3. Redacción exacta
Interfaz (§6.7):
```ts
interface RagDependencyEntryResponse {
  typeName: string
  fqcn: string
  origin: RagDependencyOrigin
  resolvedBy: RagDependencyResolvedBy
  final?: true // INTEROP-2.15; solo PHP; presente únicamente si el chunk de declaración del tipo, resuelto en el índice de la versión, es `final class` o una enumeración; ausente = no determinado o no final
}
```
Regla (añadir a la viñeta de `dependencyContext` en §6.7):
«`final` (INTEROP-2.15) solo se emite como `true` cuando el tipo resuelto está declarado en el índice de la versión como `final class` (con o sin `readonly`) o como enumeración (implícitamente final: PHPUnit no puede crear un doble). Su ausencia no significa que el tipo sea mockeable: significa que no se determinó o que no es final (`abstract class`, `interface`, `trait`, `class` sin `final`, tipos fuera del índice como `vendor/`). No afirma nada sobre tipos fuera del índice ni sobre los no resueltos, no cambia el orden, el tope de 20 entradas ni el de 300 tokens, y no es una señal test-aware (`DEC-RAG-001`) ni de ranking. Trazas anteriores no lo tienen (sin backfill); los consumidores deben tolerar su ausencia.»

Spec 004 (añadir al final de la sección «Sección de dependencias PHP»):
«`WI-CORE-058` (2026-10-13): cada entrada resuelta cuyo tipo existe en el índice y se declara `final class` o como enumeración se marca `final` y la línea del prompt lo indica (no se puede mockear; usar una instancia real). Se determina solo desde el chunk de declaración del índice; `abstract`, `interface`, `trait`, tipos no indexados o declaraciones no legibles no se marcan y no se afirma nada. No cambia ranking, `topK`, `minimumScore`, R-PHP1..5, `contextTokens`, métricas ni el agente generalista; los 300 tokens se aplican al texto ya con las marcas. Se expone en la traza como `final?: true` (INTEROP-2.15). Motivo: en la verificación posterior a `WI-CORE-057`, `ClassIsFinalException` (mock de una `final class`) causó fallos de generación.»

## 4. Versionado y Contract Sync
- Cabecera: `INTEROP-2.15`, `Compatible con: SYSTEM-2.12` (SYSTEM sin cambio), fecha de corte 2026-10-13. Agregar al §1 la nota antes de `INTEROP-2.14` (que pasa a «fue la versión vigente»): «`INTEROP-2.15` es la versión documental vigente (`WI-CORE-058`, aditiva y retrocompatible): `RagDependencyEntryResponse` (§6.7) agrega `final?: true`; no cambia rutas, §6.16, `contextTokens` ni el ranking.»
- CONTRACT_SYNC: `source: core`, `sourceWorkItem: WI-CORE-058`, `targets: [console]`, `scopePaths: [spec/contracts/interoperability-contract.md]`, `breaking: false`. Sandbox y github-integration: NO (no consumen trazas RAG).
- `changed`: «INTEROP-2.15: RagDependencyEntryResponse (§6.7) agrega final?: true (solo PHP; presente si el tipo resuelto es final class o enum según el índice; ausente = no determinado o no final); aditivo; sin cambio de rutas, §6.16, contextTokens ni ranking.»
- `requiredAction`: «Sincronizar el espejo INTEROP-2.15 byte a byte; opcionalmente mostrar una marca «final» en las dependencias de la traza RAG, tolerando su ausencia y sin inferir «mockeable» de ella.»

## 5. Riesgo del mapeo
Confirmado: `ContextTracesService.mapDependencyEntry` devuelve hoy solo 4 campos, así que `final` se perdería. Condición de implementación: agregar `...(value.final === true ? { final: true as const } : {})`; cualquier otro valor (`false`, `null`, string, ausente) se omite sin lanzar ni invalidar la entrada; `RagDependencyEntryResponse` en los tipos/DTO de Core debe incluir el campo opcional, y `makeRagDetail` de pruebas. Pruebas: traza sin `final` (previa a 2.15), con `true`, con `false`/basura. El tope de 300 tokens ya incluye la marca; `tokenCount` debe reflejar el texto final.
