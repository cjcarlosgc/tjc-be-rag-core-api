# WI-CORE-013 — Generación y validación PHPUnit (implementación)

Modelo: leader · configurado claude-sonnet-5-5 · atendido claude-opus-5-5 · esfuerzo medium
Modelo: implementer (cortes A, B, C) · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

**Rama:** `feature/php-core` (desde `feature/jean` @ `777f6bc`) · **Subtarea:** ST-CORE-020 · **HU:** HU10, HU11
**Aprobación humana de alcance:** el usuario aprobó la spec (incluidas DEC-PHP-GEN-001 y DEC-PHP-GEN-002) el 2026-10-09 y levantó el diferimiento de WI-CORE-013/028/029 con acuerdo del otro desarrollador.
**Estado del registro:** `W-READY`. El harness admite un solo WI activo por repositorio y `WI-CORE-026` (otro desarrollador) sigue en `W-IN_REVIEW`; la selección formal y el cierre de WI-CORE-013 en `state.json` quedan para cuando se integren las ramas. Este reporte deja la evidencia para entonces.

## Commits

| Commit | Corte | Autor del código |
|---|---|---|
| `35865f4` | Spec y registro de WIs | leader |
| `bff15b4` | A — perfil PHPUNIT y `failureKind` en `mapSandboxResult` | implementer |
| `d3bb158` | B — prompt PHPUnit, `sanitizeGeneratedPhp`, `phpTestLocation` | implementer |
| `0a63d79` | C — handler de validación PHP | implementer (+ cambio mínimo del leader: reubicar la interfaz `TestPlacement` encima del comentario de la clase, 6 líneas movidas, sin lógica) |
| `123f8ed` | INTEROP-2.7 §7 aditivo | leader |

## Criterios de aceptación

1. Genera PHPUnit solo con `detectedFramework=PHPUNIT`; sin PHPUnit, HELD con motivo; Pest no se atribuye → handler + test "sin PHPUnit".
2. Contexto y prompt por lenguaje; respuesta saneada; sin `<?php` es fallo técnico → `ContextBuilder`/`PromptBuilder` + tests; handler + test "sin <?php".
3. DEC-PHP-GEN-001 → `php-test-path.ts` + tests (ejemplos de la spec, función, fuera de `app/`, colisión).
4. `PHP_LARAVEL_PHPUNIT`/`PHPUNIT`, sin `phase` → `EXECUTION_PROFILE_BY_RUNNER` + test de body sin `phase`.
5. DEC-PHP-GEN-002 → `mapSandboxResult` + 4 tests; handler: `ERROR` → TECHNICAL_GENERATION_FAILURE, solo `ASSERTION` → BEHAVIORAL_MISMATCH.
6. INTEROP canónico §7.2/§7.3/§7.4 + `CS-CORE-20261009-016` (console, sandbox).
7. Regresión TypeScript: prompt TS idéntico (tests existentes), ruta co-ubicada y `language: typescript` (test de regresión).

## Evidencia técnica

Ejecutada por el leader sobre el HEAD `123f8ed` (Node 22 en contenedor):

- `pnpm lint` → 0 warnings, 0 errores.
- `tsc --noEmit -p tsconfig.build.json` → sin errores.
- `pnpm build` → OK.
- `pnpm test` → 123 archivos, **1713 pasan** / 82 omitidos, 0 fallos (línea base `777f6bc`: 1689).
- `node harness/validate-work-items.mjs`, `validate-harness.mjs`, `scripts/sdd-check.mjs` → OK.

## Hallazgos y límites

- **Contract Sync del Sandbox no importable:** `CS-SANDBOX-20261009-001` está en JSON (harness V2 del Sandbox) y el `import` de Core V3 no lo reconoce (`imported: 0`). Se consolidó su contenido en el contrato canónico y se referencia por ID; la homologación de harness sigue pendiente.
- **Posible colisión de IDs:** `CS-CORE-20261009-016` se emitió en `feature/php-core` como `CS-CORE-20261009-014` (renumerado a `-016` al integrar con `feature/jean`, WI-CORE-033); si `feature/jean` emite el mismo ID antes de integrar, hay que renumerar uno.
- **Retrieval PHP sin relaciones estructurales:** las relaciones de import de `RetrievalService` son de TypeScript; PHP usa solo similitud semántica hasta WI-CORE-028.
- **ACTION_REQUIRED en PHP:** DEC-FK-003/004 solo calculan construcciones para TypeScript; un Run PHP no hace preguntas funcionales hasta WI-CORE-032.
- **Namespace fuera de `app/`:** para targets fuera de `app/` el namespace del test capitaliza segmentos y el directorio no; PHPUnit carga el archivo por ruta, así que no afecta la ejecución.
- Sin baseline (`phase=BASELINE`) en este WI.

## Pendiente

Revisión humana (reviewer por defecto: el usuario). Después: WI-CORE-032 → WI-CORE-028 → WI-CORE-029.

## Revisión humana

```json
{
  "agent": "human-reviewer",
  "status": "APPROVED",
  "findings": [],
  "blockers": [],
  "filesAffected": ["rango 777f6bc..c5abb01 (22 archivos)"],
  "evidence": "harness/reports/wi-core-013-implementation.md",
  "recommendedNextStep": "Registrar el cierre de WI-CORE-013 en state.json al integrar con feature/jean; continuar con WI-CORE-032.",
  "reviewedAt": "2026-10-09"
}
```

El usuario aprobó el rango `777f6bc..c5abb01` sin hallazgos. Solo este commit de evidencia (`docs(review)`) se agrega después de la aprobación.
