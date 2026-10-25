# Protocolo de verificación viva de OE3 (casos C1–C6, IOE3.1, IOE3.2 y ConcordanciaFK)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: protocolo, sin resultados.** Describe cómo ejecutar y registrar la verificación del gobierno de Functional Knowledge (FK) y ACTION_REQUIRED sobre el despliegue vigente tras el tag `arch-v1.0` (tesis, Anexo I, Tablas 62 y 63; IOE3.1 e IOE3.2). Lo ejecutan el usuario y cross sobre un Project controlado; este documento no afirma que nada de lo descrito se haya ejecutado. La verificación automática del mismo mecanismo está en `app/src/ct/oe3-c1-c6.spec.ts` (casos y campos) y `app/src/ct/oe3-active-index.pg.spec.ts` (índice único de reglas ACTIVE contra Postgres real); la evidencia viva la complementa, no la sustituye.

## 1. Reglas
- OE3 prueba el comportamiento del mecanismo, no la calidad generativa. Cada caso se ejecuta una vez, con el resultado esperado fijado antes de ejecutar (columna «Resultado esperado»); un resultado distinto es NO CUMPLE y se registra, no se repite hasta que salga bien.
- Un Project nuevo y dedicado a OE3, ligado a un fork con la GitHub App y su binding creado antes de abrir cada PR. Un Project nuevo evita la dependencia del historial del Project (los símbolos `DIRECTLY_CHANGED` se deciden contra la última versión indexada, spec 013 OC13) y de reglas FK heredadas (las reglas son por `projectId`).
- Con Integration y Core despiertos antes de cada PR (`/health` en 200) y confirmación de que el Run aparece en la Console.
- Cuentas: una por rol de Project que se quiera ejercitar: ADMIN, MAINTAINER, WRITER y READER. El rol sale del permiso de GitHub sobre el repositorio vinculado (`admin`/`maintain` → Maintainer; `write` → Writer; `triage`/`read` → Reader; INTEROP-2.7 §6.13) y del rol Admin del Project. Si no hay cuenta para algún rol, se declara; C3 se limita a lo que pueda ejercerse y la prueba automática cubre el resto.
- Datos a anotar de todo el ejercicio: SHA del tag, `projectId`, `analysisRunId` de cada Run, `headSha`, usuario y rol de cada acción, hora UTC.

## 2. Preparación
1. Crear el Project y su binding (rama de integración `develop` del fork).
2. Rama de feature desde `develop` con un cambio en un método PHP que introduzca una ramificación, un `throw` o una escritura/transición de estado (cambio elegible, DEC-FK-003). Anotar la regla esperada (texto de la respuesta que se dará) antes de ejecutar: sirve para ConcordanciaFK.
3. Control negativo: otra rama con un cambio sin construcciones (comentarios, nombres, formato).

## 3. Casos
Las llamadas son las de la API de Core (la Console las hace por detrás): `GET /analysis-runs/{id}/context-questions`, `POST /analysis-runs/{id}/context-questions/{questionId}/answers` con `{ choice, answer, conflictResolution? }`, `GET /projects/{id}/functional-knowledge?status=ACTIVE|SUPERSEDED`, `GET /action-required?projectId=…`. El `POST …/answers` responde `202 Accepted` con `outcome` `ANSWERED` o `ABSTAINED`.

| Caso | Acción | Resultado esperado | Qué capturar | Prueba automática |
|---|---|---|---|---|
| C1 | PR con el cambio elegible; PR de control sin construcciones | El Run elegible termina en `ACTION_REQUIRED` con una pregunta atómica (un target, un escenario); el de control no activa ACTION_REQUIRED | JSON de `context-questions` y estado del Run de cada PR; captura de la bandeja | `OE3-C1` |
| C2 | Con cuenta MAINTAINER o ADMIN, responder `choice` no `UNKNOWN` con texto; variante: empujar un commit al PR antes de responder | Respuesta aceptada con `knowledgeId`; la regla ACTIVE guarda `confirmedByUserId`, `confirmedRole` y `originHeadSha` = HEAD del Run; el Run continúa con el HEAD vigente. En la variante, la pregunta del HEAD viejo queda OBSOLETE (404 al responder) y el Run nuevo reevalúa | JSON de la respuesta y de la regla (`functional-knowledge`), estado final del Run, captura | `OE3-C2` |
| C3 | Con cuenta WRITER (y READER) intentar responder | 403 `PROJECT_ROLE_INSUFFICIENT`; no se crea ninguna regla ni abstención | Respuesta HTTP y listado de reglas sin cambios | `OE3-C3` |
| C4 | Con MAINTAINER o ADMIN, responder `UNKNOWN` | Resultado `ABSTAINED`, `knowledgeId` nulo; la pregunta sigue PENDING, el Run en ACTION_REQUIRED, sin regla nueva ni continuación; queda la abstención con usuario, rol y hora | Respuesta, estado del Run, fila de `functional_question_abstentions` | `OE3-C4` |
| C5 | Dos reglas de la misma clave en tiempos distintos con `SUPERSEDE` explícito; y una regla de otra clave (otro escenario o target) | La primera pasa a SUPERSEDED y la nueva queda ACTIVE con `supersedesId`; la de otra clave coexiste ACTIVE | Listados `status=ACTIVE` y `status=SUPERSEDED` | `OE3-C5`, `oe3-active-index.pg.spec.ts` |
| C6 | Responder una pregunta cuya clave ya tiene regla ACTIVE sin `conflictResolution`; repetir con `KEEP_EXISTING` y con `SUPERSEDE` | 409 `FUNCTIONAL_KNOWLEDGE_CONFLICT` con la regla ganadora (`conflictingKnowledge`); `KEEP_EXISTING` deja intacta la ACTIVE; `SUPERSEDE` la reemplaza; nunca se sobrescribe en silencio | Los tres JSON y el listado de reglas | `OE3-C6`, `oe3-active-index.pg.spec.ts` |

