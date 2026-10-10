# WI-CORE-033 · Revisión de contrato del INTEROP-2.7 fusionado (PR #13 + rango propio)
Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Alcance: `spec/contracts/interoperability-contract.md` en `9b2412d` (merge `b8a0970`), contra `origin/feature/jean` y `origin/feature/php-core`; código `app/src`; Contract Sync `CS-CORE-20261009-010..018`. Solo lectura; no se editó INTEROP.

## Veredictos por área

| Área | Veredicto |
|---|---|
| §6.5 / §6.5.1 (experimentos PHP, tasas `number \| null`, contadores) | CHANGES (menor) |
| §6.15 (comparación sin 422 PHP, relaciones R-PHP1..5) | CHANGES (1 contradicción) |
| §6.16 (`runnerHint`, `failureCategory`, `structuralRelation`) | APPROVED |
| Tipos de traza (`RagMatchedVia`, `structuralMatch`) | APPROVED |
| §7 (`failureKind`, `phase`, `TEST_COMPILATION_FAILED`, `IMAGE_UNAVAILABLE`) | APPROVED (texto) |
| Líneas de estado (L14, §8 L1470) | CHANGES |
| Contract Sync 010..015 | APPROVED con 1 matiz (011) |
| Contract Sync 016..018 | CHANGES (menor) |

## (a) Coherencia entre los dos lados

Las ediciones de ambos lados no colisionan: las tasas `number | null` y los contadores de WI-CORE-027 (L334, L343 y `StrategyMetricsResponse`) conviven con la admisión PHP de WI-CORE-029 sin duplicados. `StructuralRelation` (L1058) y los tipos de traza (L450, L466) enumeran las mismas cinco relaciones. Hallazgos:

1. **Contradicción interna (L1050, §6.15).** Dice «los experimentos siguen respondiendo `422 UNSUPPORTED_PROJECT` para PHP hasta `WI-CORE-029`». Es el texto del lado de WI-CORE-028, quedó obsoleto al fusionar WI-CORE-029 y contradice L343 (§6.5: PHP admitido; 422 solo sin `JEST`/`VITEST`/`PHPUNIT`).
   Reemplazar la subcláusula por:
   `un símbolo de un proyecto PHP se acepta desde \`WI-CORE-028\` (2026-10-09; sin \`422 UNSUPPORTED_PROJECT\` por lenguaje; los experimentos admiten PHP/PHPUnit desde \`WI-CORE-029\`, §6.5)`
2. **L334 (estado §6.5.1)** lista `WI-CORE-023`, `024`, `025` y `027` y omite `WI-CORE-029`. Texto: en esa lista, tras `WI-CORE-027`, agregar «y \`WI-CORE-029\` (experimentos PHP/PHPUnit)».
3. **L14 (estado §1)** no menciona PHP. Al final de la enumeración de implementados agregar: «, la ejecución PHP/PHPUnit en Core (\`WI-CORE-013\`, §7), las relaciones estructurales PHP y la comparación de retrieval sobre PHP (\`WI-CORE-028\`, §6.15) y los experimentos PHP/PHPUnit (\`WI-CORE-029\`, §6.5)».
4. **L1470 (§8)** es falso/ambiguo tras el merge («`PHP_LARAVEL_PHPUNIT`, `phase` y la evidencia ampliada quedan aprobados pero pendientes de implementación»), pues L1351/L1444/L1456 describen `phase`, `failureKind` y los códigos como contrato aditivo vigente. Reemplazar por:
   `Core implementa el consumo de \`PHP_LARAVEL_PHPUNIT\` (\`WI-CORE-013\`, \`WI-CORE-028\`, \`WI-CORE-029\`). El Sandbox publicado implementa el equivalente de \`NODE_TYPESCRIPT\` con Jest/Vitest; \`PHP_LARAVEL_PHPUNIT\`, \`phase\` y \`failureKind\` los entrega el Sandbox según \`CS-SANDBOX-20261009-001\` y su estado de implementación se declara en ese componente.`
5. Menor: «Fecha de corte» (L5) sigue `2026-10-08` y el cuerpo tiene cambios `2026-10-09`; recomendado `2026-10-09`.

## (b) Texto frente a código fusionado

