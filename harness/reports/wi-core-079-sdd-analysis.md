# WI-CORE-079 — análisis SDD de la ronda única de contratos (INTEROP-2.20 / GH-INTEROP-1.9 / SYSTEM-2.15)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Alcance: solo lectura (no se leyó ningún `.env`; no se ejecutó código: `node` no está en el PATH de esta sesión, por lo que todo lo que dependa de ejecutar es DESCONOCIDO y se marca). Rutas relativas a `Tesis/<repo>/`; Core = `tjc-be-rag-core-api`, Integration = `tjc-be-github-integration-api`, Sandbox = `tjc-be-test-execution-sandbox`.

Decisión del usuario cubierta (chat de Core, 2026-10-24): una sola ronda INTEROP-2.20 / GH-INTEROP-1.9 con el esquema CT-01, E-01, SYSTEM-2.15 (`tjc-piloto-ventas`) y la corrección de `sandbox-result.failed.json`; sin `oracleRef`.

Estado actual de registro: `WI-CORE-079` existe en `harness/work-items.json:4551` como `W-PLANNED`, `workItemType PRODUCT`, `taskIds ["ST-CORE-086"]`, `dependsOn ["WI-CORE-078"]`, `storyIds ["HU17"]`, con el alcance antiguo (solo E-01; criterios en `:4569-4570`). `ST-CORE-086` está `T-BACKLOGGED` en `spec/features/008-experimental-comparison/tasks.md:23`. El último ST usado es `ST-CORE-093` (`spec/features/017-cross-repository-dependency-gates/tasks.md:13`, WI-CORE-086).

---

## 1. Esquema CT-01 `spec/contracts/schemas/github-webhook-event.schema.json`

### 1.1 Fuentes comparadas
- Core (receptor/validador): `app/src/github-webhooks/dto/normalized-webhook-event.ts:60-229` (`parseNormalizedWebhookEvent`), invocado solo en `app/src/github-webhooks/github-webhooks.controller.ts:20` tras el guard de bearer.
- Integration (emisor): tipos `app/src/github-webhooks/github-webhook.types.ts:1-51` y normalizador `app/src/github-webhooks/github-webhook-normalizer.ts:18-222`.
- Los tipos TS de ambos son idénticos campo a campo (Core `normalized-webhook-event.ts:5-46` vs Integration `github-webhook.types.ts:1-51`), y coinciden con el bloque `NormalizedWebhookEvent` de `spec/contracts/github-integration-contract.md:232-255`. La prosa de ese contrato (`:228-229`, `:257-263`) es la que el esquema debe volver ejecutable.

### 1.2 Estructura propuesta
Raíz con `$schema` 2020-12 y `$id: https://tjc.local/contracts/github-webhook-event.schema.json` (mismo patrón que `common.schema.json:2-3`). Convención del repo: esquemas solo con `$defs` se envuelven en el generador (`scripts/generate-contract-types.mjs:18-30`) y se validan por `#/$defs/<Nombre>` (`app/src/contracts/contract-validator.ts:24-27`); `error-envelope.schema.json` es el caso de raíz con `type`. Propuesta: `$defs` con `WebhookEventEnvelope` raíz (se valida con `validateContract('github-webhook-event.schema.json', 'GithubWebhookEvent', x)`), más `GitHubWebhookAcceptedResponse`.

`$defs` locales (no reutilizar `common#/$defs/Id`, que es UUID, `common.schema.json:7`):
| Def | Definición | Equivalente en el parser |
|---|---|---|
| `GithubId` | `type string`, `pattern ^[1-9][0-9]*$` (sin `maxLength`, igual que el parser) | `githubId` `normalized-webhook-event.ts:205-207` |
| `NullableGithubId` | `anyOf [GithubId, {type null}]` | `optionalGithubId` `:209-211` |
| `NullableString` | `type ["string","null"]` | `typeof x==='string'`/null (`:111,152-153`) |
| `RepositoryRef` | `{id: GithubId, fullName: string minLength 1}`, `additionalProperties false`, `required` ambos | `:105`, `:178-186` |
| `RefAndSha` | `{ref: string, sha: string}`, exacto | `validRefAndSha` `:188-190` |
| `ReceivedAtDateTime` | `type string`, `format date-time` y `pattern ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z\|[+-]\d{2}:\d{2})$` | `isIsoDateTime` `:213-215` |
| `CreatedAtUtc` | igual con solo `Z` en el patrón; `type ["string","null"]`/`anyOf` con null | `isIsoUtcDateTime` `:217-223` |

Envoltorio (`additionalProperties false`, `required` las 6 claves, igual que `hasExactKeys` `:61`): `schemaVersion {const 1}`, `deliveryId {string, minLength 1, maxLength 255}` (`:67-68`), `eventName {string, minLength 1, maxLength 100}` (`:69-70`), `action {type [string,null], maxLength 100}` (`:71-72`), `receivedAt`, `data`.

