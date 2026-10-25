# WI-CORE-098 — alcance: cierres de código del baseline `arch-v1.0` (G-01 V1 «contexto insuficiente» y G-03 texto del 422)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Aprobado por el usuario (chat de Core, 2026-10-25):** «código G-01 V1 + G-03», dentro del inventario `arch-v1.0-inventario-huecos-codigo` (opción A: cerrar los huecos de código antes de cualquier Run oficial y recrear el tag una sola vez). Sin cambio de contrato, DTO, enum, código de error, ruta, variable de entorno ni migración; sin cambios en otros repositorios.

- **G-01 V1 (CT-05-A5, regla D-5, aprobada 2026-10-23):** «contexto insuficiente» = sin código del target, o sin ningún candidato que pase el mínimo de relevancia Y faltan reglas funcionales requeridas ⇒ no se produce `GenerationContext` y no se genera; lo demás no bloquea. Hoy `acquireGenerationContext`/`ContextBuilder.build` siempre devuelve contexto. V1 = compuerta de dominio compartida con un error tipado interno; Validation y Experiments dejan la propuesta/intento sin generar y sin llamar al LLM, sin cambiar los estados, códigos ni clasificaciones existentes. V2 (Run → ACTION_REQUIRED con pregunta) queda declarada como limitación, fuera de alcance.
- **G-03 (F2 de ESC-MOD-01):** el texto del 422 de temperature en `app/src/experiments/experiments.service.ts` (≈`:341-352`) dice «razonamiento activo del modelo» y es engañoso con otro proveedor: texto neutral, mismo código de error.
- **Fuera de alcance:** G-02, G-04, G-05, G-06, G-07, G-08, G-09 (declaraciones/pruebas en WI-CORE-099/100), indexación por lotes, cualquier cambio de contrato.

Hecho cuando: la compuerta D-5 tiene pruebas de sus ramas (sin código del target; sin candidatos Y reglas requeridas faltantes; casos que NO bloquean), la paridad entre brazos y los estados existentes quedan demostrados, G-03 cambia solo el texto, lint/build/test en verde y el reviewer independiente aprueba.
