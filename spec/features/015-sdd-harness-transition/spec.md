# 015 — Transición SDD y Harness Core

**Estado:** aprobado como trabajo de alineación. No crea nuevas épicas ni historias de usuario.

## Objetivo

Hacer trazable cada cambio desde una HU fija a subtarea y work item local, retirar definiciones de producto obsoletas y preparar la frontera de GitHub Integration sin alterar evidencia persistida.

## Invariantes

- El ZIP interno de snapshot para Docker/Sandbox sigue vigente; la carga manual de código y la descarga legacy de artefactos no.
- Los 18 IDs HU tienen significado nuevo; un `HUxx` histórico no demuestra automáticamente que la HU homónima actual esté terminada.
- Core y Console se alinean ahora; Sandbox no se edita durante el trabajo de su compañero.
- GitHub Integration será un cuarto componente dueño de toda interacción GitHub; el traslado de código ocurre después del corte SDD/Harness y de la limpieza legacy.
