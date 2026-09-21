# Misión

**Estado:** aprobado — SDD 2.1

Diseñar e implementar RAG Core, backend principal de RAG Test Studio, para analizar automáticamente el changeset de Pull Requests vinculados mediante GitHub App, construir contexto semántico-estructural-funcional trazable, generar y validar pruebas unitarias y devolver evidencia objetiva a GitHub y Developer Console.

## Usuario principal

Developer and/or coding agent produce cambios en una feature branch; una persona autorizada del Project revisa Runs, completa contexto funcional y decide si publica tests. El autor de GitHub no obtiene autoridad automática dentro de la plataforma.

## Principios

- `AnalysisRun` por PR/HEAD y `CHANGESET` son la unidad operativa; un Job/Attempt no es un Run.
- GitHub App automatiza repositorios; Supabase Auth autentica personas únicamente con GitHub OAuth.
- Context Builder combina target, código semántico, relaciones estructurales, Functional Knowledge y tests existentes con trazabilidad.
- RAG Core interpreta resultados; Sandbox ejecuta perfiles aislados y devuelve hechos sin conocer GitHub, usuario o estrategia.
- TypeScript/Jest/Vitest permanece compatible; PHP/Laravel/PHPUnit es el foco activo de stack.
- No existe autorepair semántico, modificación automática de producción, workflow YAML obligatorio ni merge automático.
- El experimento conserva `RAG` vs `GENERALIST_AGENT`; el contexto funcional exige una decisión metodológica antes de usarse como evidencia.
