# Entrega y trazabilidad Git

**Estado:** APROBADO
**Alcance:** RAG Core API, Developer Console y Test Execution Sandbox

## Versión SDD conjunta

- `sddVersion` identifica la línea base consolidada de toda la solución, no una versión local independiente de cada repositorio.
- La línea base vigente es SDD 3.1 / Harness V3, común a los cuatro repositorios. `planningBaseline: 2026-09-24-core-console-transition` se conserva solo como marca histórica de la adopción por etapas y como referencia de fecha para Contract Sync.
- Todo cambio de reglas del SDD o del Harness se define primero en Core y se replica a los demás repositorios en el mismo corte de trabajo; los archivos comunes del Harness (validadores, `WORKFLOW.md` base, roles, agentes) deben coincidir según el checklist de homologación de `harness/README.md`.
- `SYSTEM-*` e `INTEROP-*` mantienen versionado propio y solo cambian cuando cambia su contrato correspondiente.

## Unidad de commit

- Un commit representa un cambio coherente, revisable y verificable; no equivale mecánicamente a una HU.
- Una HU puede requerir varios commits y un commit puede abarcar varias HU cuando el corte sea realmente transversal.
- El commit no debe mezclar cambios independientes solo para reducir la cantidad de commits y debe dejar el repositorio en un estado verificable.

## Trazabilidad obligatoria

Todo commit creado por el equipo o por un agente debe usar un asunto compatible con Conventional Commits y declarar en el cuerpo todas las HU afectadas:

```text
<type>(<scope>): <resultado observable>

Refs: HUxx[, HUyy...]
```

- Los IDs de `Refs` deben existir en `spec/backlog.md`.
- Un cambio de SDD, arquitectura, refactor o infraestructura también referencia las HU cuyo diseño, implementación o verificación afecta.
- Si el cambio responde a decisiones, puede agregar `Decisions: DEC-...`; esa línea no sustituye `Refs`.
- Si no es posible identificar una HU afectada, el cambio debe asociarse primero a un work item del backlog; no se inventan IDs ni se hace el commit sin trazabilidad.

## Revisión

La entrega tiene dos niveles de revisión:

1. **Revisión del work item:** el estado `IN_REVIEW` verifica el corte de una o más HU antes de `DONE`, según `harness/WORKFLOW.md`. El usuario revisa por defecto; puede pedir explícitamente que un agente independiente lo haga. El implementer nunca aprueba su propio corte.
2. **Revisión consolidada del sprint:** antes de cualquier push, el reviewer revisa de forma independiente el rango completo de commits que se pretende publicar, no solo cada commit por separado.

La revisión consolidada comprueba como mínimo:

- coherencia y trazabilidad `Refs` de cada commit;
- correspondencia del diff acumulado con las HU y specs aprobadas;
- ausencia de decisiones bloqueantes o ampliaciones silenciosas de alcance;
- pruebas, lint y build aplicables en verde;
- manejo de errores, seguridad, observabilidad y limpieza;
- resolución y nueva revisión de cualquier hallazgo.

El resultado se registra en `harness/reports/sprint-<N>-review.md` con el rango o commit final revisado, HU incluidas, verificaciones ejecutadas, hallazgos y veredicto `APPROVED` o `CHANGES_REQUESTED`. Para una entrega extraordinaria fuera del cierre se usa `harness/reports/delivery-<scope>-review.md`.

El reporte puede incorporarse después de la aprobación mediante un commit exclusivo de evidencia `docs(review): ...`. Esa única diferencia no invalida el veredicto si el reviewer comprueba antes del push que el commit solo modifica los reportes declarados y conserva las mismas HU; cualquier otro cambio sí exige repetir la revisión completa.

## Defectos en otro componente

- Si al investigar un fallo la causa raíz está en otro componente de la solución (Developer Console, Test Execution Sandbox, GitHub Integration, o cualquier repositorio distinto al que se está trabajando), el agente no aplica el fix en ese repositorio: diagnostica y entrega la indicación a **cross**, la sesión coordinadora, que la delega al agente propio de ese componente.
- La indicación es un párrafo compacto pero detallado (no un documento extenso): síntoma observado, causa raíz con archivo y línea, y evidencia (logs, IDs) suficiente para reproducir sin reinvestigar desde cero.
- Esta regla no aplica dentro del propio repositorio: un defecto local se corrige siguiendo el flujo normal de revisión y push definido en este documento.

## Delegación entre sesiones de agente

- La sesión coordinadora es **cross** (carpeta raíz `Tesis/`). Ningún repositorio es la sesión coordinadora: cada uno trabaja dentro de su propio SDD y Harness.
- Cross envía handoffs a la sesión de cada componente (`[TN]-Core`, `[TN]-Integration`, `[TN]-Sandbox`, `[TN]-Console`) sin pedir confirmación previa al usuario. Cada handoff es autocontenido (alcance, decisiones ya tomadas, criterio de terminado) y pide responder a cross.
- Una sesión que recibe un handoff lo ejecuta con su propio flujo (WI, reviewer, gates) y responde a cross al terminar o al bloquearse con resultado, evidencia y pendientes. Un handoff no modifica por sí solo la fuente de verdad (ver «Frontera de contexto» de `AGENTS.md`).
- Excepcionalmente el usuario puede pedir que un cambio compartido lo ejecute la propia sesión cross sobre varios repositorios; esa autorización vale solo para ese cambio.
- El trabajo se hace siempre en `feature/jean`. El merge a `develop` y todo push, PR o cambio de `main` los ordena el usuario en cada ocasión.

## Puerta de push

- Por defecto se realiza un push por repositorio al cierre de cada sprint.
- Solo puede publicarse el commit final exacto que recibió veredicto `APPROVED`, salvo el commit exclusivo de evidencia definido arriba; cualquier otro cambio posterior invalida la aprobación y requiere una nueva revisión.
- No se hace push con hallazgos abiertos, verificaciones requeridas fallidas ni cambios relevantes sin revisar.
- Un push extraordinario antes del cierre del sprint requiere autorización humana explícita y debe superar la misma revisión previa.
- Un agente commitea por su cuenta al cerrar cada corte con sentido lógico (ver "Unidad de commit"), sin pedir permiso previo ni detenerse a confirmarlo. Push, PR, merge o cambios de infraestructura externa siguen requiriendo una solicitud explícita del usuario en cada ocasión; el commit local nunca la implica.
