# 019 — Plan de detección y transporte de projectRoot

El corte conserva el binding uno-a-uno vigente y se ejecuta por WIs locales. No autoriza cambios de `app/` antes de la aprobación humana del contrato y del alcance.

1. **WI-CORE-036 / ST-CORE-043 — HU01, HU03, HU04:** descubrir y persistir una raíz PHP de candidato único por snapshot; aislar parsing/inventario/retrieval y conservar paths públicos relativos al repositorio. Multi-candidato queda fuera hasta resolver `DEC-PHP-ROOT-001`.
2. **WI-CORE-037 / ST-CORE-044 — HU10, HU11, HU12:** generar paths con prefijo `projectRoot`, enviar el `effectiveProjectRoot` al Sandbox y preservar la raíz efectiva en ejecuciones congeladas. Depende del soporte Sandbox y de Contract Sync resuelto antes de implementar.
3. **WI-CORE-041 / ST-CORE-048 — HU03:** alinear snapshot y discovery con el nombre exacto `composer.json`; una variante como `COMPOSER.JSON` no activa el pool PHP ni excluye fuentes TypeScript. No cambia contratos ni la API.
4. **Console (consumidor):** crear su WI local tras importar INTEROP-2.8; no crear selector ni pregunta; representar el `projectRoot` detectado como dato informativo si la vista de Project muestra configuración técnica.
5. **Sandbox (consumidor):** registrar un WI local en su Harness vigente para aceptar y validar `projectRoot`, resolverlo bajo `repositoryRoot`, usar cwd correcto y escribir artefactos conservando rutas de repositorio. No cambiar `sddVersion` global en este corte.
6. **GitHub Integration (consumidor):** sincronizar/revisar las copias de INTEROP/SYSTEM al importar el Contract Sync; no se requiere cambio de producto ni una política Composer/PHPUnit.

Contract Syncs publicados desde el commit fuente `187b0383817e341aa7c82e91cb36d7dcce343479`: `CS-CORE-20261011-001` → Console, `CS-CORE-20261011-002` → Sandbox y `CS-CORE-20261011-003` → GitHub Integration. Están `C-PENDING`; la publicación no sustituye la importación/aceptación ni crea WIs locales en los consumidores.

GitHub Integration ya expone tree y contenido anclados al commit; Core puede identificar el `composer.json` sin una decisión de dominio en el proveedor GitHub. Ningún WI de Core modifica el app o harness de otro repo.

## Gates y regresiones

- `scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs` y `node harness/validate-harness.mjs` deben pasar.
- Antes de implementar se revisan `DEC-PHP-ROOT-001` por alcance, Contract Sync ACK y el contrato con Sandbox.
- Las pruebas deben cubrir: `projectRoot = .`; único root anidado; `validacion-ventas` con backend PHP y frontend hermano, tras confirmar su SHA; varios manifiestos sin heurística; snapshot con wrapper incidental; wrapper + root anidado; rutas inválidas/traversal/symlink; test generado en subproyecto; Composer/PHPUnit con cwd correcto; regresión TypeScript/Jest/Vitest; PHP sin PHPUnit reconocido pero no ejecutable.
- La verificación E2E empresarial queda separada de las pruebas de código: requiere snapshots SHA congelados, repositorios sin modificaciones, servicios locales y Sandbox compatible. No inferir resultados científicos de `passed`, `compiled` o `valid`.
