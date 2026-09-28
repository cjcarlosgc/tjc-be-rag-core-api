# Verificación SDD — WI-CORE-015

**Estado:** `W-SPEC_VERIFIED` para corregir estados narrativos y sincronizar los espejos; sin cambios de comportamiento.

- **WI/ST/HU:** `WI-CORE-015` / `ST-CORE-022` / HU02, HU14.
- **Alcance:** reflejar que la extensión de `GH-INTEROP-1.2` está implementada y cerrada localmente en `WI-GH-007`, `WI-CORE-014` y `WI-CORE-011`; registrar la sincronización/validación de Console en `WI-CONSOLE-008`; conservar pendiente la configuración externa, el despliegue y el cutover.
- **Dependencias locales:** `WI-CORE-011` y `WI-CORE-014` están `W-DONE` con snapshots y reportes de cierre.
- **Decisiones:** ninguna decisión pendiente bloquea HU02/HU14 ni este cambio documental. `DEC-INF-001`, `DEC-VAL-001` y `DEC-EXP-FK-001` conservan su alcance acotado.
- **Contratos:** no cambian rutas, DTOs, errores, semántica ni versiones (`SYSTEM-2.5`, `INTEROP-2.6`, `GH-INTEROP-1.2`). Al ser propietarios canónicos, Core debe emitir Contract Sync namespaced a GitHub Integration y Console para preservar espejos idénticos.
- **Fuera de alcance:** editar aplicación, ejecutar despliegue/cutover, modificar Sandbox o reescribir CHANGELOG histórico, reportes o snapshots cerrados.

**Resultado:** puede iniciarse el corte documental con la autorización expresa del usuario de corregir las frases obsoletas y homologar los repositorios.
