# WI-CORE-084 — despersonalizar los pilotos en el SDD de Core (FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** el usuario aprobó directamente en el chat de Core, el 2026-10-24: «Apruebo el reparto. Haz el WI documental FAST en Core que despersonaliza la sección de pilotos antiguos de spec/008 y envía a cross el texto exacto para Tesis/AGENTS.md, sin duplicar lo que Core ya cubre». Basado en el handoff del usuario `HANDOFF_PILOTOS_EVIDENCIA_CIERRE_DOCUMENTAL.md` y en el reparto «cross = gobierno de investigación; Core = lo que el software debe hacer».

## Qué cambia (solo texto en `spec/` y `CHANGELOG.md`)

- `spec/features/008-experimental-comparison/spec.md`: la sección «Piloto controlado de compatibilidad PHP» (tres pilotos antiguos —Validación Ventas, Reservas, Suscripciones— con tabla de 9 símbolos y total «9 targets, 27 pares y 54 ejecuciones») pasa a «Repositorios piloto del experimento (protocolo; sin identidades en el SDD)»: las identidades, la modalidad del cambio, los targets y los oráculos son decisiones de investigación y viven fuera del SDD; el SDD conserva solo lo que Core debe cumplir (congelado de `repositoryId`, SHA/HEAD y `effectiveProjectRoot` antes de la primera corrida y mismo snapshot por par; diseño pareado y condiciones comunes; CF/CO/VT sin ganador automático; oráculos externos; no modificar repos piloto; complemento de `OC01`–`OC15`).
- `spec/features/019-project-root-detection/spec.md`: la frase que remitía a «los tres repositorios controlados y sus nueve targets» apunta ahora a la sección genérica de 008. (Los repositorios empresariales de validación de `projectRoot` de 019 son otro conjunto y no se tocan.)
- `CHANGELOG.md`: entrada del WI.

## Fuera de alcance

`AGENTS.md` de Core (no se toca: la «Frontera de contexto» ya excluye contenido académico), tesis, Full Paper, contratos (`system-contract.md`, `interoperability-contract.md` mencionan los pilotos antiguos: se corrigen con el próximo cambio de INTEROP, lote de erratas), código y `Tesis/AGENTS.md` (lo escribe cross).
