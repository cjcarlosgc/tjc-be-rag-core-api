# Plan — Frontera GitHub Integration

## Propiedad de cortes

Cada work item es local al repositorio que cambia. GitHub Integration usa sus WIs `WI-GH-*`; Core conserva `WI-CORE-003` para cambiar consumidores/adapters y recibir webhooks normalizados. Los IDs HU son transversales; ningún repo abre una HU nueva por este trabajo. Los Contract Sync enlazan la entrega del servicio con sus consumidores.

Orden aprobado:

1. `WI-GH-001`: inicializar servicio NestJS, configuración local, health y controles; no implementar operaciones GitHub.
2. En GitHub Integration, implementar cortes locales y Contract Sync propios, en orden: `WI-GH-002` (discovery/autorización/repositorio/organización/ramas), `WI-GH-003` (compare/tree/files/PR head), `WI-GH-004` (Checks y publicación en tres operaciones) y `WI-GH-005` (webhook verificado, normalizado y entregado a Core). Cada corte reutiliza el código existente de Core sin mover la decisión de dominio.
3. Antes de empezar `WI-CORE-003`, `WI-CORE-009` y el `externalDependencyGate` acreditaron manualmente los cierres `WI-GH-002`–`WI-GH-005`, sus Contract Sync importados en Core y destinatario `core`. Ese gate habilitó el WI; Core reemplazó los adapters directos y recibe eventos normalizados, manteniendo handlers/dominio. El cierre final también incluye `WI-GH-006` y su Contract Sync. El Harness no consulta repositorios vecinos ni convierte notificaciones en aprobación.
4. Completado en `WI-GH-006`: GitHub Integration expone las rutas autenticadas de usuario para App info, discovery, verify-access y branches, separadas del namespace `/internal/v1/github`, con CORS restringido y tokens redactados.
5. Completado en `WI-GH-006` y `WI-CORE-003`: Integration→Core consulta sincrónicamente con JWT Supabase y hechos GitHub verificados; Core valida la identidad/reglas locales y firma evidencia reciente ligada a usuario/acción/recurso, sin una segunda llamada a Integration.
6. Completado en `WI-CONSOLE-003`: Console llama directamente a Integration solo para esas cuatro capacidades y mantiene Core para workspace/Project, persistencia del binding, RAG y análisis. Las rutas Core equivalentes se preservan como compatibilidad.
7. La topología se revisó y cerró localmente por repositorio. La extensión de fecha original de PR se publicó en `WI-CORE-014`, se implementó en `WI-GH-007`, se consumió en `WI-CORE-011` y su espejo/consumo previo se validó en `WI-CONSOLE-008`. La corrección narrativa actual se redistribuye por Contract Sync. Ningún deploy, cambio de URL/secretos/DNS/CORS externo, configuración de Supabase/GitHub App, cutover ni cambio en Sandbox está incluido.

La dependencia entre repositorios no consulta APIs remotas: el coordinador documenta y verifica manualmente estado, reportes y Contract Sync de los WIs GH. `WI-CORE-009` hace que el Harness rechace la promoción de `WI-CORE-003` mientras falte evidencia local verificable. El corte migratorio quedó cerrado en código local; las rutas Core heredadas y el despliegue/cutover se retiran solo en otro corte autorizado.

## Criterios de extracción

- Ningún acceso `api.github.com`, creación de App JWT/installation token o verificación HMAC de webhook permanece en Core.
- Core conserva sus APIs y decisiones de producto, materialización a filesystem temporal y snapshot ZIP interno que Docker/Sandbox consume.
- Discovery OAuth mantiene el `repo` scope por esta migración. En el flujo nuevo, el provider token va Console→Integration solo para discovery y verificación de repo nuevo; verificación de binding existente y ramas usan identidad Core + GitHub App sin OAuth. Las rutas Core antiguas pueden reenviarlo temporalmente por compatibilidad. Nunca se registra ni persiste.
- Lecturas de GitHub distinguen `NOT_FOUND`, `NOT_INSTALLED` y `UNVERIFIABLE`; un error upstream nunca se convierte en ausencia confirmada.
- El servicio privado es inaccesible desde Console y navegador. Todos los errores y logs redactan tokens, cuerpos de GitHub/webhook y URLs firmadas.
- Las rutas de usuario de GitHub Integration son distintas de las internas; exigen sesión Supabase, CORS allowlisted y autorización Core síncrona. No exponen bearer servicio ni installation tokens.
- En el flujo directo Console→Integration, Core no recibe provider OAuth; la única excepción temporal es `GET /integrations/github/repositories`, ruta heredada de discovery que lo recibe y reenvía. El cliente Core→Integration rechaza redirects, solo acepta HTTPS fuera de loopback y nunca reenvía credenciales entre orígenes.
- El namespace de Contract Sync es `CS-CORE-YYYYMMDD-NNN`, `CS-CONSOLE-YYYYMMDD-NNN`, `CS-SANDBOX-YYYYMMDD-NNN` o `CS-GH-YYYYMMDD-NNN`, y todo evento nuevo identifica `sourceWorkItem`. IDs simples históricos anteriores al corte permanecen legibles y no se reescriben. Sandbox no se modifica hasta la homologación acordada.
- Se prueba el flujo webhook PR y las familias instalación/repositorio/acceso, incluyendo duplicados, repetición idempotente, payload malformado, fallo de Core y reintento.

## Preparación de un futuro despliegue (fuera de este WI)

No se aplican cambios externos ahora. Antes de un futuro cutover habrá que configurar la URL HTTPS de Integration en Console/Core, el allowlist CORS con los orígenes reales de Console, bearers separados Core↔Integration y `GITHUB_BINDING_EVIDENCE_SECRET` solo en Core. Primero se validan ambos backends y sus pruebas locales; después se prueba Console→Integration junto con la compatibilidad temporal de rutas Core. No se publican rutas privadas al navegador ni se retiran las rutas Core hasta un corte posterior aprobado.
