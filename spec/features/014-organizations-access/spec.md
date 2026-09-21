# 014 — Organizaciones, workspaces y acceso derivado de GitHub

**Estado:** DEFINIDO, pendiente de verificación SDD y aprobación humana. Sin decisiones bloqueantes.
**Story IDs:** HU58-HU64
**Contrato:** SYSTEM-2.4 / INTEROP-2.4 (§6.1, §6.8, §6.9, §6.13)
**Decisiones:** `DEC-ORG-001` APROBADO (2026-09-20); `DEC-ORG-002` APROBADO (2026-09-20; casos borde, enmienda de visibilidad personal, membresía activa siempre y corrección de seguridad primero).

## Objetivo

Permitir que un equipo (una organización) trabaje sobre los mismos Projects sin que Core administre miembros: GitHub es la fuente de verdad de la autorización. Core ofrece workspaces (cuenta personal y organizaciones donde la GitHub App está instalada), deriva un rol Admin/Maintainer/Reader por Project, y pierde el acceso cuando GitHub lo revoca. El login pasa a ser solo GitHub.

## Invariantes

- Ninguna identidad implica autorización de la otra: ver un Project no autoriza automatización sobre el repositorio, que sigue autorizada solo por la GitHub App; el provider token OAuth del usuario solo sirve para discovery y nunca se usa para verificar accesos.
- Los Projects personales no se comparten: los ve únicamente su creador, siempre como Admin y sin registro de acceso; solo se comparte mediante organizaciones (`DEC-ORG-002`). `GET /projects` nunca devuelve Projects personales de otra persona.
- Core no administra miembros ni invitaciones. No existen tablas `Organization` ni `Membership`; la persistencia mínima es el vínculo `userId -> githubUserId`, las columnas de organización en `Project` y el registro `(projectId, userId, rol, verifiedAt)`, que existe solo para Projects de organización.
- El `githubUserId` sale de `identities[].id` de la Admin API de Supabase consultada por `sub`, nunca de `user_metadata`.
- En un Project de organización se exige SIEMPRE ser miembro activo de la organización además del permiso sobre el repositorio (privado, internal o público). Un colaborador externo (no miembro) no accede aunque tenga `write`; el `read` implícito de un repositorio público no cuenta. Un binding `REVOKED` deja el Project visible solo a los Admin (reactivarlo lo hace un Admin).
- Default-deny: toda ruta autenticada declara su rol mínimo o una excepción explícita; una ruta sin declaración falla el guard y una prueba que enumera el router.
- Un alta de acceso nunca sobrescribe una revocación posterior al inicio de su verificación; las verificaciones contra GitHub tienen tope de concurrencia y presupuesto por petición, sin memoizar denegaciones (se acepta el riesgo residual de límite de tasa).
- Jerarquía Admin ⊃ Maintainer ⊃ Reader. Reader solo consulta; Maintainer opera binding, preguntas funcionales, publicaciones y experimentos; solo Admin crea, renombra y elimina Projects. La matriz de `INTEROP-2.4` §6.13 clasifica cada ruta.
- Un recurso no visible responde el mismo `404` que uno inexistente; uno visible con rol insuficiente, `403 PROJECT_ROLE_INSUFFICIENT`. Un rol nunca se infiere del payload de un webhook: siempre sale de una verificación viva con el installation token.
- El registro de acceso no tiene TTL ni caché: rige hasta que un evento o la reconciliación horaria lo cambia. Si GitHub no responde, Core conserva lo registrado y no concede nada nuevo (`503 GITHUB_VERIFICATION_UNAVAILABLE` en accesos directos; los listados omiten lo no verificado).
- Un Project pertenece a un único workspace, fijado al crearlo; tiene un solo repositorio y no se revincula. En una organización solo se vinculan repositorios de esa organización; en el workspace personal, solo los propios; vincular exige `maintain`/`write`/`admin` sobre el repositorio. La corrección de seguridad de esa validación va primero (corte 4a).
- Una organización que desaparece, cuya App se desinstala o que queda sin owners conserva Projects y evidencia, pero dejan de verse (binding `REVOKED`); reaparecen al reinstalar la App o volver la organización y el binding se reactiva explícitamente (HU57). Nada se reasigna a otro workspace.
- El invariante de `013` sobre bindings (un repositorio por Project, `REVOKED` no se degrada, borrado lógico) se conserva; el borrado solo lo hace un Admin.
- Los tokens de usuario, el provider token y la credencial de servicio de Supabase no se persisten ni se registran.

