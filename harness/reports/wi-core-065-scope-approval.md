# WI-CORE-065 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): alcance del WI de Fase 3 A2: (1) incluir en la sección «Dependencias del código objetivo» la firma del constructor de cada tipo resuelto, con tope de tokens, SOLO en el brazo RAG; (2) añadir a las convenciones PHPUnit de AMBOS brazos, con la MISMA redacción, que no se extienden clases `final` (tampoco con clases anónimas) y que los closures que usan `$this->assert…` no se declaran `static`. Sin modificar ranking, pesos ni R-PHP; con prueba rojo→verde y medición en el banco de calibración (`harness/calibration`); sin push ni despliegue sin su orden.

## Evidencia de origen
Verificación no oficial posterior a `WI-CORE-064`: `ArgumentCountError` en 4/6 trials RAG por `new Plan(monthlyPrice: …)` sin `$code` (`Plan::__construct(public string $code, public float $monthlyPrice)`; la clase `Plan` quedó descartada en el rank 21 y la sección solo daba el FQCN); `Fatal … cannot extend final class` (clase anónima que extiende `final class RenewalDatePolicy`); «Using $this when not in object context» (closures `static function` con `$this->assert…`).

## Alcance
- Firma del constructor (parámetros promovidos con tipo y nombre y valor por defecto; sin cuerpo; escalares/pseudo-tipos no aplican; sin inventar si no se encuentra o es ambiguo) extraída del chunk del índice, tope de tokens explícito y marca de truncado, solo en el brazo RAG; el agente no la recibe.
- Dos líneas nuevas de convención con la misma redacción en RAG y agente; nueva versión del prompt (`php-prompt-2026-10-14.4`). TypeScript sin cambio.
- Banco de calibración: M5 top-10 idéntico, M4 tokens extra, M6 con reglas `R-ANON-FINAL`, `R-STATIC-THIS` y `R-SIG` con precisión y sensibilidad sobre los trials V1 y las verificaciones. Sin cambio de contrato salvo que sea imprescindible (contract-reviewer antes); sin migraciones.