- Experimentos PHP: `experiments.service.ts` rechaza con `422 UNSUPPORTED_PROJECT` solo si `detectedFramework` no es `JEST`/`VITEST`/`PHPUNIT`; antes del modelo. Coincide con L343. La respuesta sin `<?php` (`experiment-job.handler.ts` ~L786-810) queda `INVALID`, `compiled:false`, `failureType:COMPILATION`, sin Sandbox ni reintento. Coincide con L343 y CS-018.
- Comparación: `retrieval-comparisons.service.ts` ya no rechaza PHP. Coincide con L1050/L1052 salvo el hallazgo 1.
- Evidencia: `EvidenceRunnerHint = 'JEST'|'VITEST'|'PHPUNIT'`, otro valor se exporta `null` (`evidence-mapping.ts`); `facts.failureCategory` validado. Coincide con L1261-1263.
- `map-sandbox-result.ts`: `failure.category` se valida contra `FailureType` con `UNKNOWN` por defecto; `failureKind: ERROR` gana a `TEST_ASSERTION` (clasificación `TEST_RUNTIME`) y su ausencia conserva la clasificación previa. Coincide con L1444 («Core no lo trata como fuente única»).
- §7: Core no envía aún `phase` (no hay referencias en `app/src/sandbox`); L1351 lo declara («Core lo enviará explícito cuando implemente el baseline»). Coherente. `failureKind` no entra en las claves cerradas de `facts` (§6.16), por lo que CS-016 es exacto al decir que no se expone a Console.
- `TEST_COMPILATION_FAILED`/`IMAGE_UNAVAILABLE` no tienen referencias en Core: se reciben como `failure.code` abierto; sin contradicción.
- `RUNNING_TESTS` existe en el enum de etapas (L1362); la nota PHP de L1456 es válida.

## (c) Contract Sync

| ID | sourceWorkItem | targets | breaking | Resultado |
|---|---|---|---|---|
| 010 | WI-CORE-030 | console | false | OK |
| 011 | WI-CORE-022 | console | false | OK con matiz (ver abajo) |
| 012 | WI-CORE-026 | github-integration | false | OK |
| 013 | WI-CORE-026 | console | false | OK (dice que `/evidence` sigue pendiente; 014 lo entrega, orden coherente) |
| 014 | WI-CORE-027 | console | true | OK |
| 015 | WI-CORE-027 | console | true | OK; coincide con L334/StrategyMetricsResponse |
| 016 | WI-CORE-013 | console, sandbox | false | CHANGES menor |
| 017 | WI-CORE-028 | console | false | CHANGES menor |
| 018 | WI-CORE-029 | console | false | APPROVED |

IDs consecutivos y únicos (010..018, sin duplicados con 008/009); `sourceWorkItem` y `scopePaths` correctos; ningún texto contradice el INTEROP fusionado salvo lo siguiente:

- **011 (matiz).** Pide manejar `422 UNSUPPORTED_PROJECT` (PHP) en la comparación; CS-017 lo retira. Si Console importa 011 y 017 en orden, 017 prevalece, pero conviene explicitarlo. En `changed` de 017 agregar al final: «Reemplaza lo indicado en \`CS-CORE-20261009-011\` sobre el \`422 UNSUPPORTED_PROJECT\` (PHP) de la creación de comparaciones: ya no existe».
- **017.** Dice «los experimentos siguen con 422 PHP hasta WI-CORE-029»; en el rango fusionado WI-CORE-029 ya está implementado (CS-018). Cambiar esa frase por: «los experimentos admiten PHP desde WI-CORE-029 (\`CS-CORE-20261009-018\`)».
- **016.** `targets: [console, sandbox]` pero `requiredAction` solo habla de Console, y la entrega al Sandbox es por la vía JSON harness V2 (fuera de importación). Opción A (recomendada): `targets: [console]` y en `changed` conservar «Origen: CS-SANDBOX-20261009-001». Opción B: mantener `sandbox` y añadir a `requiredAction`: «Sandbox: ya originó esta aclaración (\`CS-SANDBOX-20261009-001\`); sin acción adicional salvo sincronizar el espejo de §7.»
- `sourceRevision` de 016..018 son hashes cortos (`123f8ed`, `8f4ddd1`, `c1343cf`), a diferencia de los de 010..015 (40 caracteres). Commits existen en el historial fusionado; recomendado expandirlos a 40 caracteres por consistencia (no bloqueante).

## Decisiones

Ninguna `DECISION_REQUIRED`. La única elección abierta es la opción A/B de 016 (recomendada A).

## Conclusión citable para `contractReviewed`

Revisión de contrato independiente del INTEROP-2.7 fusionado (rama `integration/php-core-pr13`, `9b2412d`): el contrato es coherente con el código fusionado para WI-CORE-013 (§7: `failureKind`, `phase`, `TEST_COMPILATION_FAILED`, `IMAGE_UNAVAILABLE`; CS-016), WI-CORE-028 (relaciones PHP R-PHP1..5 en trazas y §6.15 sin 422 PHP; CS-017) y WI-CORE-029 (§6.5 experimentos PHP, 422 solo sin framework `JEST`/`VITEST`/`PHPUNIT`, `runnerHint` `PHPUNIT`; CS-018). Cambios aditivos, sin breaking, sin ganadores ni campos de request nuevos. Veredicto: APPROVED condicionado a aplicar las correcciones de texto menores (L1050, L334, L14, L1470 de INTEROP y 011/016/017 de Contract Sync); ninguna altera la forma de los DTO ni el comportamiento del código.
