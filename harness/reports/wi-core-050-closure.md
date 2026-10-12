# Cierre — WI-CORE-050
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-057

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-050-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED, sin blockers ni decisiones abiertas). No sustituye aprobaciones de alcance (aprobado por el usuario junto con `DEC-INF-002`: «Sí, aprobada as-built»). El usuario es informado y puede reabrirlo. No autoriza push.

## Qué entrega
`SANDBOX_URL` se valida en el arranque: HTTPS obligatorio con `NODE_ENV=production`; HTTP solo en loopback (`localhost`, `127.0.0.1`, `[::1]`) fuera de producción; sin credenciales, ruta ni query; `DEC-AUTH-001` intacta; mensaje sin imprimir el valor. Código en `ed71ad1cce0f8c1ddd19fbdf2693ce852b4bf72d` (3 archivos). Evidencia: `harness/reports/wi-core-050-technical-checks.md`.

## Notas
- F1 (`https://host/?` aceptado, igual que `isAllowedGithubIntegrationUrl`), F3 (función duplicada, candidato a helper común): menores, sin acción.
- F4 deuda editorial: la línea de `DEC-INF-002` en SYSTEM-2.12 aún dice «preparado y sin implementar»; corregir en el siguiente bump con contract-reviewer.
- Operación: una producción con `SANDBOX_URL` http no arranca; Cross verificó `https://136-115-2-208.sslip.io` en Render.
