# WI-CORE-104 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo bajo

## Veredicto
**APPROVED.** No hay hallazgos de severidad alta ni media. Hay 5 hallazgos bajos, que no bloquean y son residuos conocidos o de documentación. No repetí la revisión contractual de INTEROP-2.23; solo revisé que el código y los docs coincidan.

## Hallazgos

1. **Baja: la profundidad 2 sigue sin visibilidad.**
   - `resolveTransitiveEntries` (`php-dependency-context.service.ts` ~l.225-320) crea entradas `via` con `signature` y la marca `final` aunque el constructor de ese tipo sea privado.
   - Una clase final de profundidad 2 con constructor privado recibe «usa una instancia real con new» y su firma.
   - Está explícitamente fuera de alcance («profundidad 2 sin cambio»), pero es un residuo que puede decirle algo engañoso al modelo. Conviene registrarlo como limitación o WI futuro, con los demás residuos del piloto.

2. **Baja: alias `use A\Foo as Bar`.**
   - `importsUsed` guarda el `moduleSpecifier` sin alias (`php-parser.service.ts:275`), así que el glosario muestra `Foo → A\Foo`, pero el código usa `Bar`.
   - No es falso (el FQCN es correcto), pero es inútil o confuso. Ya está declarado en `wi-core-104-technical-checks.md` («Límites»).
   - El glosario también incluye imports cuyo alias solo aparece en comentarios del chunk, porque el parser filtra por `\balias\b`. Es inocuo.

3. **Baja: el glosario no marca recorte por el tope de 30.**
   - `buildPhpFqcnGlossary` corta en 30 sin que `truncated` pase a true.
   - `truncated` solo refleja el recorte por tokens.
   - El spec dice «`truncated` refleja cualquier recorte» en el contexto de los 500 tokens, así que no hay contradicción literal. Conviene aclarar la redacción o dejarlo como está.

4. **Baja: la consulta de fábricas puede dejar sin fábricas a las clases tardías.**
   - `findPhpStaticMethodDeclarations` ordena por `parentSymbolName` y aplica `take 400` en total.
   - Con muchas clases y métodos con la palabra `static`, las clases alfabéticamente tardías podrían perder sus fábricas. Solo se omite información, nunca se afirma algo falso.
   - El prefiltro `contains: 'static'` distingue mayúsculas. Ambos puntos ya están declarados en los límites.

5. **Baja: documentación parcialmente desactualizada.**
   - En `spec/features/004-rag-retrieval-context/spec.md`, los bullets de WI-CORE-065/066 siguen diciendo «se retiran primero las firmas / entradas de profundidad 2». El nuevo bullet de WI-CORE-104 sí documenta el orden correcto: glosario, fábricas, firmas, entradas.
   - La frase «500 tokens (300 hasta `WI-CORE-103`; `WI-CORE-104`)» está redactada de forma torpe.
   - `work-items.json` dice «publicado por Contract Sync», pero ese evento aún no existe en este árbol. Es consistente con `G-NOT_RUN` y `W-IN_REVIEW`; al cerrar hay que verificar que el CS se publicó.

## Verificación por punto de la solicitud

1. **Extractores.** Ejecuté sobre `dist/` una batería de casos límite.
   - Constructor.
     - Detecta correctamente `private`, `final private`, atributo con la palabra `private` en una cadena, docblock con `private`, constructor promovido, sin modificador (devuelve `public`), mayúsculas y CRLF.
     - Devuelve `null`, sin afirmar nada, en estos casos: `private public`, comentario entre modificador y `function`, `&__construct`, prefijo `use Foo;` y `readonly function`.
     - No hay ningún caso en que diga «privado» de un constructor público.
   - Fábricas.
     - Acepta `static`, `self`, `?static`, la clase corta y el FQCN con barra inicial; el orden de los modificadores es indiferente y también se aceptan docblock, atributo, valores por defecto con `)` dentro de una cadena y el `:` del tipo de retorno en la línea siguiente.
     - Rechaza uniones (`static|null`, `null|static`), no públicos, abstractos, no estáticos, métodos mágicos `__*`, retornos como `selfish`, `never`, `Money&Foo` o `\Other\Money`, y métodos sin retorno.
     - Un `static fn` dentro del cuerpo de un método no estático no produce falso positivo.
   - Un caso extremo muy raro: un retorno `Money` se acepta por nombre corto aunque en el archivo `Money` sea un alias de otra clase. No se pudo reproducir con datos reales y es de severidad despreciable.

2. **Servicio y repositorio.**
   - Filtro por `projectVersionId` presente (la mutación M6 lo detecta).
   - `take` 400 y orden determinista.
   - Solo dependencias directas confirmadas como `CLASS` en `index.kinds`. Un tipo ambiguo no está en `kinds`, así que se omite. M7 lo detecta.
   - El error de fábricas se captura con `warn` y devuelve un mapa vacío (M17 lo detecta).
   - Si es privado o protegido, la firma no se guarda ni se imprime.
   - La profundidad 2 usa el mapa `constructors` y no se ve afectada (ver hallazgo 1).

