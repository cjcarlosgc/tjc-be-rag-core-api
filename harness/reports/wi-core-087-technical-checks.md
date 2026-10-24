# WI-CORE-087 — verificaciones técnicas
Modelo: implementer · configurado claude-sonnet-5-5 · atendido claude-haiku-5-5 · esfuerzo low

Ejecutado desde `app/` con `PATH=/Users/cjcarlosgc/.local/node22/bin:$PATH`.

| Comando | Resultado |
|---|---|
| `npx vitest run src/github-app/github-access-http.adapter.spec.ts` | 27 pasan (antes de formatear) |
| `npx prettier --write` sobre los dos archivos permitidos, luego `--check` | Todo conforme |
| `npx vitest run src/github-app/` | 7 archivos, 67 pruebas pasan |
| `npm run lint` (oxlint) | Exit 0 |
| `npm test` | 158 archivos pasan, 7 omitidos; 2735 pruebas pasan, 104 omitidas (línea base 2726 pasan, 104 omitidas; +9 pruebas nuevas) |
| `npm run build` (nest build) | Exit 0 |
| `git status --short` / `git diff --stat` | Cambios propios: `app/src/github-app/github-access-http.adapter.ts` (+150/-18 aprox.) y `app/src/github-app/github-access-http.adapter.spec.ts` (+182). Sin cambios en otros archivos del WI. |

Nota: `harness/reports/wi-core-087-indicacion-integration.md` aparece como no rastreado; no lo creó este implementer, no se ha tocado.

Verificación de no fuga: el test «never leaks request identifiers or raw error text» comprueba que los avisos no contienen installationId, repositoryName, organizationLogin, githubUserId ni el texto crudo del error. El test de error inesperado comprueba que no aparece el mensaje con el secreto falso.

Cambios de comportamiento: ninguno en resultados devueltos. Los métodos públicos, timeouts y reintentos no se tocaron. `toGithubLookup` devuelve además un motivo interno (no exportado) para distinguir INTEGRATION_UNVERIFIABLE de RESPUESTA_NO_RECONOCIDA.

## Re-ejecución del leader (2026-10-24)

Desde `app/` con Node 22: `npm run lint` (exit 0), `npm run build` (exit 0) y `npm test`: 158 archivos pasan y 7 omitidos; 2735 tests pasan y 104 omitidos (2726 previos + 9 nuevos). El spec del adaptador corre solo con 27 pruebas verdes y sin trazas; las trazas de error que aparecen en la salida del suite completo vienen de pruebas de `AllExceptionsFilter` ajenas a este cambio. `git status` solo muestra `github-access-http.adapter.ts`, su spec y los informes del WI; cliente, resolver, contratos, esquemas y DTO sin cambios.
