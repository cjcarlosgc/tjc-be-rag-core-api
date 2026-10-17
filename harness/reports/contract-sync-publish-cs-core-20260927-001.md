# Publicación Contract Sync — CS-CORE-20260927-001

- **WI productor:** WI-CORE-012.
- **Consumidor:** Console.
- **Contrato:** `spec/contracts/interoperability-contract.md` (`INTEROP-2.6`).
- **Commit fuente:** `242ffbfa3eb0a6251aa42cc83bbbc06f0e5be279`.
- **Estado al publicar:** `C-PENDING`.
- **Cambio:** `ProjectVersion.language` requerido (`TYPESCRIPT | PHP`); `detectedFramework` y el inventario admiten `PHPUNIT`; las versiones existentes se migran como TypeScript.
- **Acción solicitada:** importar la nueva versión espejo, actualizar tipos compartidos y verificar que Console no presente generación PHPUnit como disponible antes de WI-CORE-013.

La publicación crea el evento productor local; no equivale a importación, ACK ni resolución del lado Console. No se modificó el repositorio Console desde esta sesión.