### 1.3 `oneOf` por `data.kind` (9 variantes, todas `additionalProperties:false`, `required` = todas sus claves)
| kind | claves (todas obligatorias) | nulabilidad | Parser |
|---|---|---|---|
| `PULL_REQUEST` | `kind, repository, installationId, pullRequestNumber, pullRequest` | `installationId` GithubId\|null; `pullRequestNumber` integer `minimum 1` (`maximum 9007199254740991` por `isSafeInteger`); `pullRequest` = `title:string, draft:boolean, merged:boolean, createdAt:CreatedAtUtc\|null, base:RefAndSha, head:RefAndSha, userLogin:string\|null` (todas obligatorias) | `:101-129` |
| `INSTALLATION` | `kind, installationId, account` | `installationId` GithubId (no nulo); `account` exacto `{id: GithubId\|null, type: string\|null}` | `:130-136` |
| `INSTALLATION_REPOSITORIES` | `kind, installationId, added, removed` | `installationId` GithubId; `added`/`removed` arrays (pueden ser vacíos; sin `maxItems`, sin `uniqueItems`) de `RepositoryRef` | `:137-142`, `:178-186` |
| `REPOSITORY` | `kind, repository, installationId` | `repository` = `{id, fullName, owner}` con `owner` null o `{id: GithubId, login: string\|null, type: string\|null}`; `installationId` GithubId\|null | `:143-157` |
| `MEMBER` | `kind, memberId, repositoryId` | ambos NullableGithubId | `:158-160` |
| `MEMBERSHIP` | `kind, memberId, organizationId` | ambos NullableGithubId | `:161-163` |
| `ORGANIZATION` | `kind, organizationId, organizationLogin, membershipUserId` | ids NullableGithubId, login string\|null | `:164-167` |
| `TEAM` | `kind, repositoryId, organizationId` | NullableGithubId | `:168-170` |
| `IGNORED` | solo `kind` | — | `:171-172` |

### 1.4 Coherencia `eventName` ↔ `kind`: qué expresa el esquema y qué no
Parser: `EVENT_FOR_KIND` (`:48-57`) y comprobación `:81-84` (kind conocido ⇒ `eventName` exacto; `IGNORED` ⇒ `eventName` NO puede ser uno de los 8 conocidos).
- **Expresable en JSON Schema** si el `oneOf` se coloca al nivel del envoltorio (9 sobres, cada uno con `eventName {const: "pull_request"|…}` y `data.kind {const}`) y para `IGNORED` con `eventName: {not: {enum: [8 nombres]}}`. Es decir, no hace falta la brecha si se opta por `oneOf` de 9 sobres en vez de `oneOf` solo sobre `data`. Recomendación: sobres (`WebhookEventPullRequest`, etc.), con campos comunes en un `$defs/WebhookEnvelopeBase` referenciado por `allOf` no es compatible con `additionalProperties:false` (las propiedades de un `allOf` no se ven entre sí): repetir las 6 claves del sobre en cada variante o usar `unevaluatedProperties:false` (Ajv2020 lo soporta; `json-schema-to-typescript` DESCONOCIDO con `unevaluatedProperties`, riesgo para el generador). Opción más segura para el generador: repetir las claves por variante vía `$ref` a defs de cada campo.
- **Solo en el parser (brecha a documentar):** (a) validez de calendario de fechas más allá de lo que hace `format: date-time` de ajv-formats (modo `full` valida días por mes/bisiesto, pero acepta `t`/`z` minúsculas, espacio y offsets sin dos puntos; el `pattern` añadido lo restringe), con un residuo: la hoja `23:59:60` pasa el formato y el parser la rechaza por `Date.parse` (`:214`); (b) `createdAt`: `isIsoUtcDateTime` reconstruye con `toISOString` y compara los primeros 19 caracteres (`:217-223`), lo que solo detecta días imposibles por redondeo de `Date`; el comportamiento exacto de `Date.parse` para `02-30` en V8 no se ejecutó aquí: DESCONOCIDO; (c) `maxLength` cuenta unidades UTF-16 en el parser (`value.length`, `:68,70,72`) y puntos de código en JSON Schema: diferencia solo con caracteres fuera del BMP; (d) el parser reconstruye el objeto copiando campos conocidos (`:86-93`): irrelevante para un esquema; (e) tamaño de body 25 MB (`github-integration-contract.md:226`) es de transporte, no de esquema.

### 1.5 DISCREPANCIAS Integration emite vs Core valida
| # | Aspecto | Integration (emite) | Core (valida) | Efecto / decisión |
|---|---|---|---|---|
| D-A | `action` | `string(rawAction)` sin tope (`github-webhook-normalizer.ts:26-27,181-184`) | ≤100 (`normalized-webhook-event.ts:71-72`) | Un `action` >100 es emitido por Integration y rechazado por Core con `400 INVALID_REQUEST`; Integration lo ve como respuesta no aceptada → `503 CORE_WEBHOOK_UNAVAILABLE` y GitHub reintenta (`github-integration-contract.md:262`; `github-webhook-core-client.ts`). Riesgo práctico bajo (acciones de GitHub son cortas). Esquema: `maxLength 100`; Integration debería validar al emitir (su WI) |
| D-B | `deliveryId` | 1..128, sin caracteres ≤0x20 ni 0x7F (`normalizer:213-215,217-222`) | 1..255, cualquier carácter (`:67-68`) | Integration emite un subconjunto del dominio de Core. Esquema canónico = Core (≤255, sin patrón); Integration es más estricto: compatible |
| D-C | `eventName` | 1..100, sin control/espacio | 1..100 sin más (`:69-70`) | Igual: subconjunto, compatible |
| D-D | cadenas vacías | `title`, `ref`, `sha`, `fullName` vía `requiredString` rechazan `''` (`normalizer:171-174,92,96,100-101`) | `title`, `ref`, `sha` aceptan `''` (`:109,189`); `fullName` exige no vacío (`:105,182`) | Core es más laxo. DECISIÓN DE DISEÑO (no cubierta por la aprobación literal): el esquema canónico puede (1) copiar al parser (sin `minLength` en title/ref/sha) o (2) ser más estricto (`minLength 1`) y exigir ajustar el parser. Recomiendo (1) para no cambiar comportamiento de Core en una ronda documental, y declarar la brecha |
| D-E | `receivedAt` | siempre `toISOString()` (ms, `Z`) (`normalizer:35`) | acepta offsets y cualquier fracción (`:214`) | Core es superconjunto. Esquema = Core; los ejemplos usan la forma real `...000Z` |
| D-F | IDs | entrada número o string; emite siempre string (`normalizer:197-202`) | solo string (`:205-207`) | Coherente |
| D-G | `IGNORED` | cualquier nombre fuera de los 8; los 8 nunca producen `IGNORED` (`normalizer:41-81`) | exige coherencia (`:81-84`) | Coherente |
| D-H | respuesta | Integration exige `accepted===true`, 200⇔`duplicate` y PR (`github-webhook-core-client.ts:57-75`); tipo `accepted: true` (`github-webhook.types.ts:55`) | `accepted: boolean` (`dto/webhook-accepted.response.ts:3`) | Esquema de respuesta: `accepted {const true}`: Core nunca emite `false` en lo revisado? DESCONOCIDO sin leer el servicio; verificar `github-webhooks.service.ts` antes de fijar `const true` o dejar `boolean` |
No se encontró otra deriva (claves, nulabilidad y variantes coinciden). Que Integration no valide lo que emite contra ningún esquema (solo Core valida) es la brecha que el esquema compartido cierra.

