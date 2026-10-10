# Publicación de Contract Sync — CS-CORE-20261009-014 (CS-1 de WI-CORE-027)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-09 (America/Lima). Origen: WI-CORE-027. Destino: Console (`WI-CONSOLE-017`). `breaking=true` (solo compilación TypeScript estricta; sin emisor previo). Estado inicial `C-PENDING`. El outbox queda en Core; el usuario decide cuándo Console lo importa.

`CS-CORE-20261009-014`: forma congelada de `EvidenceBundleResponse` (`schemaVersion '1'`) y las tres rutas `/evidence`; siete checkpoints de contenido en `harness/reports/wi-core-027-contract-review-c.md`. `sourceRevision` `275f687` (commit del corte F con la forma de la evidencia); el texto de INTEROP está en `2d203cb`. «Implementado» y CS-3 (§6.5, DEC-EVID-001) llegan con el corte D.

**Nota (revisión independiente de `WI-CORE-027`, 2026-10-10):** el `sourceRevision` `275f687` antecede a la forma de §6.16 congelada en `2d203cb` y a las correcciones de texto finales (`3f06f44`); como el README de Contract Sync no permite reescribir un evento publicado y no se reescriben commits citados, el evento se conserva. Console debe tomar §6.16 de la revisión final de documentos de Core (`3f06f44` o posterior); el contenido del evento es fiel al código (verificado por el reviewer).