3. **Glosario y composición.**
   - Orden target primero y luego los chunks seleccionados, sin duplicados por FQCN, excluye dependencias directas y de profundidad 2 y la clase declarante.
   - Descarta FQCN de un solo segmento y tiene tope de 30.
   - El tope de 500 cuenta el texto completo, encabezado incluido (`countPhpDependencyTokens(text)`), y `tokenCount` y `truncated` salen de la sección resultante.
   - El orden de recorte es exactamente el especificado, aunque la comparación contra la «exacta» exige leer `capPhpDependencySection`. `base` null con glosario crea la sección con `entries: []`. Con todo el glosario recortado y `base` null devuelve null.

4. **Pipeline.**
   - Solo PHP.
   - Con glosario vacío devuelve el mismo objeto (M18 lo detecta).
   - `assessContextSufficiency` usa `target.content`, `audit.candidates`, `retrievedChunks` y las reglas; no lee `dependencyContext`, así que evaluar sobre el contexto final no cambia nada respecto de antes.
   - `acquireGenerationContext` lo usan Validation, el pre-chequeo de Experimentos y `runRagArm`. El generalista no pasa por la sección.
   - `selectedChunks` y `contextTokens` no cambian (se construyen antes en el builder).

5. **Traza y secreto.**
   - El presenter mapea campo por campo: `typeName`, `fqcn`, `origin`, `resolvedBy`, `final`, `unresolvedCount`, `tokenCount` y `truncated`. No hay visibilidad, fábricas, glosario, `importsUsed` ni `text`.
   - `importsUsed` y `constructorVisibility` no tienen otro canal de salida.
   - El prompt renderiza solo `chunk.content` (`prompt-builder.service.ts:99-107`) y `dependencyContext.text` (l.112).
   - `context-traces.service.ts` no cambió, solo su spec, y acepta `entries: []` con `tokenCount > 0`.
   - El cambio `tokenCount > 0` en el presenter es necesario y mínimo (M4 lo detecta).

6. **Calidad de pruebas.**
   - 21 mutaciones aplicadas a archivos reales; 20 murieron.
   - La que quedó marcada «no aplica» fue un error de patrón mío, y la repetí a mano con otro patrón (cambiar `?? 'public'` por `?? null`): la prueba falla, la mutación muere.
   - Las pruebas son específicas; los casos money-c2 y money-c3 son reproducciones fieles.
   - Huecos menores, no bloqueantes:
     - No hay prueba que fije el comportamiento de profundidad 2 con constructor privado (hallazgo 1).
     - No hay prueba del alias (hallazgo 2).
     - No hay prueba del starvation por `take` 400.

7. **Docs y registros.**
   - Las cifras de 500, la regla «si solo hay glosario, `entries: []`» y la no exposición en la traza coinciden con el código.
   - `INTEROP-2.23` es coherente con el código en lo que revisé (solo coherencia, no revisión contractual).
   - `CHANGELOG`, el reporte técnico, `tasks.md` y `work-items.json` coinciden con lo que hace el código.
   - Los reportes declaran el incidente del `git stash` del implementer; verifiqué que `git status` muestra solo los archivos del WI y que `git diff HEAD --stat` da 21 archivos con 890 inserciones y 55 eliminaciones.
   - Ver hallazgo 5.

8. **Comandos ejecutados** (desde `app/` con `PATH=/Users/cjcarlosgc/.local/node22/bin:$PATH`, sin base de datos ni lectura de `.env`).

| Comando | Resultado |
|---|---|
| `corepack pnpm@12.14.0 lint` | exit 0 |
| `corepack pnpm@12.14.0 build` | exit 0 |
| `DOTENV_CONFIG_PATH=/nonexistent corepack pnpm@12.14.0 exec vitest run` | 192 archivos pasan y 10 se omiten (202); 3363 pruebas pasan y 121 se omiten; 0 fallos |
| `node harness/validate-harness.mjs` | passed |
| `node harness/validate-work-items.mjs` | passed (CORE, 103 WI) |
| `node scripts/sdd-check.mjs` | OK |

## Mutaciones
- Mutaciones: M1 orden de recorte, M2 glosario sin filtro de un segmento, M3 visibilidad por defecto, M4 presenter sin `tokenCount`, M5 pipeline sin guard PHP, M6 repositorio sin `projectVersionId`, M7 servicio sin exigir `CLASS`, M8 marca final con «new», M9 5 fábricas, M10 glosario sin excluir al declarante, M11 glosario ignorando chunks seleccionados, M12 builder sin copiar `importsUsed`, M13 glosario de 31, M14 tope de 300, M15 fábrica aceptando no públicos, M16 unión de retorno aceptada, M17 error de fábricas propagado, M18 glosario vacío devuelve un objeto nuevo, M19 `truncated` de `base` no propagado, M20 consulta sin `take`, M21 consulta sin `partIndex`.
- Resultado: todas murieron con 1 a 6 fallos; M3 tras el reintento manual.
- Restauración verificada con `cmp` contra copias de respaldo en el scratchpad y con `git diff HEAD --stat` (21 archivos, 890 inserciones y 55 eliminaciones, igual que antes). No usé `git stash`, `checkout`, `reset` ni `clean`.
- Archivos temporales fuera del repo: `/private/tmp/claude-501/edge.mjs` y el script de mutaciones en el scratchpad.

## Qué debe hacerse antes de cerrar
Nada bloqueante. Recomendado: corregir la redacción de los bullets del spec de 065/066 (hallazgo 5) y registrar el hallazgo 1 como residuo conocido. Al pasar a `W-DONE`, verificar que el Contract Sync y la revisión del contract-reviewer están registrados (los gates siguen en `G-NOT_RUN`).
