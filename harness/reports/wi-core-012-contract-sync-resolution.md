# Resolución de interoperabilidad — WI-CORE-012

**Fecha:** 2026-09-27
**Evento:** `CS-CORE-20260927-001`
**Consumidor:** Console, `WI-CONSOLE-009` (permanece abierto para revisión humana)

## Evidencia

- Console importó y acusó el evento, actualizó los DTOs de `ProjectVersion`/inventario y registró `C-RESOLVED` con `harness/reports/wi-console-009-implementation.md` en su checkout.
- El espejo `spec/contracts/interoperability-contract.md` de Console coincide byte por byte con Core. SHA-256 de ambos archivos: `32d2ab372606c379d9c4c7587b2bdaf8f452d37175d67e5af3811f66be3e738d`.
- La revisión contractual independiente de Console quedó aprobada en `harness/reports/wi-console-009-contract-review-final.md`; validó el cambio PHP, compatibilidad aditiva y el límite de no afirmar generación PHPUnit disponible antes de `WI-CORE-013`.
- Console verificó 427 pruebas de aplicación, 19 pruebas del Harness, lint, build, validadores SDD/Harness y `git diff --check`. El build emitió solo un warning informativo de tamaño de bundle.
- Core registró `start`, `implementation-delivery` y `before-review` sin eventos relevantes pendientes; las clasificaciones históricas no aplicables siguen delimitadas al WI.
- El WI tuvo `reviewCycles: 0` de un máximo permitido de 2; no se agotó ningún ciclo de revisión.

## Alcance y cierre

El consumidor implementó el contrato PHP sin cambios a Sandbox ni a los temas heredados de OAuth, Action Required o autorización de ramas. La aprobación humana del alcance de Core está en `wi-core-012-user-review.md`; la revisión contractual del delta Core, en `wi-core-012-contract-review.md`. No se cierra aquí `WI-CONSOLE-009` ni se declara habilitada la generación/ejecución PHPUnit.
