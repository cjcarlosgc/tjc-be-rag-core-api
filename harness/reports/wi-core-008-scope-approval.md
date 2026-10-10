# Decisiones de alcance — WI-CORE-008 (2026-10-08)

**Autoriza:** usuario, en chat desde la sesión Core.

- **Bundle del Contract Sync de implementación:** bundle B (workspaces, roles y acceso). El bundle A ya está implementado y publicado (DEC-ORG-002).
- **Cierre:** parte local verificada (roles y aislamiento) con pruebas locales. No se ejecuta nada externo.
- **Precondiciones externas:**
  - Organización real de GitHub: disponible por declaración del usuario (sin verificación del agente).
  - `Members: read` aceptado por un owner (requiere que la App sea instalable en la organización): PENDIENTE-EXTERNO.
  - Supabase sin email/contraseña: PENDIENTE-EXTERNO.
  - Los dos pendientes se solicitan al usuario cuando haya que probar contra la organización real; el agente no los ejecuta ni configura nada externo por su cuenta.
- La validación contra la organización real sigue requiriendo autorización explícita del usuario en ese momento.
