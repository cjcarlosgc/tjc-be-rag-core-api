# WI-CORE-087 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (sin hallazgos bloqueantes; 2 observaciones menores no bloqueantes).

## 1. No fuga de datos
- Única plantilla de log: `avisar` (`github-access-http.adapter.ts:220-224`). Interpola solo `path` (cadena literal fija en cada llamador: `/organizations/installations`, `/organizations/owners`, o la ruta literal pasada a `lookup`), `motivo`, `estatus`, `reintentable`, `duracion`. `request` y `respuesta` nunca llegan a `avisar` (no están en `DetalleAviso`/`Consulta`).
- `motivo`: constantes (`RESPUESTA_NO_RECONOCIDA`, `INTEGRATION_UNVERIFIABLE`, `LISTA_DE_OWNERS_VACIA`), `INSTALACIONES_${status}_COMO_UNVERIFIABLE` (:89; solo se alcanza si status es NOT_FOUND o NOT_INSTALLED, tipo cerrado), `ERROR_CLIENTE:${error.code}` (:191) y `ERROR_INESPERADO:${error.name}` (:204).
- `error.code`: `GithubIntegrationClientError.code` es un union cerrado; en el cliente solo se construye con literales o con `envelope.code` tras `Object.hasOwn(CONTRACT_ERRORS, …)` (`github-integration.client.ts:246`), por lo que un cuerpo remoto no puede inyectar texto. `error.status` es `response.status` numérico o literal; `retryable` boolean.
- `value.status` de la respuesta de Integration NO se interpola (el motivo es constante en cada rama de `toGithubLookup`). `error.message` no se usa.
- Intento de inyección: Integration devolviendo `status` con saltos de línea o texto -> cae en `default` -> `RESPUESTA_NO_RECONOCIDA` fijo. Cuerpo de error con `code` arbitrario -> descartado por la lista. Sin vector encontrado, salvo O-1.
- Pruebas negativas con identificadores y mensaje crudo existen y fallan al mutar (ver 4).

## 2. Resultados sin cambio
Comparado con `HEAD`: `toGithubLookup` conserva el mismo mapeo (no objeto -> UNVERIFIABLE; NOT_FOUND/NOT_INSTALLED pasan; UNVERIFIABLE -> UNVERIFIABLE; OK válido -> OK; OK inválido/otro -> UNVERIFIABLE). `consultar` mantiene la llamada a `post` y la clasificación dentro del mismo `try` (un `isValue` que lance sigue capturándose), catch -> UNVERIFIABLE. Instalaciones (NOT_FOUND/NOT_INSTALLED -> UNVERIFIABLE) y owners (OK vacío -> UNVERIFIABLE) intactos; los demás métodos siguen devolviendo NOT_FOUND/NOT_INSTALLED sin registrar. Cliente, resolver, timeouts y reintentos sin tocar (`git diff --name-only`). Salvedad teórica: si `Logger.warn` lanzara, ahora propagaría (antes no existía); irrelevante en la práctica.

## 3. Cobertura de motivos y duplicados
Los 5 caminos registran exactamente un aviso: error del cliente con estatus y sin estatus (:191), inesperado por nombre (:204), INTEGRATION_UNVERIFIABLE vs RESPUESTA_NO_RECONOCIDA, instalaciones NOT_FOUND/NOT_INSTALLED (:89), owners vacío (:135). Sin duplicados: `registrarFallo` solo avisa si `consulta.fallo` existe, y los casos NOT_FOUND/NOT_INSTALLED/OK vacío no generan `fallo`, así que el aviso propio y el de `consultar` son mutuamente excluyentes (mutación M4 lo confirma). Sin avisos en resultados legítimos.

## 4. Pruebas y mutaciones (copia en el directorio temporal del scratchpad, árbol intacto)
Base: 27 pruebas pasan. Mutaciones, todas detectadas:
| # | Mutación | Resultado |
|---|---|---|
| M1 | `error.message` en el motivo de ERROR_INESPERADO | 2 pruebas fallan |
| M2 | instalaciones devuelve NOT_FOUND en vez de UNVERIFIABLE | 2 fallan |
| M3 | `value.status` de la respuesta interpolado en el estatus | 1 falla |
| M4 | aviso duplicado en owners | 2 fallan |
| M5 | `installationId` interpolado en el motivo de owners | 2 fallan |
| M6 | NOT_FOUND genera motivo (aviso espurio) | 3 fallan |
No hay pruebas vacuosas observadas. Limitación: M3 solo la detecta la prueba de INTEGRATION_UNVERIFIABLE, no la de fuga; aceptable.

## 5. Gates (re-ejecutados)
`npm run lint` OK · `npm run build` OK · `npm test`: 158 archivos pasan, 2735 pasan, 104 omitidos (7 archivos omitidos) · `sdd-check` OK · `validate-work-items` OK (87 WI) · `validate-harness` OK · `validate-completions` OK (84 completados).

## 6. Alcance
`git status`: solo `github-access-http.adapter.ts` y su spec en `app/`, más `harness/state.json`, `harness/work-items.json` e informes del WI. Sin contratos, esquemas, DTO, otros repos ni `referencias/`.

## 7. Volumen de logs
Un WARN por llamada fallida; en `ACCESS_REVERIFY` pueden ser unas pocas docenas por barrido (7 accesos + listado). No hay bucle: el adaptador no reintenta ni se invoca desde su propio log. Volumen razonable; el aviso del resolver es complementario (distinto texto). No bloqueante.

## Observaciones no bloqueantes
- O-1 (baja, `github-access-http.adapter.ts:204`): `error.name` de un error arbitrario es texto libre (p. ej. un `Error` con `name` modificado). Riesgo práctico nulo (errores nativos: TypeError, AbortError, etc.). Opcional: limitar a `/^[A-Za-z0-9_]{1,40}$/` o caer a `desconocido`.
- O-2 (baja, spec): la prueba de fuga no cubre el camino ERROR_CLIENTE con `status`/`code` ni `INTEGRATION_UNVERIFIABLE`; sin riesgo real por el tipado cerrado, pero podría añadirse.