Receta para C5 y C6 (deducida de la lógica del evaluador; confirmar al ejecutarla): las preguntas son por Run, así que dos PR sobre la misma construcción preguntan la misma clave. Con ambos Runs en ACTION_REQUIRED sin responder ninguno, responder el primero crea la regla ACTIVE; responder el segundo produce el conflicto (C6) y, con `SUPERSEDE`, el reemplazo (C5).

## 4. Indicadores
- **IOE3.2 (cumplimiento del protocolo)** = casos conformes / casos evaluados. Un caso es conforme si lo observado coincide con su resultado esperado en activación, autoridad, HEAD, UNKNOWN y conflicto. Meta 100 % en C1–C6.
- **IOE3.1 (integridad de FK)** = reglas ACTIVE con fuente, alcance, versión, estado y auditoría completa / reglas ACTIVE. En Core no existe una columna `version`: la versión se representa por el linaje `supersedesId` + `createdAt` (decisión D-23). Consulta de solo lectura (sustituir el `projectId`; la corre quien tenga acceso a la base):

```sql
select count(*) filter (where status = 'ACTIVE') as reglas_active,
       count(*) filter (where status = 'ACTIVE'
         and source is not null and scope is not null and "scenarioKey" is not null
         and "confirmedByUserId" is not null and "confirmedRole" is not null
         and "originHeadSha" is not null and "createdAt" is not null
         and (source <> 'APPROVED_IMPORT' or "sourceRef" is not null)) as reglas_completas
from functional_knowledge
where "projectId" = '<projectId>';
```
`source`, `scope`, `scenarioKey` y `createdAt` son NOT NULL o tienen valor por defecto en el esquema, así que esas condiciones se cumplen siempre; en la práctica la completitud la deciden `confirmedByUserId`, `confirmedRole`, `originHeadSha` y, solo con `APPROVED_IMPORT`, `sourceRef` (Core no tiene importador: no aplica a reglas `HUMAN_ANSWER`). La consulta no comprueba el linaje; la comprobación de versión (D-23) es otra: toda regla SUPERSEDED debe tener una sucesora que apunte a ella con `supersedesId`.

```sql
select count(*) as superseded_sin_sucesora
from functional_knowledge s
where s."projectId" = '<projectId>' and s.status = 'SUPERSEDED'
  and not exists (select 1 from functional_knowledge n where n."supersedesId" = s.id);
```
Resultado esperado: 0.

## 5. ConcordanciaFK (descriptiva)
Para cada regla resultante de C2, C5 y C6, comparar la regla esperada por el protocolo (texto registrado antes de ejecutar) con la regla finalmente aplicada (la ACTIVE al final del caso): concordante si coincide el contenido esperado y el estado (ACTIVE o SUPERSEDED). Se reporta como proporción y por caso; no sustituye a IOE3.2.

## 6. Registro de evidencia
Un Evidence ID por caso y por captura (`EV-OE3-C1-…`, convención de cross) en `03_OE3_FUNCTIONAL_KNOWLEDGE`, con los JSON, hashes y la fila del registro maestro; las capturas apoyan, no sustituyen. Los resultados reales los registra quien ejecuta.

## 7. Límites declarados
- La «versión» de la Tabla 63 es el linaje (D-23); no hay número de versión.
- `sourceRef` no se ejercita: no hay flujo de importación aprobado en Core.
- La ejecución viva depende de contar con cuentas en cada rol; la prueba automática de WI-CORE-100 demuestra el mecanismo, no el despliegue.
- La receta de C5 y C6 es una deducción de la lectura del código y debe confirmarse en la ejecución.
