# WI-CORE-012 — Verificación de especificación y decisiones

- Historias existentes: HU03/HU04; épica EP02. No se abren épica ni HU.
- `DEC-PHP-AST-001` está APROBADO por el usuario; el benchmark queda atribuido al autor y no reproducido independientemente.
- `INTEROP-2.6` extiende `ProjectVersion.language` y `detectedFramework` con PHP/PHPUNIT; conserva SYSTEM-2.5 y TypeScript/Jest/Vitest.
- `WI-CORE-013` es un corte distinto HU10/HU11, planificado y dependiente de este WI. Generación/validación y Sandbox no son criterio de cierre de WI-CORE-012.
- Contract Sync start revisa eventos pendientes anteriores al baseline y los clasifica por alcance; el nuevo delta será publicado a Console al terminar la implementación contractual.

**Resultado:** SDD verificado para comenzar WI-CORE-012. Esta verificación no sustituye revisión independiente ni los gates técnicos de cierre.
