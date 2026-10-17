# WI-CORE-029 — OE5 con PHP/PHPUnit (implementación)

Modelo: leader · configurado claude-sonnet-5-5 · atendido claude-opus-5-5 · esfuerzo medium
Modelo: implementer (corte A) · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low
Modelo: implementer-high (corte B) · configurado claude-haiku-5-5 · atendido unknown · esfuerzo high · escalado por el leader: handler de experimentos de ~1360 líneas con pares, reintentos y trazas

**Rama:** `feature/php-core` · **HU:** HU17 · **Aprobación de alcance:** 2026-10-09.
**Estado del registro:** `W-PLANNED` (un solo WI activo por repositorio mientras WI-CORE-026 siga en revisión).

## Commits

| Commit | Contenido | Autor del código |
|---|---|---|
| `798fe00`, `fa0cafe` | Spec y aprobación | leader |
| `6b4594b` | Corte A: `inspect_symbol` para PHP (tree-sitter), paridad de herramientas | implementer |
| `0fc67d1` | Corte B: elegibilidad PHPUNIT, ambos brazos PHP, saneamiento sin reintento | implementer-high |
| `c1343cf` | INTEROP-2.7 §6.5 aditivo | leader |

## Criterios de aceptación

1. `POST /experiments` acepta PHPUNIT (runner `PHPUNIT`, perfil `PHP_LARAVEL_PHPUNIT`); PHP sin PHPUnit conserva `422`; el job ya no bloquea PHP.
2. Ambos brazos: ruta DEC-PHP-GEN-001 (`CREATED`, sin fusión), `sanitizeGeneratedPhp` y el mismo Sandbox. Una respuesta sin `<?php` se registra `INVALID`/`COMPILATION` sin Sandbox y sin habilitar el reintento (mismo camino que "sin framework"). RAG con contexto y prompt PHP; agente con instrucciones PHP equivalentes.
3. `inspect_symbol` encuentra declaraciones y referencias PHP con el mismo formato que TypeScript; un archivo PHP con error de sintaxis no aporta declaraciones (mismo criterio que la huella de WI-CORE-032).
4. TypeScript sin cambios: los tests existentes pasan sin modificaciones, salvo los que afirmaban el bloqueo PHP, que se reemplazaron.
5. `CS-CORE-20261009-018` publicado a Console.

## Evidencia técnica (leader)

- `pnpm lint` 0 errores · `tsc --noEmit -p tsconfig.build.json` exit 0 · `pnpm build` OK.
- `pnpm test`: 124 archivos, **1762 pasan** / 82 omitidos, 0 fallos (antes del WI: 1751).

## Notas

- El corte B reportó como "bloqueo" que `inspect_symbol` no entendía PHP; no aplica: lo implementó el corte A (`6b4594b`), que no estaba en el alcance de ese agente.
- El corte B amplió el tipo `CreateExperimentRunInput.runnerHint` en `experiment-runs.repository.ts` para admitir `PHPUNIT` (necesario para compilar; sin cambio de Prisma ni de comportamiento). Aceptado por el leader.
- Incidencia de entorno: el primer lanzamiento del corte A se detuvo antes de editar porque el disco del host llegó a 0 bytes libres por una instalación ajena al proyecto; se relanzó tras liberar espacio el usuario. El repositorio quedó íntegro.

## Pendiente

Revisión humana. Con esto se cierran los WIs de Core necesarios para el piloto PHP (013, 032, 028, 029).

## Revisión humana

```json
{
  "agent": "human-reviewer",
  "status": "APPROVED",
  "findings": [],
  "blockers": [],
  "filesAffected": ["rango fa0cafe..2439b4d"],
  "evidence": "harness/reports/wi-core-029-implementation.md",
  "recommendedNextStep": "Registrar el cierre de WI-CORE-013/028/029/032 al integrar con feature/jean; preparar despliegue e infraestructura del piloto.",
  "reviewedAt": "2026-10-09"
}
```