### 1.6 Ejemplos propuestos (en `spec/contracts/schemas/examples/`, prefijo `github-webhook-event.`)
Válidos (≥1 por variante; IDs sintéticos, `fullName` neutros tipo `example-org/example-repo`, SHA `0000…`/ficticios, sin identidades de pilotos):
`pull-request.opened`, `pull-request.synchronize`, `pull-request.closed-merged` (`merged:true`), `pull-request.nulls` (`installationId`/`createdAt`/`userLogin` null), `installation`, `installation-repositories` (con `added` y `removed` no vacíos), `repository` (con owner), `repository.no-owner`, `member`, `membership`, `organization`, `team`, `ignored` (p. ej. `eventName: "ping"`), más `accepted-response.202` y `accepted-response.200-duplicate`.
Inválidos (para pruebas, no en el manifest): clave extra en sobre/`data`/`pullRequest`/`repository`; clave ausente (p. ej. sin `action`); `schemaVersion: 2`; `deliveryId: ''` y de 256 caracteres; `eventName` de 101; `action` de 101; id `"0"`, `"01"`, número `123` en vez de string; `pullRequestNumber` `0`, `1.5`, `"7"`; `createdAt` con offset `+01:00`, sin `Z`, `2026-02-30T…`; `receivedAt` `2026-10-24 10:00:00Z` y lowercase `t`; `kind` desconocido; `kind: PULL_REQUEST` con `eventName: "team"`; `kind: IGNORED` con `eventName: "pull_request"`; `data: null`; variante `IGNORED` con claves extra; `added` no array; respuesta aceptada sin `deliveryId`.

### 1.7 Manifest y generador
- `spec/contracts/schemas/examples/manifest.json` (formato `file/schema/definition`, `:4-8`): añadir una entrada por ejemplo válido con `schema: "github-webhook-event.schema.json"`, `definition: "GithubWebhookEvent"` (y `GitHubWebhookAcceptedResponse` para las respuestas). La prueba actual itera el manifest completo (`app/src/contracts/contract-validator.spec.ts:9-16`); solo Core lo lee: ninguna prueba de Integration/Sandbox/Console referencia `manifest.json` (grep; sus specs de contrato son `app/src/error-envelope.contract.spec.ts`, `executions.contract.spec.ts`, `errorEnvelope.contract.test.ts`).
- `scripts/generate-contract-types.mjs:14` toma todo `*.schema.json`; nombre base `GithubWebhookEvent` (`:48`, split por `-`). Genera `contract-schemas.ts` (todo `CONTRACT_SCHEMAS`, `:55`) y `contract-types.ts`. `contracts:check` (`app/package.json:30`) falla si no se regenera (`:62-66`). `contract-validator.ts:18` registra todos los esquemas: el nuevo se incorpora solo (requiere `$id` único).
- **Colisión de nombres:** el archivo `contract-types.ts` concatena todos los esquemas (`:46-54`) y ya contiene sufijos automáticos dentro de una compilación (`EphemeralDownloadRef`, `…1`, `…2`: `contract-types.ts:243,274,324`; `SubscribeAck`, `SubscribeAck1`: `:58,63`), lo que muestra que dos defs con el mismo nombre entre esquemas distintos pueden colisionar. Tipos ya exportados que hay que evitar: `Id, IsoDateTime, RelativePath, Sha256, NonNegativeInteger, ExecutionProfile, TestRunner, ErrorEnvelope, SubscribeAck, AnalysisRunStatus, SubscribePayloads, PullRequestRefResponse, AnalysisSymbolResponse, AnalysisRunDetailResponse, Experiment*Response, Sandbox*, TerminalStatus, ExecutionScope/Phase/InputRole, ArtifactType, EphemeralDownloadRef, ExecutionArtifactInput, CreateSandboxExecutionRequest, TestCaseFact, RunnerFacts, StageDuration, SandboxFailureFact, ExecutionEvidenceFact`. Los nombres propuestos arriba (`Github*`, `Webhook*`) no están en uso. Prueba de no-colisión: `contracts:generate` + `tsc`/`build`, DESCONOCIDO hasta ejecutarlo. Compatibilidad del generador con `not/enum` y `oneOf` anidados: DESCONOCIDO hasta generar (verificar que `json-schema-to-typescript` produce la unión; ya genera uniones para `SubscribeAck`).
- Ajv se instancia con `strict: true, allowUnionTypes: true` (`contract-validator.ts:17`): `strictRequired` exige que todo `required` esté en `properties` del mismo sub-esquema (afecta a cualquier `oneOf` con `required` en el nivel padre); `type: ["string","null"]` está permitido.
- **¿Tipos generados o parser a mano?** Recomendación: mantener `parseNormalizedWebhookEvent` a mano en este corte (reglas no expresables, error uniforme `INVALID_REQUEST` sin valores del payload, reconstrucción del objeto) y NO sustituir `NormalizedWebhookEvent` por el tipo generado en `app/`: cambio de producción sin beneficio y sin aprobación necesaria. Ya existe precedente de uso solo como prueba (`contract-validator` se usa en specs: `sandbox-execution.contract.spec.ts`, `github-integration.client.contract.spec.ts`). Sustituir tipos es un WI aparte opcional.

