Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# Revisión contractual de WI-CORE-019 (Rol Writer y procedencia de Functional Knowledge)

Rango revisado: `632103a..02e4f1e5001bb2d74af1b88f7cc15da8750e28d0` (cortes A 8c05613, B e025062, C f4fd2f1, D 02e4f1e). Perfil confirmado en `harness/agent-profiles.yaml` (`contract-reviewer`: Sonnet 5.5, `claude-sonnet-5-5`, low). Solo lectura; no se ejecutaron pruebas (la evidencia de ejecución es del implementer).

Veredicto: **APPROVED**, con 3 hallazgos menores accionables (ninguno bloquea).

## Verificación por punto

1. **Enum y jerarquía.** `ProjectRole` agrega `WRITER` entre `MAINTAINER` y `READER` (schema + migración aditiva `20261008130000_project_role_writer`, con rollback documentado como inexistente). `roleForPermission`: `admin|maintain` -> MAINTAINER, `write` -> WRITER, `triage|read` -> READER, coherente con §6.13. La jerarquía se evalúa en código (`isRoleAtLeast`/`ROLE_RANK`), no con operadores del enum SQL. Miembro activo se sigue exigiendo siempre (sin cambios). OK.
2. **Matriz de rutas.** Controladores declaran: WRITER en `POST/DELETE .../integrations/github`, `POST .../enable` (repository-bindings l.166/202/214), `POST /analysis-runs/{id}/test-publications`, `POST /experiments`; MAINTAINER en `POST .../answers` (incluye UNKNOWN); ADMIN en `PATCH/DELETE /projects/{id}`; el resto READER. Coincide fila por fila con la tabla de §6.13 (l.972-978). `POST /retrieval-comparisons` figura en la fixture `app/test/support/interop-role-matrix.ts` con `implemented=false` y tiene fila Writer; la prueba de matriz compara la fixture con el contrato, así que se activa sola cuando exista la ruta (WI posterior de OE2). La fixture además separa `row` de `role`. El servicio de vinculación (`verified-repository-binding`) también pasó a Writer con la salvedad de `REVOKED` solo Admin. OK.
3. **403 PROJECT_ROLE_INSUFFICIENT.** `projectRoleInsufficient(required, current)` devuelve `details: { requiredRole, currentRole }` (`ProjectRoleInsufficientDetails`). Responder preguntas y UNKNOWN usan `confirmingRole(grant)`: Writer/Reader -> 403 con `requiredRole: MAINTAINER`. El guard ya rechaza antes con MAINTAINER; el servicio es defensa en profundidad. No se encontró un camino que registre `responder`/`UNKNOWN` con rol WRITER. OK.
4. **Procedencia.** `FunctionalKnowledgeResponse` agrega `confirmedByUserId`, `confirmedRole` (ADMIN|MAINTAINER, = `ConfirmingRole` del contrato l.766), `originHeadSha`, `sourceRef`, todos `?? null` (históricas = null, sin backfill). `originHeadSha` se toma de `run.headSha` y no participa de la vigencia (`findActive` sin cambio). Invariante `sourceRef` solo con `APPROVED_IMPORT` en el repositorio (error de programación, no de API; no hay camino HTTP que lo produzca hoy). Coincide con l.836-839. OK.
5. **Cambio observable.** El comportamiento observable (quien solo tiene `write` pasa de Maintainer a Writer y deja de poder responder/UNKNOWN; el rol cambia tras la reverificación `ALL` sembrada al arrancar, `ACCESS_REVERIFY:ALL`, o al primer evento/reverificación) ya está descrito en §6.13 l.942 ("un cambio observable"). No hace falta una nota nueva de fondo: basta Contract Sync dirigido a Console. Sí hace falta editar texto de estado (hallazgo F1).
6. **Consumidores.** Solo Console consume estas superficies (roles en `AccessGrant`/errores, `GET /projects/{id}/functional-knowledge`, 403 details). Sandbox y GitHub Integration no usan `ProjectRole` ni FK. Evento no breaking en el sentido de forma de ruta, pero con efectos que Console debe adoptar (abajo).

## Hallazgos

