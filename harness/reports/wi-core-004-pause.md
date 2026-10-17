# WI-CORE-004 — pausa por prioridad de WI-CORE-044
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12. Aprobación directa del usuario en el chat de Core (relayada): «¿Apruebas el WI de corrección de Core para los tres defectos (constructor, símbolos de test, ruta PHP) con prueba roja-verde, con prioridad sobre WI-CORE-004?» → «Sí, hazlo ya».

El harness admite un solo WI activo. `WI-CORE-004` (`W-SELECTED`, sin implementación ni aprobación de formalización) vuelve a `W-PLANNED` y `activeWorkItem` queda libre para `WI-CORE-044`; su `ST-CORE-004` vuelve a `T-BACKLOGGED`. Se conservan la aprobación de alcance (`wi-core-004-scope-approval.md`), el PULL `start` ya registrado y el trabajo del sdd-analyst en curso (`wi-core-004-sdd-analysis.md` y la sección «PROPUESTA» de la feature 013), que no avanza hasta cerrar `WI-CORE-044`. Al cerrar `WI-CORE-044` se vuelve a seleccionar `WI-CORE-004` con un nuevo PULL `start`.
