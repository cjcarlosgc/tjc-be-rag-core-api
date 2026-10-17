# WI-CORE-058 — propuesta de contrato INTEROP-2.15 y diseño (previo a editar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Diseño
- **Determinación de `final`:** para cada entrada ya resuelta (LITERAL, IMPORT o SAME_NAMESPACE), buscar en el índice de la versión el chunk de declaración (`symbolKind` en `CLASS` o `ENUM`, `symbolName` = FQCN). Es `final` si el contenido del chunk, tras espacios, comentarios y atributos (`#[...]`), comienza con una secuencia de modificadores que incluye `final` seguida de `class` (`final class`, `final readonly class`, `readonly final class`), o si es una enumeración (`enum`, implícitamente final: no se puede mockear). `abstract class`, `interface` y `trait` no se marcan; si el tipo no está en el índice (por ejemplo, de `vendor/`) o la declaración no es legible, **no se afirma** y no se marca.
- **Contrato (aditivo):** `RagDependencyEntryResponse` agrega `final?: true` (presente solo cuando se determinó que el tipo es final; ausente = no determinado o no final). INTEROP-2.15.
- **Prompt:** la línea de la entrada final agrega `final: no se puede mockear; instancia con new o usa el tipo real`; respeta 20 entradas y 300 tokens (el recorte por tope se aplica al texto ya con las marcas).
- **No cambia:** ranking, pesos, topK, R-PHP1..5, `contextTokens`, métricas, agente generalista.

## Preguntas al reviewer
1. ¿`final?: true` opcional (omitido si falso o desconocido) o `final: boolean | null`? Recomendación: opcional `true` para no afirmar lo desconocido.
2. ¿Incluir enumeraciones como `final`? ¿hace falta un campo `kind`?
3. Versionado INTEROP-2.15, Contract Sync a console; SYSTEM sin cambio; regla en §6.7 (no rankeado) y en spec 004.
