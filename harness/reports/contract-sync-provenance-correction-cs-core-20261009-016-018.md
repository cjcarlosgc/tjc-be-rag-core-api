# Contract Sync: corrección de procedencia de CS-CORE-20261009-016, -017 y -018

Modelo: agente principal de la sesión Core · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12. **Petición:** sesión Cross, con el «apruebo» de Jean relayado desde Console (Console reportó que los `sourceRevision` de estos tres eventos viven en la rama PHP con base anterior a WI-CORE-027). **Alcance:** solo procedencia; sin cambio funcional ni de contrato, sin push.

## Problema

`CS-CORE-20261009-016`, `-017` y `-018` se renumeraron en la integración del PR #13 conservando el `sourceRevision` original del PR (`123f8ed`, `8f4ddd1`, `c1343cf`). Esos commits pertenecen a `feature/php-core`, con base en `777f6bc`, anterior a WI-CORE-027. Quien espeje INTEROP-2.7 desde esas revisiones obtiene un contrato sin `/evidence` y sin las tasas `null` de §6.5. Los eventos publicados no se reescriben (README de Contract Sync: «no se reescriben commits ya citados por un evento»; un evento con el mismo ID y distinto contenido es conflicto).

## Corrección (sucesores, patrón de `CS-GH-20261011-003`)

| Original (intacto) | Sucesor | WI publicador | `sourceRevision` correcto |
| --- | --- | --- | --- |
| `CS-CORE-20261009-016` (§7: `failureKind`, `phase`, códigos nuevos) | `CS-CORE-20261012-002` (`console`, `sandbox`) | `WI-CORE-013` | `a7c04cef12740941d8559c743f84ed287fb57ced` |
| `CS-CORE-20261009-017` (relaciones PHP en trazas; §6.15 sin 422 PHP) | `CS-CORE-20261012-003` (`console`) | `WI-CORE-028` | ídem |
| `CS-CORE-20261009-018` (§6.5 experimentos PHP/PHPUnit) | `CS-CORE-20261012-004` (`console`) | `WI-CORE-029` | ídem |

`a7c04cef` es el último commit que modificó el texto de INTEROP durante la integración: aplica las correcciones del contract-reviewer sobre el INTEROP fusionado (`b8a0970`) y conserva `/evidence` (§6.16) y las tasas `null` con contadores (§6.5). Verificado: `git cat-file -e a7c04cef…^{commit}` correcto y es ancestro de `feature/jean` (`825e417` y posteriores lo contienen).

Nota: INTEROP tuvo cambios posteriores en `feature/jean` (p. ej. `projectRoot` multi-raíz, coordinación de Checks). Esos cambios viajan en sus propios eventos y no se atribuyen a estos tres; quien necesite el contrato completo vigente debe tomar el HEAD, y quien quiera solo la procedencia de PHP, `a7c04cef`.

## Evidencia de inmutabilidad

SHA-256 de los originales antes y después de publicar los sucesores (idénticos):

| Evento | SHA-256 |
| --- | --- |
| `CS-CORE-20261009-016` | `a2bfb501548741d48d598ef9811ea58278a91937fb0345c0448075bbf3cd5b28` |
| `CS-CORE-20261009-017` | `040e7292b735cd3cd0416d40e4f62e18d5aab97ba70222f2630df728c19c9bdf` |
| `CS-CORE-20261009-018` | `fd07b9bbe24d90c4f21d7067184788c7b0ad38a0319b895d8f8344e6a7a285fd` |

Publicación con `node harness/contract-sync.mjs publish` (los WI publicadores son W-DONE y declaran `contractImpact` y `publishesContract`; el comando no exige WI activo). `validate-harness`: pasa. Los sucesores nacen `C-PENDING`, sin campos de evidencia local; no alteran el snapshot cerrado de ningún WI.

## Qué se pide al consumidor

- **Console:** importar `CS-CORE-20261012-002`, `-003` y `-004`; confirmar que su espejo de INTEROP-2.7 procede de `a7c04cef` (como ya hizo, `a7c04cef`/`825e417`) y reconocerlos como corrección de procedencia sin trabajo funcional.
- **Sandbox:** el sucesor `-002` hereda el destino `sandbox` del original; sin acción de código.

## Límites

No se hizo push, PR ni merge. No se modificó ningún contrato ni código. La aprobación de Jean llegó por relevo de la sesión Cross; el efecto es un documento local reversible por Git.
