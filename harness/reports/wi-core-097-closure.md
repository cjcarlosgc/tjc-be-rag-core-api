# WI-CORE-097 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: informe de solo lectura `harness/reports/wi-core-097-aislamiento-y-purga-projects.md` (aislamiento por Project/versión, borrado lógico existente sin purga física ni borrado de Storage, orden de borrado por FK y claves de Storage, riesgo de gobierno de datos, `DEC-VAL-001` PENDING y alcance de `DEC-INF-001/002`). Documental: sin cambios en `app/`, contratos, BD, Storage, `.env`, tesis ni otros repos.

- **Revisión independiente (`reviewer`):** ciclo 1 CHANGES_REQUESTED (H1–H3 medios, H4–H9 bajos, aplicados por el leader); ciclo 2 CHANGES_REQUESTED menor (N1 medio, N2 y N3 bajos, aplicados y verificados por el leader; el revisor indicó que con ellos daría APPROVED sin otro ciclo). El máximo de 2 ciclos se agotó sin APPROVED formal.
- **Aceptación del usuario:** el usuario aceptó cerrar el WI con las correcciones del ciclo 2 ya aplicadas (chat de Core, 2026-10-25). No hubo tercer ciclo. Esta aceptación no sustituye la revisión: queda registrada como decisión del usuario.
- **Decisiones del usuario relacionadas (chat de Core, 2026-10-25):** borrado lógico ahora y sin purga física por ahora (reevaluar si Supabase muestra presión de espacio, antes de ingestar código empresarial o cerrar `DEC-VAL-001`, o tras sellar la evidencia oficial). `DEC-VAL-001` y la revisión de `DEC-INF-001/002` siguen pendientes y se difieren a después de la evidencia.
- `retryLimitRespected`: 2 ciclos de corrección de 2 permitidos.
- **Publicación:** commits locales; saldrán a `develop` con el siguiente lote bajo la autorización permanente del usuario.
