# WI-CORE-091 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: el script `build` de `app/package.json` es ahora `prisma generate && nest build`, de modo que el build ya no depende del `postinstall` ni de la caché de `node_modules` de Render. Causa verificada en los logs de Render del 2026-10-24: con la caché restaurada y el lockfile sin cambios, `pnpm install --frozen-lockfile` terminó en 49 ms sin ejecutar `postinstall: prisma generate`, y `app/src/generated/` (en `.gitignore`) faltaba en el checkout, así que dos autodeploys (`c7502e50`, `a1f32475`) terminaron `build_failed` con TS2307; el servicio siguió en la versión viva del 22 de octubre. Sin cambio de contrato, esquema de Prisma ni comportamiento.

- **Verificaciones del leader:** lint en verde; `DATABASE_URL=… npm run build` (como el CI) regenera el cliente y compila; 2782 tests pasan.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 de 2, sin hallazgos bloqueantes; probó el escenario en una copia (sin `src/generated`: `nest build` falla con 51 TS2307; con el script nuevo pasa). Observaciones informativas: OBS-1 en instalaciones completas el cliente se genera dos veces (~0,3 s, sin impacto); OBS-2 `prisma generate` falla si falta `DATABASE_URL` (`prisma.config.ts:11`), requisito que ya tenía el `postinstall` y que Render y el CI cumplen.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
- **Publicación:** bajo la autorización permanente del usuario (push de `feature/jean`, PR a `develop`, merge si no hay conflictos y la CI está en verde). El efecto esperado es que el autodeploy de Render de Core vuelva a compilar con el commit de `develop`.
