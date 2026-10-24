# WI-CORE-091 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (sin hallazgos bloqueantes; 2 observaciones informativas).

## 1. Alcance
- `git diff --stat`: `CHANGELOG.md` (+1), `app/package.json` (+1/-1), `harness/state.json` y `harness/work-items.json` (registro del WI por el leader) e informes untracked del WI. Sin cambios en `app/pnpm-lock.yaml`, `pnpm-workspace.yaml`, esquema Prisma, `prisma.config.ts`, `.github/`, contratos ni `.env`.
- `app/package.json:10`: único cambio, `"build": "nest build"` -> `"build": "prisma generate && nest build"`. `postinstall` (línea 23) y `prisma:generate` (línea 24) intactos.

## 2. Causa y arreglo
- `.gitignore:4` ignora `app/src/generated/`; el cliente solo lo produce `prisma generate` (`postinstall`, `package.json:23`).
- Logs de build de Render (servicio srv-dajf8ovqj5pc73ddbvtg, 2026-10-24 17:45-17:46Z): restaura caché de 421 MiB, `pnpm install --frozen-lockfile` termina en 49 ms (sin postinstall), luego `pnpm run build` falla con TS2307 `../generated/prisma/client.js` y TS2339 en `PrismaService`. Coincide con la causa descrita. Comando de build de Render: `pnpm install --frozen-lockfile && pnpm run build`; el script nuevo corre `prisma generate` dentro de `run build`, así que el caso del install sin cambios queda resuelto.
- `prisma.config.ts:11` usa `env('DATABASE_URL')`: `prisma generate` FALLA si la variable no existe (verificado en copia sin `.env`: `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`). No es regresión: el `postinstall` ya tenía la misma exigencia, y Render debe tenerla (el install completo del 22-oct pasó `postinstall`).
- CI (`.github/workflows/ci.yml`): `DATABASE_URL` ficticio a nivel de job `app` (línea ~38) cubre `pnpm build`. Los jobs `sdd` (sin build) y `postgres` (sin build; define `DATABASE_URL`) no ejecutan `build`. Sin Dockerfile ni `render.yaml` en el repo. Ningún script depende de `build` (no hay `prebuild`; `start:prod` usa `dist/main`; `lint:types`, `test`, `start:dev` no llaman a `build`).

## 3. Prueba del escenario (copia en scratchpad, fuera del repo; borrada)
- Sin `src/generated/` ni `dist/`: `nest build` directo falla con 51 TS2307 (reproduce Render).
- Con el script nuevo: `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public npm run build` regenera el cliente (`Generated Prisma Client (7.10.0) to ./src/generated/prisma`) y compila; `src/generated/prisma` y `dist/` quedan presentes.
- Entorno vacío (`env -i`) también compila, pero la copia contenía `.env` (gitignored, no leído), así que ese caso no prueba la ausencia de variable; la ausencia se probó aparte con `prisma generate` sin `.env` (falla, ver sección 2).

## 4. CHANGELOG
Entrada WI-CORE-091 en `CHANGELOG.md:15`, justo encima de WI-CORE-089, un solo párrafo, mismo formato (negrita, fecha, alcance). Afirmaciones (318 errores, deploys `c7502e50` y `a1f32475`, `app/src/generated/` ignorado, `postinstall` conservado) coherentes con el informe de alcance y con los logs vistos; los IDs de deploy y el 318 no los re-verifiqué uno a uno (los logs consultados confirman el fallo TS2307, no el recuento).

## 5. Re-ejecución (Node 22.23.3)
| Comando | Resultado |
|---|---|
| `npm run lint` (app) | exit 0 |
| `npm test` (app) | 161 archivos pasan, 7 omitidos; 2782 tests pasan, 104 omitidos |
| `DATABASE_URL=… npm run build` (app) | genera cliente y compila, sin errores |
| `node scripts/sdd-check.mjs` | SDD check OK |
| `node harness/validate-work-items.mjs` | passed (CORE, 90 WI) |
| `node harness/validate-harness.mjs` | Harness V3 validation passed |
| `node harness/validate-completions.mjs` | passed (87 WI completados) |

(El mensaje `ERROR [ProjectRoleGuard]` en la salida de tests es log esperado de una prueba que pasa.)

## 6. Riesgos / observaciones (informativas, no bloquean)
- OBS-1 (baja): doble generación en instalaciones completas (`postinstall` + `build`); añade ~0.3 s medidos localmente. Sin impacto funcional.
- OBS-2 (baja): `prisma generate` en Prisma 7.10 genera sin red en esta prueba local (motor ya presente en `node_modules`); en Render el mismo comando ya corría en `postinstall` el 22-oct, así que no cambia la dependencia de red. Si Render alguna vez bloqueara la variable `DATABASE_URL` del entorno de build, el build fallaría con el mensaje de arriba (mismo requisito que antes).
- Sin hallazgos de seguridad, contrato ni alcance. No se leyó ningún `.env`.
