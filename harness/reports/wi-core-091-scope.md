# WI-CORE-091 — el build de Core genera el cliente de Prisma
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de Core el 2026-10-24: «Apruebo un WI para que el build de Core genere el cliente de Prisma ("build": "prisma generate && nest build"), con su revisión. Después publícalo con el flujo estándar. Continúa.» Publicación bajo la autorización permanente del usuario (push de `feature/jean`, PR a `develop` y merge si no hay conflictos y la CI está en verde; no se toca `main`).

## Problema (verificado en los logs de build de Render, 2026-10-24)

Los dos autodeploys tras el merge del PR #27 (`c7502e50` y `a1f32475`) terminaron `build_failed` con 318 errores de TypeScript por `../generated/prisma/client.js` ausente; el servicio sigue en la versión viva del 22 de octubre. Causa: Render restaura la caché de `node_modules`; con el lockfile sin cambios `pnpm install --frozen-lockfile` no hace nada (49 ms) y no corre el `postinstall: prisma generate`; el cliente se genera en `app/src/generated/` (en `.gitignore`), así que un checkout nuevo no lo trae. El build del 22 de octubre sí lo generó porque el install fue completo. No lo causan los commits nuevos: cualquier redeploy con el mismo lockfile falla.

## Alcance aprobado

Cambiar el script `build` de `app/package.json` a `prisma generate && nest build`, de modo que el build no dependa del `postinstall` ni de la caché. `postinstall` y `prisma:generate` se conservan. Comprobar localmente el escenario de Render: con `app/src/generated/` ausente, `pnpm run build` regenera el cliente y compila. Entrada en `CHANGELOG.md`.

## Fuera de alcance

Configuración de Render (comando de build, caché), versión de pnpm (`packageManager` ya fija `pnpm@12.14.0`), cambios en el esquema de Prisma, migraciones, contratos, otros repositorios; el re-despliegue lo hace el autodeploy tras el merge (no un despliegue manual).

## Criterios

Lint, tests y build en verde; con `app/src/generated/` borrado, `pnpm run build` termina bien y deja el cliente generado; revisión independiente del `reviewer`; publicación con el flujo estándar.