---

## 2. Pruebas de frontera en Core

Hoy: `app/src/contracts/contract-validator.spec.ts` (Vitest + `validateContract` basado en Ajv2020 + ajv-formats, `contract-validator.ts:1-33`) valida cada ejemplo del `manifest.json` contra su definición (`:11-16`) y varias pruebas negativas por esquema (`:18-87`). Specs de frontera relacionadas: `app/src/sandbox/sandbox-execution.contract.spec.ts`, `app/src/github-app/github-integration.client.contract.spec.ts`, `app/src/common/filters/all-exceptions.filter.contract.spec.ts`. No hay spec unitaria de `parseNormalizedWebhookEvent` (no existe `app/src/github-webhooks/dto/*.spec.ts`); lo ejercita indirectamente `app/src/github-webhooks/github-webhooks.controller.spec.ts` (175 líneas).

A añadir (nuevo archivo propuesto `app/src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts`, más la entrada automática del manifest):
1. **Válidos pasan ambos:** `it.each(ejemplos válidos CT-01)` → `validateContract(...).valid === true` Y `parseNormalizedWebhookEvent(example)` no lanza y devuelve un objeto `toEqual(example)` (round-trip; el parser reconstruye `:86-93`).
2. **Inválidos fallan en ambos:** `it.each(lista de §1.6)` → esquema `valid === false` y parser lanza `AppException` `INVALID_REQUEST` 400.
3. **Paridad esquema↔parser:** tabla de mutaciones (cada ejemplo con una mutación) donde se afirma `schemaValid === parserValid`, con una lista explícita de brechas conocidas (§1.4 y D-D) marcada como `expected divergence` y comentada, para que un cambio futuro de cualquiera de los dos falle la prueba.
4. **Contrato con CT-01-A1/A5:** el mismo ejemplo canónico PR `opened` entra por `POST internal/v1/github/webhook-events` con bearer válido (patrón del controller spec) y llega a `githubWebhooksService.handle` con el mismo evento (A1 parcial; la creación real de Run queda en `analysis-runs.service.spec.ts`).
Casos mínimos: 1 válido por kind (9) + 1 válido con nulos + 8 inválidos representativos (clave extra, ausente, versión, id, número PR, fecha, kind↔eventName, kind desconocido) + 2 de paridad con brecha. Tamaño: S–M (≈ 120-200 líneas de prueba, solo en `app/src/**/*.spec.ts`, sin código de producto). Es trabajo en `app/`: delegar a `implementer` (no es cambio «mínimo» de ≤10 líneas).

---

## 3. E-01

Ubicación exacta: `spec/contracts/interoperability-contract.md:359-367` (`interface ExperimentResultsResponse`): hoy `:361 analysisRunId: Id` y `:363 symbol: AnalysisSymbolResponse`. El DTO real: `app/src/experiments/dto/experiment.response.ts:120-128` emite `experimentId, projectVersionId, targetId, repetitionsPerStrategy, strategies, repetitions, completedAt`. Referencias de apoyo: ruta en `:276`; nota modelo ya existente para `ExperimentStatusResponse` en `:316` (INTEROP-2.18) y `targetId` en `:306`.

Texto corregido propuesto (misma convención que `:316`):
```ts
interface ExperimentResultsResponse {
  experimentId: Id
  projectVersionId: Id
  targetId: Id // `TestTarget` del experimento (emitido por Core hoy)
  repetitionsPerStrategy: 3
  strategies: StrategyMetricsResponse[]
  repetitions: ExperimentRepetitionResponse[]
  completedAt: IsoDateTime
}
// Nota (INTEROP-2.20, alineación con el servidor): `analysisRunId` y `symbol` (`AnalysisSymbolResponse`) figuraban en esta interfaz por el diseño de HU17, pero `GET /experiments/{id}/results` NO los emite; Core emite `targetId`. Siguen definidos por HU17, pendientes de implementación y opcionales (`analysisRunId?: Id`, `symbol?: AnalysisSymbolResponse`); los consumidores no deben depender de ellos hasta que un WI los implemente.
```
Esquema/ejemplo afectado: NINGUNO (`grep ExperimentResultsResponse spec/contracts/schemas` sin resultados; solo `realtime-events.schema.json` define `ExperimentStatusResponse`, `:135`). Archivos fuera de contratos que repiten la forma: no encontrados en `spec/` aparte de `:359`. El DTO no cambia: documental, `breaking:false`.

---

## 4. SYSTEM-2.15 y menciones de pilotos antiguos

