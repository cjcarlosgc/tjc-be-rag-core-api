# Contract Sync — CS-CORE-20260927-003

- **Work item emisor:** WI-CORE-011.
- **Destino:** `console`.
- **Estado publicado:** `C-PENDING` en `harness/contract-sync/outbox/CS-CORE-20260927-003.yaml`.
- **sourceRevision:** `a99b3c315738966d956e9cb08833b2c42a7c85e5` (`feat(core): enforce PR binding creation eligibility`).
- **Alcance:** espejo de INTEROP-2.6 en Console; elegibilidad temporal del PR, ocultamiento de Runs previos al vínculo y recuperación durable de fechas no verificables. Sin cambio de rutas o shapes de respuesta.
- **Acción solicitada:** Console importa el evento y planifica el espejo bajo WI-CONSOLE-008 tras la revisión/cierre aprobado de WI-CORE-011. No se editaron archivos del checkout Console.
- **Revisión local:** Contract Sync `before-review` registrado el 2026-09-27; `relevantPendingSyncIds` vacío. GH `CS-GH-20260927-001` consta resuelto; los eventos históricos `CS-20260920-001` y `CS-20260921-003` figuran `NOT_RELEVANT` para este WI con digest y reporte.
- **Límite:** la publicación notifica al consumidor y no acredita su importación, aceptación ni implementación. WI-CORE-011 queda abierto para revisión independiente humana.
