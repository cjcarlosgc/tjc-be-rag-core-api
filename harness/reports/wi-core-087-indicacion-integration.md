# WI-CORE-087 — indicación para el agente de GitHub Integration (vía cross)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Para:** `[TN]-Integration`, a través de `[TN]-Cross`. **Procedencia:** el usuario pidió en el chat de Core (2026-10-24) que, para Integration, Core «solo prepare la indicación para cross». Core no ejecuta esto ni envía un handoff directo; el trabajo lo hace el flujo SDD de Integration y solo cuando cross y el usuario lo ordenen. Rama `feature/jean`; sin push, PR ni merge sin orden explícita.

## Problema observado

`ACCESS_REVERIFY` marca los 7 accesos `UNVERIFIABLE` y `POST /projects` en el workspace de `rag-tesis-org` responde `503 GITHUB_VERIFICATION_UNAVAILABLE`: Core no logra listar las instalaciones de la App (`POST /internal/v1/github/organizations/installations`). Core registra ahora el motivo de su lado (WI-CORE-087), pero **Integration devuelve `200 {status:'UNVERIFIABLE'}` sin dejar rastro**, así que desde Core no se distingue el fallo frente a GitHub del fallo de Core→Integration. Verificado: el servicio responde (`/health` 200; el endpoint da 401 sin bearer) y la instalación de la App en `rag-tesis-org` está sana (no suspendida, `repository_selection=all`).

## Qué pedir a Integration (un WI propio, sin cambio de contrato ni de wire)

En `app/src/github/github-app-auth.service.ts`, `listOrganizationInstallations()` devuelve `{ status: 'UNVERIFIABLE' }` en seis puntos distintos sin registrar nada. Registrar un **WARN con el motivo** (categoría + estatus HTTP de GitHub + duración), sin cambiar lo que devuelve:

| Punto | Motivo a registrar |
|---|---|
| `signAppJwt()` lanza (variables ausentes, clave que no decodifica ni parsea) | `JWT_NO_FIRMABLE` (sin valores de las variables) |
| `this.api.request(...)` lanza (red o timeout de 10 s) | `GITHUB_SIN_RESPUESTA` + duración |
| `!response.ok` | `GITHUB_HTTP_<estatus>` (401 = JWT rechazado: clave/ID/reloj; 403/429 = límites) |
| el cuerpo no es un array | `RESPUESTA_NO_ES_LISTA` |
| una entrada sin `account`, con tipo distinto de `Organization`/`User`, ids no enteros seguros o `login` no string | `INSTALACION_INVALIDA:<tipo>` (sin logins ni ids) |
| más de `MAX_PAGES` (10) páginas | `DEMASIADAS_PAGINAS` |

- Sin cuerpos de respuesta, sin JWT, sin clave, sin variables de entorno, sin ids ni logins. Respetar la política de logs de Integration (commit `247097f`: logs sin mensaje crudo). Como dato opcional, el campo `message` de un error de GitHub (texto público, p. ej. «Bad credentials» o «A JSON web token could not be decoded») distingue clave/ID de reloj desfasado; decidirlo Integration/usuario.
- Pruebas por motivo y una de no fuga, en el estilo de sus specs actuales.
- Opcional y por separado: los mismos motivos en `getOrganizationMembership` y `listOrganizationOwners` (también devuelven `UNVERIFIABLE` en silencio) y que `/health` compruebe que la clave de la App **parsea** (hoy solo comprueba que no esté vacía, así que una clave mal codificada pasa la readiness).

## Contexto útil para cross

- El arranque en frío es independiente: en Render, Integration tarda 22–33 s en despertar y Core corta a los 10 s (`DEFAULT_TIMEOUT_MS` del cliente). Con los logs de Core se verá como duración ≈10 000 ms y `sin respuesta`. Mitigar eso es infraestructura (servicio siempre activo o ping de mantenimiento) o una decisión aparte de Core (timeout/reintento), no parte de este WI.
- El usuario puede discriminar ya, sin código del repositorio: el script `diagnose-github-app.mjs` (modos `app` y `core`) que Core dejó en el scratchpad de su sesión; solo imprime códigos y estados, sin secretos, y lo corre el usuario con sus credenciales.
- Integration tiene el PR #6 (`feature/jean` → `develop`) abierto; esta indicación se aplica sobre `feature/jean`.