Grep (`tjc-piloto`, `piloto-ventas`, `piloto-reservas`, `piloto-suscripciones`, y complementarios `ventas|reservas|suscripciones`, `PR #3`) sobre `spec/`, `CHANGELOG.md`, `app/src`, `app/test`:
| Archivo:línea | Qué es | Acción |
|---|---|---|
| `spec/contracts/system-contract.md:287` | **ÚNICA mención de piloto antiguo en los tres contratos** («…E2E de producción verificado por Cross: PR #3 de `tjc-piloto-ventas` → Check `success` con 1 propuesta…») | SYSTEM-2.15 (contrato) |
| `spec/contracts/interoperability-contract.md`, `github-integration-contract.md` | sin `tjc-piloto*` ni `piloto-*` (las coincidencias de `suscripciones` son WebSocket, no pilotos: p. ej. `interoperability-contract.md:465,467,468,1081`) | ninguna |
| `spec/features/019-project-root-detection/spec.md:27,35` y `plan.md:20` | `sistema-ventas-dn`, `validacion-cursos/ventas/certificados`: insumos de validación del handoff de detección de `projectRoot`, NO los pilotos antiguos del experimento | otra spec; fuera de esta ronda (no contrato); el usuario decide si se despersonalizan (marcarlo, no incluirlo) |
| `CHANGELOG.md` | sin `tjc-piloto*` (grep vacío) | ninguna |
Así que el alcance de contrato de SYSTEM-2.15 es una sola frase en `system-contract.md:287`; WI-CORE-084 ya despersonalizó `spec/features/008-experimental-comparison/spec.md` (`CHANGELOG.md` Unreleased, primera entrada).

Texto neutral propuesto para `:287` (sin identidades ni número de PR): «Core en Render usa `SANDBOX_URL=https://<SANDBOX_HOST>.sslip.io`. Cross verificó un E2E de producción con un repositorio de prueba: un PR produjo un Check `success` con 1 propuesta (Render → VM por HTTPS).» Esto conserva el hecho que sustenta el bloque de riesgo (`:289`) sin nombrar el repo. Variante aún más corta, si el contrato debe ser atemporal: eliminar la frase de E2E (el hecho «verificado por Cross» es histórico y no normativo). Decisión editorial del leader, no de contrato.

Además SYSTEM-2.15 cambia la cabecera `system-contract.md:3-4` (versión y fecha) y añade el párrafo de «Regla de compatibilidad» (`:489` es el de SYSTEM-2.14: hoy el párrafo SYSTEM-2.14 afirma que los espejos «siguen en SYSTEM-2.13 hasta su homologación»; reescribir con 2.15 en cabeza).

---

## 5. `sandbox-result.failed.json` / `COMPOSER_INSTALL_FAILED`

Apariciones (grep sobre los 4 repos, excluyendo `node_modules`):
- Espejos idénticos del ejemplo, línea 11, en: `tjc-be-rag-core-api/spec/contracts/schemas/examples/sandbox-result.failed.json` (canónico), `tjc-be-github-integration-api/…`, `tjc-be-test-execution-sandbox/…`, `tjc-fe-rag-developer-console/…` (mismas rutas).
- Otras en Core: solo reportes de harness (`harness/reports/arch-v1.0-aserciones-ct-propuesta.md:168`, `arch-v1.0-impacto-pilotos-core.md:72,154,168`, `wi-core-085-closure.md:9`, `wi-core-085-independent-review.md:14,44`). Ninguna en código, pruebas ni specs de los 4 repos (grep sobre `app/` y `spec/` sin otros resultados).
Categoría real: `app/src/common/errors/sandbox-fact-error.ts:85-89` del Sandbox: `DependencyInstallFailedError` → `super('DEPENDENCY_INSTALL_FAILED', 'DEPENDENCY', message)`. El ejemplo ya lleva `category: "DEPENDENCY"` correcta (`failed.json:10`); lo erróneo es solo `code` (`:11`). El esquema declara `category` enum cerrado y `code` string libre (`sandbox-execution.schema.json:124-127`), por eso la prueba de manifest no lo detecta.
Qué corrige Core: `spec/contracts/schemas/examples/sandbox-result.failed.json:11` → `"code": "DEPENDENCY_INSTALL_FAILED"`. El `message` (`:12`, «composer install terminó con código 2») es coherente y no cambia. La prueba `app/src/sandbox/sandbox-execution.contract.spec.ts:60-67` compara `outcome.failure` con `example.failure` leído del ejemplo (no hardcodea el código): no requiere cambio; sigue verde. Docs: la prosa de INTEROP lista los códigos de fallo en §7 (`interoperability-contract.md:1562` en adelante; no se verificó que `COMPOSER_INSTALL_FAILED` figure ahí: el grep no lo encontró, así que no hay prosa que corregir). Qué corrigen los espejos: re-copia byte a byte del árbol `schemas/` en Integration, Sandbox y Console; sin cambio de código salvo regenerar `generated/` (`contract-schemas.ts` embebe todos los esquemas, no los ejemplos; el ejemplo no está en `generated`, por lo que corregir el ejemplo por sí solo no cambia `generated/`; sí lo cambia el nuevo `.schema.json`).

---

## 6. Versionado

Dónde viven hoy:
| Cadena | Lugares (archivo:línea) |
|---|---|
| `INTEROP-2.19` | `spec/contracts/interoperability-contract.md:3` (versión), `:14` (bullet de versión vigente y resumen de 2.18), `:7`/`Fecha de corte` en `:5`; `spec/contracts/system-contract.md:489` («`INTEROP-2.19` es la versión compatible»); `spec/README.md:5`; `CHANGELOG.md:18` (WI-CORE-076); `harness/state.json:19940,19965` y `harness/contract-sync/outbox/CS-CORE-20261021-004.yaml` (históricos: no se reescriben); `app/src` solo en comentarios históricos (INTEROP-2.14/2.15/2.7/2.17/2.18 en specs/códigos; `github-integration.client.contract.spec.ts:7` cita INTEROP-2.17/GH-INTEROP-1.8: comentario, no cadena validada). Ninguna prueba compara la cadena de versión (grep en `app/src`/`app/test`: solo comentarios; el generador no la lee). |
| `GH-INTEROP-1.8` | `spec/contracts/github-integration-contract.md:1` (título) y `:3` («Estado:»); `spec/contracts/interoperability-contract.md:9` (prosa); `spec/README.md:5`; `harness/work-items.json:3968,3990`, `harness/state.json:18129` (históricos); `CHANGELOG.md:22` |
| `SYSTEM-2.14` | `spec/contracts/system-contract.md:3` y `:489`; `spec/contracts/interoperability-contract.md:4` («Compatible con»); `spec/README.md:5,36` (cita genérica «SYSTEM-*» en `:36`); `CHANGELOG.md:18` |
No hay `INTEROP-2.19` etc. en `spec/features/*` ni en `harness/validate-*.mjs` (el único coincidente en harness son comentarios de WI/estado). `spec/constitution/delivery-workflow.md` no contiene cadenas de versión (no leído en detalle: DESCONOCIDO si cita alguna; el grep de versiones no lo listó).

Qué cambia:
- **INTEROP-2.20**: `:3` versión; `:4` «Compatible con: SYSTEM-2.15»; `:5` fecha 2026-10-24; `:9` `GH-INTEROP-1.9`; `:14` nuevo primer bullet «`INTEROP-2.20` es la versión documental vigente (`WI-CORE-079`, …)» conservando el resumen de 2.19/2.18 detrás; §6.5 (E-01, §3); §6.9 `:698-700` (hoy remite a «`GH-INTEROP-1.5`… §Webhooks», referencia obsoleta: actualizar a `GH-INTEROP-1.9` y al esquema canónico); mención del esquema en §10 si el contrato enumera esquemas (no verificado: DESCONOCIDO, revisar «§10» de INTEROP donde se describe la validación por esquemas).
- **GH-INTEROP-1.9**: título `:1`, nuevo párrafo en `:3` («Estado:») delante del de 1.8; en la sección Webhooks (`github-integration-contract.md:228-263`): citar `spec/contracts/schemas/github-webhook-event.schema.json` como forma canónica ejecutable del payload y los ejemplos `github-webhook-event.*`, dejando el bloque TS como ilustración; documentar D-A (límite de `action`) y la regla eventName↔kind.
- **SYSTEM-2.15**: `:3`, `:4`, nuevo párrafo en `:489`, línea de `:287`; «Compatible con» de INTEROP.
- `spec/README.md:5` a SYSTEM-2.15 / INTEROP-2.20 / GH-INTEROP-1.9.
- `CHANGELOG.md` (sección `[Unreleased]`, entrada nueva arriba del bullet WI-CORE-084 `:6`), formato de WI-CORE-076: «**WI-CORE-079 — … (fecha, alcance aprobado por el usuario 2026-10-24; INTEROP-2.20, GH-INTEROP-1.9 y SYSTEM-2.15, documentales):** …», con los cuatro cambios y la frase «Los espejos anteriores (…) quedan desfasados: re-espejar byte a byte desde Core».
¿Breaking? **No**, `breaking: false` en los tres: (1) esquema CT-01: no cambia el wire; describe lo que Core ya valida y Integration ya emite (salvo D-A, que es un caso raro ya rechazado hoy); (2) E-01: documenta lo emitido, DTO sin cambio; (3) SYSTEM-2.15: texto histórico; (4) ejemplo: corrige un valor ilustrativo de `code` abierto (`string` libre), sin cambio del esquema. Riesgo de consumidor: el árbol `schemas/` cambia (archivo nuevo y ejemplos), por lo que `contracts:check` falla en los 3 espejos hasta regenerar `generated/`; eso es acción, no ruptura. Aditivo, no «solo documental»: el comentario «sin cambio de código» de eventos anteriores (`CS-CORE-20261021-003/004`) NO se puede repetir aquí para los espejos (cambian sus `generated/*.ts`).

---

## 7. Contract Sync

Evidencia previa: `CS-CORE-20261021-001/002/003` (WI-CORE-074) fueron **tres eventos, uno por consumidor** (console `-001`, github-integration `-002`, sandbox `-003`), cada uno con `scopePaths` idénticos de 4 entradas; `-003` (Sandbox) incluyó por error `github-integration-contract.md` (E-02: Sandbox no espeja ese archivo, `README`/`errata-pendientes-interop.md:E-02`); `CS-CORE-20261021-004` (WI-CORE-076) usó **un evento** con `targets: [console, github-integration, sandbox]` y `scopePaths` solo de los dos contratos cambiados. Formato en `harness/contract-sync/README.md` (`type, id, source, sourceWorkItem, targets, scopePaths, breaking, changed, requiredAction, sourceRevision, status`). `import`/`check` exigen namespace=source y `sourceWorkItem` del componente emisor.

Propuesta (decisión del leader, no requiere aprobación nueva): **tres eventos por consumidor**, para que cada `scopePaths` sea exacto y cada `requiredAction` sea específica; el ID del prompt (`CS-CORE-20261024-001`) quedaría para Integration:
| Evento | targets | scopePaths | requiredAction (resumen) |
|---|---|---|---|
| `CS-CORE-20261024-001` | `[github-integration]` | `interoperability-contract.md`, `github-integration-contract.md`, `system-contract.md`, `schemas` | re-espejar los tres contratos y `schemas/` (con `manifest.json`) byte a byte; ejecutar `contracts:generate`+`contracts:check`; **WI propio**: validar lo que emite `normalizeGithubWebhook` y los 9+ ejemplos contra el esquema (cierra CT-01-A5 en su mitad); atender D-A (tope de `action`) |
| `CS-CORE-20261024-002` | `[sandbox]` | `interoperability-contract.md`, `system-contract.md`, `schemas` (SIN `github-integration-contract.md`, corrige E-02 y deja de repetirlo) | re-espejar y `contracts:generate`+`check`; sin cambio de lógica; no usa el esquema nuevo; el ejemplo `sandbox-result.failed.json` corregido es el que cubre su contrato |
| `CS-CORE-20261024-003` | `[console]` | los 4 | re-espejar los tres contratos y `schemas/`; `contracts:generate`+`check`; sin cambio de UI; (E-01: Console consume `ExperimentResultsResponse`: verificar que ya usa `targetId`, DESCONOCIDO, no se revisó su cliente) |
Alternativa: un solo evento con `targets` de los tres y `scopePaths` como unión, anotando en `requiredAction` que Sandbox omite `github-integration-contract.md`; es lo que hizo `-004`. La ventaja de tres eventos es que `scopePaths` por consumidor es exacto y el ACK de cada repo apunta a su propio WI. Ambos son válidos con el validador actual; DESCONOCIDO si algún consumidor valida que `scopePaths` esté espejado (no se leyó su `contract-sync.mjs`).
`breaking: false`. `changed`: una línea por cambio con los sha256 finales (§ siguiente). `sourceRevision`: SHA completo del commit de Core que contiene los contratos finales (debe existir en el historial y no reescribirse, `README.md` último párrafo). `status: C-PENDING`, sin campos de evidencia local.
Cómo se calcula el sha256 (receta ya usada en `CS-CORE-20261021-003/004`): archivos `shasum -a 256 spec/contracts/<archivo>.md`; árbol: `cd spec/contracts/schemas && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`. Digests actuales (verificados hoy, antes de editar): interoperability `f9866d16…cc6f9`, system `f60d6c4b…96ce3`, github-integration `6c553ee8…5565a`, schemas `a1ba9a19…c9091` (coinciden con `CS-CORE-20261021-004`). Todos cambiarán.
Orden: (1) editar contratos, esquema, ejemplos, manifest; (2) `contracts:generate` y pruebas; (3) revisión independiente y `contract-reviewer`; (4) commit; (5) recalcular digests sobre el árbol commiteado (si un commit de corrección cambia un archivo, recalcular y no reescribir historia); (6) `contract-sync.mjs publish` con `--source-revision` del HEAD final; (7) cross entrega a los repos. El gate `before-done` exige que los eventos relevantes para Core estén resueltos; los eventos publicados por Core son entregados a los consumidores y no los resuelve Core.

---

## 8. Desglose del WI

Registro: **reactivar `WI-CORE-079`** (`W-PLANNED`, ya en `harness/work-items.json:4551`) ampliando alcance y criterios (es PRODUCT con `contractImpact`/`publishesContract` ya `true`), no crear uno nuevo; `dependsOn` hoy `WI-CORE-078` (cerrado) y debería añadir `WI-CORE-086` (documental, en curso). Reemplazar `harness/reports/wi-core-079-scope.md` por la decisión del usuario del 2026-10-24 (la sección «DECISIÓN DEL USUARIO (2026-10-21)… no se ejecuta» queda superada). Líneas: `storyIds ["HU15","HU17"]` (HU15 trazabilidad; CT-01 del tag `arch-v1.0`).

ST propuestos (nueva numeración; el próximo libre es `ST-CORE-094`):
- `ST-CORE-086` (existente, 008, `T-BACKLOGGED`): E-01 en INTEROP §6.5 (retitular y activar).
- `ST-CORE-094` · HU15, HU17: esquema `github-webhook-event.schema.json`, ejemplos válidos, manifest y regeneración de `generated/`; GH-INTEROP-1.9.
- `ST-CORE-095` · HU15, HU17: pruebas de frontera CT-01 (§2) en `app/`.
- `ST-CORE-096` · HU17: SYSTEM-2.15 (texto neutral de `:287`) y corrección de `sandbox-result.failed.json`; cabeceras de versión, README, CHANGELOG.
- `ST-CORE-097` · HU15, HU17: Contract Sync a Integration, Sandbox y Console (publicación).
Ubicación del `tasks.md`: `ST-CORE-094/095/097` en `spec/features/017-cross-repository-dependency-gates/tasks.md` (donde ya están 087-093) o en `016-github-integration` (DESCONOCIDO cuál prefiere el leader; el patrón vigente de CT/C-xx es 017).

Criterios de aceptación:
1. `github-webhook-event.schema.json` valida los ejemplos válidos y rechaza los inválidos; los ejemplos válidos pasan también `parseNormalizedWebhookEvent` (round-trip) y los inválidos fallan en ambos; la paridad documentada con la lista de brechas (§1.4, D-D).
2. `npm run contracts:generate` y `contracts:check` limpios; lint, test, build verdes; sin colisión de tipos generados.
3. E-01 en §6.5 refleja `targetId`; DTO sin cambio.
4. `system-contract.md:287` sin identidades de pilotos; grep de `tjc-piloto`/`piloto-ventas` en `spec/contracts` vacío.
5. `sandbox-result.failed.json` con `code: DEPENDENCY_INSTALL_FAILED`; `sandbox-execution.contract.spec.ts` verde.
6. Versiones coherentes en `interoperability-contract.md:3-5,9,14`, `system-contract.md:3-4,287,489`, `github-integration-contract.md:1,3`, `spec/README.md:5`, `CHANGELOG.md`.
7. Digests finales en los eventos; eventos `C-PENDING` publicados; `reviewer` y `contract-reviewer` independientes aprueban el rango; el usuario no necesita aprobar de nuevo salvo los puntos marcados.

Partes: **documental** (contratos, esquema, ejemplos, manifest, README, CHANGELOG, Contract Sync): leader/sdd-analyst o implementer con carril documental. **`app/`**: `app/src/contracts/generated/*` (salida del generador: sigue siendo cambio generado, ejecutar `contracts:generate`) y la spec nueva `app/src/github-webhooks/dto/normalized-webhook-event.contract.spec.ts`. Todo cambio en `app/` que no sea mínimo se delega a `implementer`; la spec de §2 (≈120-200 líneas) no es mínima → `implementer` (esfuerzo bajo; `implementer-high` solo si la paridad se complica con el generador). No tocar `normalized-webhook-event.ts` en este corte.
`contract-reviewer` requerido (contratos, esquemas, `contractImpact:true`, Contract Sync): revisar productor/consumidor, D-A…D-H, digests y `scopePaths` por consumidor. `reviewer` independiente además (el implementer no se autoaprueba). Merge reviewer no aplica.

Riesgos: (1) esquema más estricto/laxo que el parser (mitigación: paridad de §2); (2) `json-schema-to-typescript` con `oneOf`/`not`/`unevaluatedProperties` (DESCONOCIDO hasta generar; fallback: sobre único + `oneOf` solo en `data` y documentar brecha eventName↔kind); (3) `contracts:check` roto en 3 repos hasta que re-espejen (acción por consumidor); (4) deriva D-A/D-D no resuelta en Integration; (5) `INTEROP-2.19` vigente espejado hoy en consumidores aún no reconciliado: verificar que los eventos `CS-CORE-20261021-003/004` estén resueltos por los 3 consumidores antes de publicar 2.20 (estado de sus `inbox`/outbox: DESCONOCIDO, solo leí el outbox de Core); (6) commit con `sourceRevision` reescrito invalida eventos.

Puntos que requieren aprobación del usuario NO cubiertos por la decisión literal:
| # | Punto | ¿Cubierto? |
|---|---|---|
| A-1 | Decidir D-D: esquema = parser (sin `minLength` en title/ref/sha) o más estricto con cambio de parser en Core (cambio de comportamiento de producción) | **NO cubierto** si se opta por estricto; con «igual al parser» no hace falta |
| A-2 | Incluir la tolerancia/tope de `action` (D-A) como obligación de Integration (`requiredAction` de Contract Sync): es un cambio de comportamiento de otro repo | Marcar; la decisión pide «esquema canónico», no que Integration valide al emitir. Para no ampliar alcance, dejarlo como `requiredAction` informativa, no obligatoria |
| A-3 | Sustituir los tipos manuales de Core por los generados (§1.7) | NO cubierto; recomendado NO hacerlo ahora |
| A-4 | Despersonalizar las menciones de `sistema-ventas-dn`/`validacion-*` de `spec/features/019-project-root-detection` (no son contrato) | NO cubierto; fuera de alcance salvo que el usuario lo pida |
| A-5 | Un evento Contract Sync por consumidor vs un evento único | Decisión de proceso del leader/cross; no es aprobación de usuario, pero cambia el ID citado en el prompt |
| A-6 | Texto exacto de §4 (E2E sin identidades) y E-01 (§3) | Cubierto por la decisión literal (errata/«SYSTEM-2.15 tjc-piloto-ventas»); la redacción exacta la revisa `contract-reviewer` |
Si cualquiera de los 5 primeros se resuelve con la opción recomendada («igual al parser», «informativa», «no sustituir», «no tocar 019», «tres eventos»), la ronda queda dentro de lo aprobado.

Orden recomendado: (1) aprobación del leader de reactivar `WI-CORE-079` (actualizar registro, `harness/state.json`, `tasks.md`) tras cerrar `WI-CORE-086`; (2) esquema + ejemplos + manifest + E-01 + `failed.json` + SYSTEM-2.15 + cabeceras/CHANGELOG/README (documental); (3) `implementer`: `contracts:generate`, spec de §2, lint/test/build; (4) `reviewer` + `contract-reviewer`; (5) commit; (6) recalcular digests y `contract-sync publish`; (7) cross entrega a Integration (WI propio que valida lo emitido y los ejemplos), Sandbox y Console (re-espejo + `contracts:check`).

Evidencia (rutas leídas): `app/src/github-webhooks/dto/normalized-webhook-event.ts`, `.../github-webhooks.controller.ts`, `.../dto/webhook-accepted.response.ts`; `app/src/contracts/contract-validator.ts`, `.spec.ts`, `generated/contract-types.ts`; `app/scripts/generate-contract-types.mjs`; `spec/contracts/{interoperability,system,github-integration}-contract.md`; `spec/contracts/schemas/{common,error-envelope,realtime-events,sandbox-execution}.schema.json`, `examples/manifest.json`, `examples/sandbox-result.failed.json`; `harness/contract-sync/README.md`, `outbox/CS-CORE-20261021-001..004.yaml`; `harness/reports/{arch-v1.0-impacto-pilotos-core,arch-v1.0-aserciones-ct-propuesta,errata-pendientes-interop,wi-core-079-scope}.md`; Integration `app/src/github-webhooks/{github-webhook.types,github-webhook-normalizer,github-webhook-core-client}.ts`, `app/src/github/github-date-time.ts`; Sandbox `app/src/common/errors/sandbox-fact-error.ts`.
