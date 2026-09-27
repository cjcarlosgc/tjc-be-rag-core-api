# 016 — Frontera GitHub Integration

**Estado:** código fuente de la migración revisado y cerrado localmente en `WI-CORE-003`, `WI-CONSOLE-003` y `WI-GH-006`; esto no declara deploy ni cutover. La exclusión de PRs anteriores al binding se trata en cortes nuevos separados.

## Valor y alcance

Permitir que GitHub Integration sea dueño único de la interacción GitHub, mientras Console usa directamente sus capacidades de interfaz y Core conserva dominio, autorización, persistencia y pipeline sin volver a integrar SDK/API de GitHub.

No se agregan épicas ni HU. Esta feature implementa cortes técnicos enlazados a HU01, HU02, HU03, HU06, HU14 y HU16. El mapa de aceptación del negocio sigue en `spec/backlog.md`; esta feature y sus `tasks.md` detallan subtareas por componente.

## Decisión aprobada

`DEC-GHI-001` aprobó la primera extracción; `DEC-GHI-002` define la topología vigente y `GH-INTEROP-1.1` la formaliza. Console llama a Integration para información de App, discovery, verificación GitHub y ramas; mantiene en Core workspaces/Projects, persistencia de bindings, RAG y análisis. Para cada operación directa Integration llama sincrónicamente a Core con el JWT Supabase del usuario y hechos GitHub allowlisted. Core valida la sesión/identidad, aplica reglas de workspace/Project y responde permitir/denegar sin volver a llamar a Integration durante esa comprobación.

Supabase Auth conserva el login humano. En la topología directa Console→Integration, el JWT de plataforma se envía a Integration para su validación síncrona en Core y el provider token GitHub se usa dentro de Integration para discovery o verificación de repositorio nuevo; el callback solo incluye sesión y hechos allowlisted, no ese token. La ruta Core heredada de discovery aún recibe y reenvía el provider token a Integration hasta retirarse en otro corte; nunca se persiste ni registra. La verificación informativa de un binding existente y la consulta de ramas no reenvían OAuth: Core entrega identidad vinculada y scope permitido, Integration verifica hechos con la App y Core vuelve a autorizarlos. La evaluación del scope `repo` queda en `IDEA-005`. Para crear un binding, Core recibe y valida una evidencia firmada de vida corta y ligada a usuario, acción, Project, repositorio e integration branch. Las rutas Core anteriores de discovery, verify-access y branches permanecen temporalmente como compatibilidad y no se retiran en este WI. El ZIP interno de snapshot para Docker/Sandbox se conserva; no vuelve la carga manual de ZIP ni la descarga agrupada de artefactos. Sandbox no cambia.

## Requisitos transversales

- Los endpoints Core existentes de discovery, verify-access y branches conservan sus rutas y comportamiento temporalmente; el nuevo endpoint de persistencia de binding verifica la evidencia Core-firmada. Las rutas nuevas de usuario Console→Integration están en `GH-INTEROP-1.1`.
- Solo Core decide permisos de dominio; un evento firmado de GitHub puede disparar reverificación, pero no concede un rol.
- Core acepta webhooks normalizados únicamente por autenticación servicio-a-servicio, valida schemaVersion/forma, persiste dedupe PR y encola/aplica sus efectos idempotentes antes de aceptar.
- GitHub Integration entrega payloads allowlisted; nunca envía raw body, tokens de instalación, JWT de App o error crudo de GitHub a Core.
- Ningún secreto se persiste o escribe en logs. Las credenciales de servicios son separadas por dirección y con timeout acotado.
- El alcance es código y validación local: no cambia URL registrada, secretos externos, deploy, DNS, configuración de Supabase/GitHub App ni cutover. La vigencia de Core auth-evidence y origen/CORS de Console requiere configuración local documentada antes del deploy; esta tarea no la aplica externamente. Cualquier retiro posterior de rutas Core o cambio de webhook exige corte coordinado y autorización expresa.
