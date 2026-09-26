# Autorización de implementación — WI-CORE-003

**Fecha:** 2026-09-25
**Origen:** confirmación explícita del usuario en esta sesión.

El usuario autorizó continuar con la extracción completa al cuarto componente y, solo para esta migración, cambió el punto de aprobación humana: revisará el diff consolidado cuando termine toda la migración, en vez de aprobar cada work item por separado. Esta autorización permite implementar el alcance aprobado de `GH-INTEROP-1.0` en Core; no aprueba de antemano la calidad del diff ni sustituye la revisión final humana. No autoriza push, deploy, cambio de URL/secretos/DNS, Supabase, modificación de Sandbox ni cutover.

## Addendum de alcance — 2026-09-26

El usuario aprobó además la topología `GH-INTEROP-1.1`: Console→Integration para App info, discovery, verificación y ramas; Console→Core para dominio/persistencia; Core→Integration para operaciones internas. Esta aprobación amplía el alcance de implementación, no aprueba el código ni modifica el gate de revisión/aprobación final personal, que permanece pendiente. Sin push, deploy, cambios de secretos externos, Sandbox ni cutover.
