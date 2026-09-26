# 015 — Transición SDD y Harness Core

**Estado:** aprobado como trabajo de alineación. No crea nuevas épicas ni historias de usuario.

## Objetivo

Hacer trazable cada cambio desde una HU fija a subtarea y work item local, retirar definiciones de producto obsoletas y preparar la frontera de GitHub Integration sin alterar evidencia persistida.

## Invariantes

- El ZIP interno de snapshot para Docker/Sandbox sigue vigente; la carga manual de código y la descarga legacy de artefactos no.
- Los 18 IDs HU tienen significado nuevo; un `HUxx` histórico no demuestra automáticamente que la HU homónima actual esté terminada.
- Core y Console se alinean ahora; Sandbox no se edita durante el trabajo de su compañero.
- GitHub Integration será un cuarto componente dueño de toda interacción GitHub; el traslado de código ocurre después del corte SDD/Harness y de la limpieza legacy.

### DEC-GHI-001 — Contrato Core ↔ GitHub Integration
**Estado:** APROBADO (2026-09-25); topología de consumo actualizada por DEC-GHI-002

**Blocks:** NONE
**Resolución histórica:** El usuario aprobó `GH-INTEROP-1.0` como API privada HTTPS entre Core y GitHub Integration y el primer corte de extracción. La decisión vigente sobre consumidores se actualiza en `DEC-GHI-002`; el código y los WIs ya cerrados conservan su evidencia histórica.

Supabase Auth conserva el login GitHub de las personas. El provider token permanece efímero y solo se usa para operaciones user-centric; no se almacena, registra ni usa para automatización. No se cambia el scope OAuth actual `repo`, pese a que es más amplio que discovery. `IDEA-005` evalúa una alternativa de menor privilegio sin cambiar inadvertidamente la experiencia de selección de repositorios.

### DEC-GHI-002 — Operaciones de interfaz GitHub desde Console
**Estado:** APROBADO por el usuario (2026-09-26)

**Blocks:** NONE
**Resolución:** Console llama directamente a rutas públicas autenticadas de GitHub Integration solo para información de App, discovery de repositorios, verificación GitHub y listado de ramas. Para cada comprobación, Integration remite a Core la sesión Supabase y datos GitHub verificados; Core valida identidad/sesión y aplica autorización workspace/Project sin volver a consultar Integration por esa misma comprobación. Core sigue siendo dueño de persistencia de bindings, Projects, RAG y reglas de dominio. La persistencia recibe evidencia Core-firmada de vida corta, ligada a usuario, acción, Project, repositorio y rama. Las rutas Core equivalentes se mantienen temporalmente hasta validar compatibilidad y se retiran en un corte posterior. El flujo de pipeline Core→Integration→GitHub y webhook Integration→Core permanece vigente. Sandbox no cambia.
