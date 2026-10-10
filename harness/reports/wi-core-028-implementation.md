# WI-CORE-028 — Relaciones estructurales PHP en el retrieval SE (implementación)

Modelo: leader · configurado claude-sonnet-5-5 · atendido claude-opus-5-5 · esfuerzo medium
Modelo: implementer (cortes A y B) · configurado claude-haiku-5-5 · atendido unknown · esfuerzo low

**Rama:** `feature/php-core` · **HU:** HU05, HU15, HU17 · **Aprobación de alcance:** 2026-10-09 (DEC-PHP-RET-001, R-PHP3 con mención obligatoria).
**Estado del registro:** `W-PLANNED` (un solo WI activo por repositorio mientras WI-CORE-026 siga en revisión); `contractImpact` y `publishesContract` pasan a `true`.

## Commits

| Commit | Contenido | Autor del código |
|---|---|---|
| `60aa78a`, `ff318b4` | Spec y aprobación | leader |
| `bfd2503` | Corte A: R-PHP1..R-PHP5 en `RetrievalService` (despacho por extensión del ancla) | implementer |
| `4fd7936` | Corte B: trazas con las relaciones PHP; comparación OE2 sin 422 PHP | implementer |
| `8f4ddd1` | INTEROP-2.7 aditivo (trazas y §6.15) | leader |

## Criterios de aceptación

1. R-PHP1..R-PHP5 según DEC-PHP-RET-001, con una prueba por relación, R-PHP3 sin mención y R-PHP4 sin barra inicial excluidas, prioridad, función top-level y unión con semánticos; TypeScript sin cambios (tests existentes intactos).
2. Las trazas aceptan las tres relaciones nuevas y siguen rechazando valores fuera de contrato; `POST /retrieval-comparisons` acepta PHP; los experimentos siguen con 422 PHP.
3. `CS-CORE-20261009-015` publicado a Console.

## Evidencia técnica (leader)

- `pnpm lint` 0 errores · `tsc --noEmit -p tsconfig.build.json` exit 0 · `pnpm build` OK.
- `pnpm test`: 124 archivos, **1751 pasan** / 82 omitidos, 0 fallos (antes del WI: 1735).

## Incidencias

- **Disco del host lleno:** `/var/home` llegó al 100 % durante la verificación por los volúmenes `node_modules` de los runners en paralelo. El leader borró solo volúmenes y copias regenerables que había creado (runners `a`–`f` y `default`) y unificó las verificaciones en un único runner. Hoy quedan ~4,7 GB libres; el resto del disco son datos del usuario.
- **Error de ámbito en el corte A:** el corte A se escribió sin poder compilar por el disco lleno; la verificación conjunta detectó `anchor` fuera de ámbito y 9 tests fallidos. El mismo implementer lo corrigió sin cambiar reglas.
- **Matiz de R-PHP3:** la mención se busca como palabra completa con `\b`, así que una variable `$Discount` cuenta como mención de `Discount`. Es literal según la regla aprobada; queda anotado para la calibración de OE2.
- `retrieval-comparisons.module.ts` conserva el import de `ProjectVersionsModule`, que ya no usa el servicio (inofensivo, fuera de alcance).

## Pendiente

Revisión humana. Después, WI-CORE-029 (OE5 con PHP).

## Revisión humana

```json
{
  "agent": "human-reviewer",
  "status": "APPROVED",
  "findings": [],
  "blockers": [],
  "filesAffected": ["rango ff318b4..a429336"],
  "evidence": "harness/reports/wi-core-028-implementation.md",
  "recommendedNextStep": "Registrar el cierre de WI-CORE-028 al integrar con feature/jean; continuar con WI-CORE-029.",
  "reviewedAt": "2026-10-09"
}
```
