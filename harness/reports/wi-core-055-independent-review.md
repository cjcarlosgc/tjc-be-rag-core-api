Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

# WI-CORE-055 — revisión independiente (ciclo 1 de 2)

**Rango:** `git diff b63080d^..b63080d` (2 archivos: `workspace-agent-tools.ts` y su spec). Modo fuera de casa activo; el reviewer es independiente del implementer (claude-haiku-5-5).
**Veredicto:** APPROVED (con un hallazgo de severidad baja/media sobre cobertura de pruebas, no bloqueante).

## Evidencia ejecutada
Se usaron worktrees desechables en `b63080d^` y `b63080d` (eliminados al terminar). Sonda comparativa antes/después con 63 consultas sobre un fixture multi-archivo.

1. Resolución (después → antes):
   - Clase calificada `App\Domain\OrderLine`, con `\` inicial y sin él: SUCCEEDED (antes EMPTY).
   - Método calificado `App\Domain\OrderLine\hasStock`, con/sin `\` inicial, `OrderLine::hasStock`, `OrderLine.hasStock`, `App\Domain\OrderLine::hasStock`: devuelve el nodo del método correcto (antes EMPTY).
   - Namespace con llaves (`A\B\Box\open`, `C\Box\open`), varios namespaces con `namespace X;` en un archivo (`One\Same\m` → 'one', `Two\Same\m` → 'two'), namespace global con llaves (`GlobalCls::g`, `globalFn`), clase global sin namespace (`\Plain\go`): correctos.
   - Interfaz, trait, enum y función con namespace (`App\Domain\Priced\price`, `Loggable\log`, `Status\label`, `App\Domain\nsFunc`): resuelven.
   - Nombres simples PHP (`OrderLine`, `Priced`, `nsFunc`, `Plain`, `globalFn`) y TypeScript (`Calculator`, `help`, `Shape`): salida idéntica a la base, byte a byte (incluida la lista de referencias).
2. Casos límite: `App  \Domain\OrderLine`, ` App\Domain\OrderLine`, `App\\Domain\\OrderLine`, `App\Domain\OrderLine\`, `\`, `\\`, `::`, `.`, `OrderLine::`, `.hasStock`, `App\Domain\`, `a.b(c)\[x]*`, `$^{}()|[]`: EMPTY sin excepción; `""`: FAILED "Se requiere symbolName" (sin cambios). `App\Other\OrderLine` resuelve a `src/Other.php`, no a `App\Domain\OrderLine`; `App\Domain\Other\OrderLine`, `Other\OrderLine`, `App\Domain\OrderLine\onlyOther` y `hasStock` suelto: EMPTY. Método homónimo en dos clases: con nombre calificado devuelve el correcto (`App\Domain` → `: bool`, `App\Other` → `: int`); con `Clase::método` sin namespace y clases homónimas en dos namespaces (`Same::m`) devuelve el primero por orden de archivo/declaración (ambigüedad inherente, ver H2). RegExp escapado: ningún carácter especial lanza.
3. `referencePattern` usa el último segmento (`\`, `::`, `.`) del nombre normalizado, ya no el nombre completo. Para nombres sin separadores es idéntico a la base (TS y PHP simples, 3 casos TS reales sin diferencias).
4. Mutantes contra la spec del WI (todos aplicados sobre `b63080d`, restaurado después):
   - ignorar namespace: MATADO (4 pruebas fallan).
   - ignorar `\` inicial: MATADO (1).
   - no tratar `::`: MATADO (1).
   - devolver clase en vez de método: MATADO (1).
   - reconstruir el patrón con el nombre completo: **SOBREVIVE** (27/27 pasan). Ver H1.
5. Alcance: solo `workspace-agent-tools.ts` y su spec; sin ranking/contexto RAG, experimentos, evidencia, métricas, contratos (`AgentToolName` y `AGENT_TOOL_SCHEMAS` sin cambios) ni sandbox; sin secretos; sin build.
6. Gates (sobre `b63080d`): `vitest run` completo 140 archivos pasan / 6 omitidos, 2211 pruebas pasan / 104 omitidas; `oxlint src/ test/` exit 0 sin hallazgos; `tsc --noEmit` 45 errores en base y en head, delta 0 por archivo (0 en `workspace-agent-tools*`); `validate-harness` pasa; `node --test harness/*.test.mjs` 31/31. Sin build (no aplica).

## Hallazgos
- **H1 (baja/media, cobertura):** ninguna prueba distingue "referencias por último segmento" de "referencias por nombre completo". En el spec, `Usage.php` contiene literalmente `use App\Domain\OrderLine;`, de modo que el patrón del nombre completo también coincide; el mutante M5 sobrevive. Un método calificado (`...\hasStock`) con referencias solo por su último segmento no tiene prueba. El comportamiento del código es correcto; falta la prueba que lo fije. recommendedNextStep: añadir una prueba con un archivo que referencie solo `->hasStock(` o `new OrderLine()` sin el nombre completo, esperando aparecer en "Referenciado también en". No bloquea el cierre del WI.
- **H2 (informativa):** `Clase::método` o `Clase.método` sin namespace con clases homónimas en varios namespaces devuelve la primera coincidencia (orden de archivos y declaración); es el mismo criterio "primera declaración" ya vigente y está acotado por el alcance aprobado. Sin acción.
- **H3 (informativa):** las referencias de un nombre calificado incluyen homónimos de otros namespaces (p. ej. `App\Domain\OrderLine` lista `src/Other.php`), consecuencia declarada del patrón por último segmento. Sin acción.
- **H4 (informativa):** la descripción del esquema de `inspect_symbol` sigue diciendo "Nombre exacto del símbolo"; no se actualizó para mencionar nombres calificados. Cambiarla es opcional y tocaría un texto visible al modelo.

## Resultado
status: APPROVED · blockers: ninguno · filesAffected: `app/src/generation/agent/workspace-agent-tools.ts`, `app/src/generation/agent/workspace-agent-tools.spec.ts` · decisiones DEC abiertas: ninguna aplicable · Contract Sync: sin impacto contractual.
recommendedNextStep: el leader puede cerrar WI-CORE-055 (W-DONE); H1 puede incorporarse como prueba adicional opcional sin nuevo ciclo de revisión completa.
