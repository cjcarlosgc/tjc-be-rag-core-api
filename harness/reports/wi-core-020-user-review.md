# Revisión humana — WI-CORE-020
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-08 (America/Lima)
**Reviewer:** usuario (Human Reviewer); el veredicto proviene del usuario en el chat de la sesión, no de un agente (sin `executedBy`).
**Veredicto:** `APPROVED` sobre el rediseño de DEC-FK-005 (opción A: la migración aborta ante duplicados ACTIVE sin cambiar estados).

Decisiones del usuario (evidencia: `wi-core-020-implementation.md`, `wi-core-020-contract-review.md`, `wi-core-020-dec-fk-005-approved.md`, `wi-core-020-preflight-result.md`):

1. Punto A resuelto: se ejecuta primero el preflight de solo lectura. Si no hay duplicados ACTIVE por project + scope + targetRef + scenarioKey, no se hace ninguna acción. Si los hubiera: reporte determinista y script puntual, idempotente y revisado, con decisión humana explícita por caso (SUPERSEDE o KEEP_EXISTING), sin ruta nueva ni preguntas PENDING fabricadas; el script sería solo remediación de migración, fuera del contrato público.
2. El usuario autorizó que el agente ejecutara el preflight. Resultado: 0 filas y tabla `functional_knowledge` vacía (`wi-core-020-preflight-result.md`, commit 46a8102). No hace falta script de remediación.
3. B y C quedan como condiciones de despliegue (ver abajo), registradas como deuda/precondición sin resolverlas aquí.

## Deuda / precondiciones de despliegue aceptadas (no resueltas en este WI)
- **B:** transaccionalidad de la migración y estado P3009 de `prisma migrate deploy` en Prisma 7.10.0, a verificar antes de aplicarla en una base con datos.
- **C:** validación de la migración en PostgreSQL 16 con pgvector (la validación local fue en PostgreSQL 14 sin pgvector), antes de aplicarla en una base con datos.

Esta evidencia no autoriza push, PR, merge ni despliegue.
