# WI-CORE-070 — verificaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Ejecutadas en `app/` el 2026-10-18 con Node 22.23.3 sobre `feature/jean`, HEAD `116c324` (cortes A `af05c90`, B `ae96def`, C `116c324`):

| Comando | Resultado |
|---|---|
| `pnpm lint` (`oxlint src/ test/`) | exit 0 |
| `pnpm build` (`nest build`) | exit 0 |
| `pnpm contracts:check` | exit 0 |
| `pnpm exec vitest run --testTimeout=60000` | 155 archivos pasan, 7 omitidos; **2514 tests pasan**, 104 omitidos (baseline 2481 + 15 corte A + 11 corte B + 7 corte C) |
| `pnpm test` (timeout por defecto de 5 s) | 2511–2513 pasan y 1–3 fallan por **timeout de 5 s** en `sanitize-failure-message.util.spec.ts` y `test-target-extractor.service.spec.ts` |

## Nota sobre los timeouts (ambiental, no del WI)

Esos dos archivos no fueron tocados por el WI. La máquina estaba saturada por procesos ajenos a esta sesión (load average entre ~280 y ~520, compilaciones `clang` de otra sesión). Los mismos specs pasan aislados, y la suite completa pasa (2514) con `--testTimeout=60000`. El reviewer observó el mismo comportamiento con load ~190. No se modificó ninguna configuración de pruebas. La corrida con el timeout por defecto no quedó verde bajo esa carga; el criterio «test en verde» se acredita con la corrida con timeout ampliado, y queda anotado para que una corrida en máquina descargada lo confirme.
