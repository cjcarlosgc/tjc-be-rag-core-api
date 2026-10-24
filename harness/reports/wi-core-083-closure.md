# WI-CORE-083 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: la propuesta de aserciones CT (`arch-v1.0-aserciones-ct-propuesta.md`) registra D-2, D-9 y D-11 como decididas con las palabras del usuario del 2026-10-24 (WI `HARNESS`, carril `FAST`, solo texto en `harness/reports/`), ajusta CT-01-A1/A5, CT-08-A2/A4/A6 y el resumen, y lista los documentos con descripción desactualizada (pilotos antiguos en tesis §3.3.3 y §5.6; Full Paper por contrastar). La tesis, el Full Paper, `app/`, contratos y esquemas no se tocaron.

- **Decisiones del usuario:** D-2 dos mitades (Integration: webhook de GitHub a evento; Core: evento autenticado a AnalysisRun) más esquema JSON canónico del payload con ejemplo validado por ambos repos, sin prueba extremo a extremo; D-9 y D-11 tres AnalysisRuns, uno por piloto (`brick/money`, `doctrine/orm`, `EscolaLMS/Vouchers`), checklist manual de 9 enlaces en directo e inverso con Evidence ID, N/A justificado o incumplimiento, sin funcionalidad ni endpoints nuevos antes de `arch-v1.0`.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 de 2, sin divergencias con el handoff del usuario; el residuo F-1 («o funcionalidad nueva» en CT-08-A2/A4 y en la fila del resumen) se alineó en el cierre. `contract-reviewer`: no aplica; sin Contract Sync.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.

Pendientes del usuario en la propuesta: D-3, D-4, D-6 y D-7. Pendiente de ubicación: el handoff de pilotos pide registrar sus reglas en `AGENTS.md` (o equivalente); no se aplicó en Core porque no se editan repos por esa vía y el `AGENTS.md` de `Tesis/` es de cross; el usuario decide dónde. Sin push, PR ni merge; sin tag.
