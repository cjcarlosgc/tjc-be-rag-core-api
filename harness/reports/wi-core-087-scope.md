# WI-CORE-087 — registrar el motivo del UNVERIFIABLE de las lecturas a GitHub Integration
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de Core el 2026-10-24: «Apruebo el WI de Core que registra el motivo del UNVERIFIABLE en GithubAccessHttpAdapter.lookup (código y estatus, sin cuerpos ni secretos, sin cambio de contrato). Para Integration solo prepara la indicación para cross.» Contexto: `ACCESS_REVERIFY` marca los 7 accesos `UNVERIFIABLE` y `POST /projects` en el workspace de `rag-tesis-org` responde `503 GITHUB_VERIFICATION_UNAVAILABLE`; `OrganizationAccessResolver` no logra listar las instalaciones de la App. Hoy nadie registra el motivo: `GithubAccessHttpAdapter.lookup` traga cualquier error (`catch` vacío) y Integration devuelve `UNVERIFIABLE` sin log, así que no se distingue arranque en frío, token, URL, clave de la App o respuesta de GitHub. Pedido por cross y el usuario; diagnóstico previo en el chat de Core (instalación de la App en `rag-tesis-org` verificada sana).

## Alcance aprobado

En `app/src/github-app/github-access-http.adapter.ts` (y su spec `github-access-http.adapter.spec.ts`), cada vez que una lectura a Integration termina en `UNVERIFIABLE`, `lookup` registra **un aviso (WARN)** con el **motivo**, sin cambiar el resultado que devuelve:
1. error de transporte o contrato del cliente (`GithubIntegrationClientError`): `code`, estatus HTTP (o «sin respuesta») y `retryable`;
2. error inesperado: solo el nombre del error, nunca su mensaje;
3. Integration respondió `{ status: 'UNVERIFIABLE' }` (el fallo está del lado de Integration/GitHub) frente a una respuesta de forma no reconocida;
4. `NOT_FOUND`/`NOT_INSTALLED` de `/organizations/installations` tratado como `UNVERIFIABLE` por el adaptador;
5. la **duración** de la llamada en milisegundos (≈10 000 ms delata el timeout del cliente, útil para el arranque en frío de Integration en Render).
El mensaje identifica la ruta fija (p. ej. `/organizations/installations`) y nada más: **sin cuerpos de petición ni respuesta, sin cabeceras, sin token, sin ids de instalación, repositorio, organización o usuario**.

## Fuera de alcance

- `GithubIntegrationClient`, `OrganizationAccessResolver`, resultados, estatus HTTP, timeouts, reintentos o manejo del arranque en frío (decisión aparte si el diagnóstico apunta ahí).
- Contratos, esquemas, DTO, rutas o enums (sin Contract Sync); migraciones.
- Cambios en GitHub Integration, Sandbox o Console: la contraparte de Integration (registrar por qué `listOrganizationInstallations` devuelve `UNVERIFIABLE`) se entrega a cross como **indicación compacta** (`wi-core-087-indicacion-integration.md`); Core no la ejecuta ni envía un handoff directo.
- Variables de entorno de Render; push, PR, merge.

## Criterios de aceptación

1. Cada rama de motivo (1–4) emite un WARN con motivo, estatus y duración, y la prueba lo demuestra; el resultado devuelto no cambia en ningún caso.
2. Ninguna línea registrada contiene cuerpos, cabeceras, token, ids ni mensajes de error crudos; hay pruebas que lo comprueban.
3. Lint, tests y build en verde; revisión independiente del `reviewer` (con foco en fuga de datos en logs).