- **F1 (menor, spec).** §6.13 sigue diciendo "Implementado ... salvo el rol Writer ... pendiente de implementar en WI-CORE-019" (l.908), "definido y pendiente" en l.915, l.942, l.946, y en la "Estado de implementación" de la matriz (l.970: "hasta WI-CORE-019 el rol efectivo de quien tiene write sigue siendo Maintainer"). Tras el cambio esas frases son falsas. También `FunctionalKnowledgeResponse` (l.836 "pendiente, WI-CORE-019") y el encabezado de INTEROP-2.7 (l.14). Acción del leader al cerrar: consolidar el estado a implementado en `WI-CORE-019` y registrar en `CHANGELOG.md` (no cambia el contrato funcional, solo el estado). Debe hacerse antes de publicar el Contract Sync para que `sourceRevision` apunte a un contrato coherente.
- **F2 (menor, spec/doc).** La fixture de matriz y su comentario citan "INTEROP-2.4"; es historia, sin efecto. Opcional: actualizar el comentario a 2.7.
- **F3 (operativo, no contractual).** El siembra `ACCESS_REVERIFY:ALL` se ejecuta en `onApplicationBootstrap` y es idempotente; hasta que corra, los usuarios con `write` ya registrados conservan `MAINTAINER` (ventana tras el despliegue). Dejar constancia en el reporte de despliegue. Un rol `WRITER` almacenado no es leíble por código anterior a la migración (rollback imposible, ya documentado en la migración).

## Propuesta de evento Contract Sync

Emisor `core`, `sourceWorkItem: WI-CORE-019`, ID sugerido `CS-CORE-20261008-003` (verificar que no exista otro; el último en outbox es `-002`). Publicar tras cerrar F1 y con `--source-revision` = SHA completo del HEAD aprobado.

```yaml
type: CONTRACT_SYNC
id: CS-CORE-20261008-003
source: core
sourceWorkItem: WI-CORE-019
targets: [console]
scopePaths: [spec/contracts/interoperability-contract.md]
breaking: false
changed:
  - WI-CORE-019 implementa en Core lo ya definido en INTEROP-2.7 (DEC-ORG-003, DEC-FK-002) sin cambiar rutas ni formas de request. ProjectRole agrega WRITER (ADMIN > MAINTAINER > WRITER > READER); el permiso de GitHub write deriva ahora WRITER en vez de MAINTAINER y la reverificacion de acceso reclasifica los registros existentes (cambio observable, sin sesion nueva). Writer puede vincular, pausar y reactivar el repositorio, publicar tests y crear experimentos; no puede responder preguntas funcionales ni registrar UNKNOWN (403 PROJECT_ROLE_INSUFFICIENT con details requiredRole MAINTAINER y currentRole WRITER). FunctionalKnowledgeResponse agrega confirmedByUserId, confirmedRole (ADMIN o MAINTAINER), originHeadSha y sourceRef, todos null en reglas historicas; originHeadSha es procedencia, no vencimiento. POST /retrieval-comparisons (Writer) sigue sin implementar.
requiredAction:
  - Console: importar el evento, acusarlo con su WI consumidor y adoptar el tipo de rol con WRITER (orden de jerarquia ADMIN, MAINTAINER, WRITER, READER) en tipos, comparaciones de rol y UI de permisos; habilitar para Writer las acciones de vincular/pausar/reactivar repositorio, publicar tests y crear experimentos, y deshabilitar o explicar para Writer y Reader responder preguntas funcionales y UNKNOWN; mapear 403 PROJECT_ROLE_INSUFFICIENT usando details.requiredRole y details.currentRole; mostrar la procedencia de cada regla (quien la confirmo, con que rol, y el commit de origen) con estado vacio para null, sin tratar originHeadSha como caducidad. No requiere cambio de Sandbox ni GitHub Integration.
sourceRevision: <SHA completo del HEAD aprobado>
status: C-PENDING
```

Comando: `node harness/contract-sync.mjs publish --id CS-CORE-20261008-003 --work-item WI-CORE-019 --targets console --scope-paths spec/contracts/interoperability-contract.md --breaking false --changed '<changed>' --required-action '<requiredAction>' --source-revision <SHA>`.

## Resumen para el leader

- status: APPROVED
- blockers: ninguno
- siguiente paso: cerrar F1 (spec/CHANGELOG), presentar diff y evidencia al Human Reviewer, y publicar `CS-CORE-20261008-003` dirigido solo a Console con el SHA aprobado.
