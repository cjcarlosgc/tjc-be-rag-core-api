# WI-CORE-067 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): «un WI de Core que refuerce dos convenciones PHPUnit existentes en ambos brazos (no mocks, extends ni implements de clases final; no new sobre enums) y extienda R-ANON-FINAL a implements; sin tocar ranking, pesos, R-PHP ni targets; prueba rojo→verde; sin push ni despliegue sin mi orden».

## Evidencia de origen (experimentos no oficiales posteriores a WI-065/066)
- `46e82081` (SUB-1) RAG2 y `6b661170` (SUB-2) RAG1/RAG3: `…RenewalDatePolicy@anonymous cannot implement … - it is not an interface` (clase anónima `implements` una clase `final`).
- `5a1efbc2` (SUB-3) RAG2: `Cannot instantiate enum …SubscriptionStatus` (`new` sobre un enum).
- Trials con `new class … implements` en `testContent`: 46e82081 (3), 6b661170 (4), 38820957 (1).

## Alcance estricto
1. Reforzar en `php-phpunit-conventions.ts`, con la MISMA redacción en RAG y agente (pareado), las dos convenciones existentes: la de clases `final` cubre mocks/stubs/`getMockBuilder`, `extends` e `implements`, incluidas clases anónimas, y pide usar la instancia real con `new`; la de enums prohíbe `new` y mock sobre un enum y pide un caso (`Enum::Caso`). Concisa; informar tokens extra por prompt.
2. Banco `harness/calibration`: R-ANON-FINAL detecta también `new class … implements <Tipo>` cuando el tipo es una clase `final` conocida en el contexto/índice; regla nueva R-NEW-ENUM (`new <Enum>`), por ser el mismo patrón y caber sin ampliar alcance.
3. Nueva versión del prompt (`php-prompt-2026-10-14.6`) en constante y spec 004.
- Fuera de alcance: ranking, pesos, R-PHP, targets (#4), traza, contrato, sección de dependencias, firmas, DEC-RAG-001.
- Medición: M5 top-10 idéntico (V1 + verificaciones), M4 tokens extra por caso, M6 con las reglas nuevas (precisión/sensibilidad sobre trials con evidencia real, incluidas las rondas nano .4/.5 y Luna). Revisión independiente (Modo fuera de casa). Sin push/deploy/DB real.
