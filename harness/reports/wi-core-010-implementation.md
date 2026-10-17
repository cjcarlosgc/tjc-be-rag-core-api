# WI-CORE-010 — implementación y comprobaciones

**Resultado:** implementado localmente; revisión independiente final pendiente.

## Cambio

- El comando de import agrega una única marca `consumerImportedAt` al evento nuevo en el inbox del consumidor. No se escribe en el outbox del productor.
- Reimportar el mismo payload compara el digest estable y conserva la marca y las anotaciones ACK/RESOLVED existentes.
- El validador de completados no vuelve a exigir eventos relevantes importados después del `closedAt` histórico. Los eventos importados antes o exactamente al cierre siguen teniendo que resolverse; los eventos antiguos sin marca siguen siendo conservadoramente exigibles.
- Los cinco eventos GH actuales se importaron después de los cierres de WI-CORE-001/002/009. Sus primeras horas locales se recuperaron de la creación de cada archivo del inbox y se anotaron en UTC: `001` 15:21:50, `002` 16:43:09, `003` 18:06:09, `004` 19:02:04 y `005` 20:17:44 del 25/09/2026. No se cambió el payload del productor ni el hash estable.

## Evidencia reproducible

- `node --test harness/validate-completions.test.mjs harness/contract-sync-lifecycle.test.mjs harness/contract-sync-cli.test.mjs` — 12/12 pruebas aprobadas. Incluye el validador real con evento posterior al cierre, exactamente al cierre, anterior, histórico sin marca y fecha inválida.
- `node scripts/sdd-check.mjs` — aprobado.
- `node harness/validate-work-items.mjs` — aprobado (Core, 10 WI).
- `node harness/validate-completions.mjs` — aprobado (3 cierres históricos).
- `node harness/validate-harness.mjs` — aprobado.
- `git diff --check` — aprobado.

No se cambió la evidencia ni el `closedAt` de WI-CORE-001/002/009. La importación tardía ya no reescribe esos cierres.
