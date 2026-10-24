# WI-CORE-091 — verificaciones técnicas
Modelo: implementer · configurado claude-sonnet-5-5 · atendido claude-haiku-5-5 · esfuerzo low

## Cambios
- `app/package.json`: `"build": "nest build"` → `"build": "prisma generate && nest build"`. Resto de scripts intactos.
- `CHANGELOG.md`: entrada WI-CORE-091 en `[Unreleased]`, encima de WI-CORE-089.
- Sin cambios en lockfile, workspace, esquema Prisma, `prisma.config.ts`, `.github/`, harness, contratos ni otros repos. `git diff --stat`: 2 archivos, 2 inserciones, 1 eliminación.

## Escenario de Render en local
Preparación: `app/src/generated/` y `app/dist/` copiados a la carpeta de respaldo del scratchpad, después borrados.

1. Antes del cambio (`./node_modules/.bin/nest build`, sin pasar por pnpm ni por el postinstall): **falla**, exit 1, errores `TS2307 Cannot find module '../generated/prisma/client.js'` en `src/access-sync/`, `src/analysis-runs/`, etc. Reproduce el fallo de Render.
2. Después del cambio (`pnpm run build` con `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public` solo en ese comando), desde `src/generated/` ausente: **pasa**, exit 0. Log: `✔ Generated Prisma Client (7.10.0) to ./src/generated/prisma`. `src/generated/prisma` queda presente.

Nota de método: un primer intento con `pnpm exec nest build` no sirvió como «antes»: pnpm disparó una reinstalación (`+3 -10`) que ejecutó el postinstall y regeneró el cliente. Por eso se repitió el «antes» con el binario directo. Esa reinstalación solo afectó a `node_modules` (no versionado).

## Comandos (desde `app/` salvo indicación)
| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | exit 0; Test Files 161 passed, 7 skipped; Tests 2782 passed, 104 skipped (igual que la línea base) |
| `DATABASE_URL=… npm run build` | exit 0 |
| `node scripts/sdd-check.mjs` (raíz) | exit 0, «SDD check OK» |
| `git status --short` | ` M CHANGELOG.md`, ` M app/package.json` (únicos cambios) |

## Estado final
- `app/src/generated/prisma` regenerado por el build (ignorado por git); `app/dist/` regenerado por el build (ignorado por git; la copia original quedó en el scratchpad).
- No se hizo commit ni push.

## Re-ejecución del leader (2026-10-24)

Desde `app/` con Node 22: `npm run lint` (exit 0); `DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?schema=public npm run build` (como el CI): `prisma generate` regenera el cliente en `src/generated/prisma` y `nest build` compila (exit 0); `npm test`: 161 archivos pasan y 7 omitidos; 2782 tests pasan y 104 omitidos (igual que la línea base). `git diff` de `app/package.json`: solo la línea `build`. `git status`: `CHANGELOG.md`, `app/package.json` y el informe del WI.