## Comportamiento por historia

- **HU62 — login solo GitHub:** el correo y la contraseña se retiran; Core exige identidad GitHub en toda sesión (`401 GITHUB_IDENTITY_REQUIRED`). Consolidado en `012-web-authentication`. El manual linking de identidades de Supabase permanece deshabilitado y `AUTH_BYPASS` de desarrollo aporta una identidad GitHub sintética.
- **HU58 — workspaces:** `GET /workspaces` lista la cuenta personal y cada organización con la App instalada donde el usuario es miembro activo, con su rol (`ADMIN` = owner, `MEMBER`).
- **HU63 — ciclo de vida del Project:** `POST /projects` con `workspaceId` (solo owner en una organización; omitido = personal; la creación en organización entra con el corte 3), `PATCH /projects/{projectId}` para renombrar y `DELETE` ajustado, todos solo Admin. Un Project nace sin repositorio y solo lo ven sus Admin.
- **HU59 — acceso automático:** en un Project de organización el registro de acceso se crea al entrar, verificando en vivo el rol o permiso; nadie invita.
- **HU60 — roles derivados de GitHub:** Admin = owner de la organización (en personal, el creador, siempre y sin verificación), Maintainer = miembro activo con `maintain`/`write`/`admin` sobre el repositorio vinculado, Reader = miembro activo con `triage`/`read`. `ProjectResponse` expone `workspace` y `role`; redefine el alcance de HU45 y solo aplica a organizaciones.
- **HU64 — restricciones de binding:** `GET /integrations/github/repositories?workspaceId`, permiso mínimo en `verify-app-access` y `branches` (corrección de seguridad), `REPOSITORY_OUTSIDE_WORKSPACE`, `REPOSITORY_PERMISSION_INSUFFICIENT` y el orden de validación de `POST .../integrations/github`. Corte 4a (propietario y permiso, primero y solo para Projects personales) y corte 4b (rol Maintainer y rama de organización, dentro del corte 3).
- **HU61 — pérdida de acceso:** eventos `member`, `membership`, `organization`, `team` y `repository` en el ingress existente más una reconciliación horaria; sin cambios en el modelo de análisis PR-driven.

## Casos operativos obligatorios

