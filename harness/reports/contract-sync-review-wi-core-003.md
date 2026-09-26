# Contract Sync GH → Core — revisión previa a WI-CORE-003

**Fecha:** 2026-09-25
**Estado de `WI-CORE-003`:** `W-PLANNED`; aún no hay implementación ni cutover.
**Alcance:** revisar, incorporar al contrato canónico y aceptar para planificación los eventos `CS-GH-20260925-001` a `CS-GH-20260925-005`.

El dueño canónico de Core revisó las cinco solicitudes y actualizó `spec/contracts/github-integration-contract.md`. Ese archivo y el espejo de `tjc-be-github-integration-api` son byte a byte idénticos (`GH-INTEROP-1.0`). Los eventos se reconocen como `C-ACKNOWLEDGED`, no `C-RESOLVED`: Core acepta atenderlos en `WI-CORE-003`, pero aún no afirma que la integración esté implementada.

| Contract Sync | Decisión y acción prevista en Core |
| --- | --- |
| `CS-GH-20260925-001` | Acepta tratar solo HTTP 401 del provider token como `GITHUB_USER_TOKEN_INVALID`; 403/429 ambiguos son reintentables y no se presentan como sesión expirada. **Diferencia observable:** el Core actual colapsa 403 en 401; durante la migración se adopta el tratamiento conservador 503 para un 403 ambiguo. Debe conservarse como hallazgo explícito en la revisión final. |
| `CS-GH-20260925-002` | Acepta no devolver un compare parcial al límite de 300 archivos: `UNVERIFIABLE` cuando GitHub no permite probar completitud. |
| `CS-GH-20260925-003` | Confirma el DTO normativo del preflight: `{ status: 'READY' }`; branch/base se verifican internamente y no forman parte de la respuesta. |
| `CS-GH-20260925-004` | Acepta hasta 100 MB UTF-8 decodificados por archivo, transporte JSON/Base64 de hasta 136 MB solo en rutas autenticadas, deadline upstream de hasta 180 s y compensación de referencia best-effort sin rollback ciego. |
| `CS-GH-20260925-005` | Acepta body crudo de webhook de hasta 25 MB, firma verificada por GH antes del parseo, deadline GH→Core de 8 s, respuesta 200 solo para duplicado durable de PR y 202 para aceptación nueva/no-op. Core aún debe implementar el receptor normalizado. |

Los límites de 136 MB y 25 MB corresponden a cuerpos distintos: el primero es JSON/Base64 de propuesta en las rutas internas de publicación; el segundo es el ingreso crudo desde GitHub. El parser global ordinario de Express y el ZIP interno de snapshot para Docker/Sandbox no se modifican por esta sincronización.

La aprobación del contrato y el ACK permiten cerrar GH-005 y, después, evaluar el gate externo de `WI-CORE-003`. No prueban el código de Core, no sustituyen la revisión final conjunta solicitada por el usuario y no autorizan push, despliegue ni cutover.
