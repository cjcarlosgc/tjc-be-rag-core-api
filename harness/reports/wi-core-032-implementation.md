# WI-CORE-032 — Construcciones de comportamiento PHP para ACTION_REQUIRED (implementación)

Modelo: leader · configurado claude-sonnet-5-5 · atendido claude-opus-5-5 · esfuerzo medium
Modelo: implementer-high (corte A) · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high · escalado por el leader: paridad exacta con behavior-fingerprint.ts sobre un AST distinto
Modelo: implementer (corte B) · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

**Rama:** `feature/php-core` · **Subtarea:** ST-CORE-039 · **HU:** HU07, HU08
**Aprobación humana de alcance:** 2026-10-09 (spec WI-CORE-032 en 018).
**Estado del registro:** `W-PLANNED` en `work-items.json`, por la misma razón que WI-CORE-013 (un solo WI activo por repositorio y WI-CORE-026 en revisión). La evidencia queda aquí para registrar el cierre al integrar ramas.

## Commits

| Commit | Contenido | Autor del código |
|---|---|---|
| `4062cbc`, `558be0b` | Spec y aprobación | leader |
| `a1625ff` | Corte A: `extractPhpBehaviorConstructs` + `loadPhpLanguage` compartido; corrección de paridad de la regla 3 y nota de SUB-3 en la spec | implementer-high |
| `c040f06` | Corte B: elegibilidad PHP en `SymbolBehaviorConstructsService` y `FunctionalContextEvaluator` | implementer |

## Decisiones del leader durante la implementación

1. **Closures anidadas:** se recorren, como en TypeScript (`getDescendants`). Es paridad (regla 1).
2. **Parámetros propios:** quedan literales en la forma, como en TypeScript (`collectBodyLocals` no los incluye); la regla 3 de la spec decía lo contrario y se corrigió a favor de la regla 1 (paridad). Renombrar un parámetro propio cambia la huella; renombrar una local del cuerpo no.
3. **SUB-3:** el usuario decidió reseembrarlo con una ramificación (`5935e81` en `tjc-pilot-subscriptions`); el extractor produce 1 construcción `EXPECTED_RESULT` para ese código.
4. Decisiones menores aceptadas: superglobales no son locales (una superglobal escrita es estado); `elseif` usa la misma etiqueta de forma que `if`; cadenas por texto sin decodificar escapes; enteros por valor (separadores y prefijos); un archivo con error de sintaxis devuelve `[]` (no genera preguntas).

## Evidencia técnica (leader, sobre el HEAD del corte B)

- `pnpm lint` → 0 errores · `tsc --noEmit -p tsconfig.build.json` → limpio · `pnpm build` → OK.
- `pnpm test` → 124 archivos, **1735 pasan** / 82 omitidos, 0 fallos (antes de WI-CORE-032: 1713).
- Nombres de nodo de `tree-sitter-php@0.24.2` verificados por el implementer con un probe real del AST.
- Fixtures del piloto: `PremiumDiscountPolicy::discountFor` → `[EXPECTED_RESULT, BOUNDARY]`; `CancellationPolicy::refundFor` → `[BOUNDARY]`; `Subscription::nextChargeAmount` → `[EXPECTED_RESULT]`. Los tres casos F del piloto pueden activar `ACTION_REQUIRED`.
- Las pruebas TypeScript de la huella no se modificaron. Se reemplazaron dos tests que afirmaban la exclusión de PHP (`symbol-behavior-constructs.service.spec.ts`, `functional-context-evaluator.service.spec.ts`), porque contradecían la regla aprobada.

## Incidencia de entorno

El corte B no pudo correr la verificación porque se llenó la cuota de `/tmp` con las copias de los runners. El leader liberó solo copias regenerables, movió los runners a `~/.cache/tjc-runners` y ejecutó la verificación completa.

## Pendiente

Revisión humana. Después, WI-CORE-028 (relaciones estructurales PHP) y WI-CORE-029 (OE5 con PHP).

## Revisión humana

```json
{
  "agent": "human-reviewer",
  "status": "APPROVED",
  "findings": [],
  "blockers": [],
  "filesAffected": ["rango c5acb6f..e62d42c"],
  "evidence": "harness/reports/wi-core-032-implementation.md",
  "recommendedNextStep": "Registrar el cierre de WI-CORE-032 en state.json al integrar con feature/jean; continuar con WI-CORE-028.",
  "reviewedAt": "2026-10-09"
}
```

El usuario aprobó el rango `c5acb6f..e62d42c` sin hallazgos, incluidas las decisiones del leader (paridad de parámetros, closures anidadas, archivo con error de sintaxis sin preguntas). Solo este commit de evidencia (`docs(review)`) se agrega después de la aprobación.
