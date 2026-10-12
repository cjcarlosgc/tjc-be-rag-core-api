# WI-CORE-042 — Base de alcance aprobado

WI-CORE-042 es una corrección de conformidad para la regla 4 aprobada por el usuario en WI-CORE-029, no una nueva capacidad PHP ni un cambio de alcance.

La regla vigente exige que GENERALIST_AGENT produzca PHP/PHPUnit 11 con archivo completo, `<?php`, namespace y ruta indicados, manteniendo herramientas, presupuesto y tope de llamadas; TypeScript debe quedar sin cambios. El cierre estático al alcanzar `toolCallCap` actualmente contradice esa regla al exigir TypeScript. El corte restaura el comportamiento aprobado y solo añade regresiones PHP/TypeScript.

No se cambia el contrato, DTOs, persistencia, migraciones, configuración, Sandbox, otros repositorios ni infraestructura. Esta evidencia registra que el alcance ya está cubierto por la aprobación de WI-CORE-029 (`spec/features/018-php-laravel-support/spec.md`, §WI-CORE-029, regla 4; `harness/reports/wi-core-029-implementation.md`); no representa una aprobación nueva del resultado técnico, que requiere revisión independiente.