1. Usuario con solo cuenta personal: ve su workspace personal, crea y elimina sus Projects como Admin.
2. Miembro de una organización con la App instalada: aparece el workspace; no owner que intenta crear recibe `403 WORKSPACE_ADMIN_REQUIRED`.
3. Owner crea un Project en la organización: nace sin repositorio y solo lo ven los owners; el primer vínculo lo hace un Admin.
4. Repositorio de otra organización o ajeno en personal: `400 REPOSITORY_OUTSIDE_WORKSPACE`; con solo `read`/`triage`: `403 REPOSITORY_PERMISSION_INSUFFICIENT`; sin ningún permiso: `404 GITHUB_REPOSITORY_NOT_FOUND` (paso previo a `REPOSITORY_OUTSIDE_WORKSPACE`).
5. Miembro activo de la organización con `write` entra por un deep link a un Run de un Project de la organización: se verifica en vivo, se crea el registro `MAINTAINER` y puede responder la pregunta funcional y publicar; un Reader solo consulta (`403` en `answers`, `test-publications`, `POST /experiments` y binding).
6. Se elimina un colaborador directo de un repositorio de un Project de organización (`member.removed`): se reverifica, se borra el registro (o se conserva el de quien aún tiene acceso por Team u organización) y las suscripciones WebSocket de ese usuario al Project se cierran.
7. Cambia el rol en la organización o el permiso base sin evento fiable: la reconciliación horaria lo corrige dentro de la hora.
8. GitHub no responde: los registros existentes siguen vigentes, `GET /workspaces` y los listados no ofrecen lo nuevo y un acceso directo no verificable responde `503`; la reconciliación no revoca nada y se reprograma.
9. Renombre del repositorio: se actualiza `repositoryName`; transferencia fuera del workspace o eliminación: binding `REVOKED`, evidencia intacta.
10. Se desinstala la App de la organización o la organización desaparece: sus Projects dejan de verse para todos y se conservan; al reinstalar reaparecen con binding `REVOKED` hasta que un Admin lo reactive.
11. Usuario sin identidad GitHub en Supabase (cuenta antigua de correo): `401 GITHUB_IDENTITY_REQUIRED`.
12. Colaborador externo (no miembro) con `write` sobre el repositorio de un Project de organización: `404` en todas sus rutas, en repositorios privados, internal y públicos.
13. Project personal: solo su creador lo ve; cualquier otra persona, colaborador de su repositorio incluido, recibe `404`, y `GET /projects` nunca lo lista. Un repositorio público vinculado a un Project de organización no hace visible el Project a quien no es miembro activo.
14. Con el binding `REVOKED`, un Maintainer o Reader deja de ver el Project y el Admin lo reactiva con `POST .../enable` o lo elimina.
15. `verify-app-access` y `branches` con permiso menor a `maintain`: `403 REPOSITORY_PERMISSION_INSUFFICIENT`; sin visibilidad: `NOT_AUTHORIZED` y `404` respectivamente; permiso no verificable: `503 GITHUB_VERIFICATION_UNAVAILABLE`. Un Reader no debe llamar `verify-app-access` (usa `GET .../integrations/github`).
16. Carreras: un alta de acceso en vuelo y un evento de revocación concurrente terminan sin registro; ningún alta recrea un acceso revocado. Un `ACCESS_REVERIFY` no verificable se reprograma; la reconciliación se reprograma aunque el proceso se caiga a mitad.
17. WebSocket: el usuario pierde el acceso, el Project se borra o su binding pasa a `REVOKED` (no Admin): sus sockets salen de las salas del Project; una suscripción cuya verificación no está disponible se rechaza con motivo reintentable.
18. Un binding, un Run o una pregunta de un Project no visible: `GET /action-required?projectId=X` responde `404 PROJECT_NOT_FOUND`.
19. Matriz de autorización: cada ruta de `INTEROP-2.4` §6.13 responde `404` sin visibilidad, `403` con rol insuficiente y funciona con el rol mínimo.

## Seguridad y auditoría

Un token de usuario no llega a GitHub salvo el provider token en el discovery. Verificaciones vivas y reconciliación (incluida la revalidación de propietario y nombre del repositorio vinculado) usan solo el installation token de la App (`Metadata: read`, `Members: read`). Se registran (sin secretos, tokens ni payloads completos) las altas y bajas de acceso con su causa (`ENTRY`, `EVENT:<nombre>`, `RECONCILIATION`) y los resultados `no verificable`. La credencial de servicio de Supabase es solo de servidor.

## Precondiciones de despliegue (`DEC-ORG-001`/`DEC-ORG-002`; no bloquean implementar ni probar con fakes)

1. La corrección de seguridad del bundle A (identidad + corte 4a) está desplegada ANTES de que la GitHub App sea instalable por terceros: hasta entonces la App no debe ser instalada por terceros (idealmente vuelve a ser privada).
2. Después, la GitHub App es pública ("Any account"), sin listing en Marketplace, con `Members: read` y los eventos `member`, `membership`, `organization`, `team` y `repository` suscritos; cada organización acepta el permiso.
3. Se validan contra una organización real, con la App instalada, las lecturas aún no probadas: rol de owner (`memberships`), permiso heredado por Team o permiso base, membresía `pending` y colaborador externo (no miembro) con permiso sobre el repositorio.
4. Orden de login: la Console con login solo GitHub se publica antes o a la vez que Core exige identidad GitHub; el proveedor de correo y contraseña de Supabase Auth se deshabilita cuando la Console ya no lo ofrece, nunca antes.
5. El manual linking de identidades de Supabase permanece deshabilitado.
6. Los cortes 2, 3 y 5 se publican juntos (bundle B; 4b va dentro del corte 3): conceder acceso a otras personas (3) exige poder revocarlo por evento (5), y workspaces de organización sin roles no tienen uso.

## Fuera de alcance

- Gestión de miembros, invitaciones o roles propios en Core; el "equipo" es la organización y los Teams de GitHub no son workspace.
- Marketplace, lista de cuentas permitidas en Core y caché de permisos.
- Compartir Projects personales con colaboradores.
- Reasignar Projects entre workspaces o cambiar el repositorio de un Project.
- `DEC-VAL-001` (autorización organizacional empresarial): no se cierra.
