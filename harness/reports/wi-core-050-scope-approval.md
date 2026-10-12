# WI-CORE-050 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** Jean (Human Reviewer), directamente en el chat de Core al aprobar «Sí, aprobada as-built» sobre `DEC-INF-002` (la lista que vio incluía el work item de código `isAllowedSandboxUrl` aprobado aparte); Cross relaya además «destraba y resuelve de una vez». SDD: `harness/reports/wi-core-050-preparation.md`.

## Alcance
`app/src/config/env.validation.ts` y su spec: `isAllowedSandboxUrl` análoga a `isAllowedGithubIntegrationUrl` (HTTPS obligatorio con `NODE_ENV=production`; HTTP solo en loopback fuera de producción; sin credenciales, ruta ni query), manteniendo la regla de `DEC-AUTH-001` y sin romper `http://localhost:3001` ni `http://127.0.0.1:3101`. Nota en `app/.env.example` si hace falta. Sin tocar experimentos, OE2/OE5, evidencia, métricas ni `sandbox/`; sin contrato. Si el contract-reviewer considerara observable la regla, se presentará como `DECISION_REQUIRED` con una línea.
