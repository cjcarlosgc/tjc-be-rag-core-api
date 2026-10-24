# WI-CORE-088 — análisis de modularidad del LLMProvider para ESC-MOD-01 (solo lectura)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** pedido de `[TN]-Cross` (2026-10-24), que relaya una necesidad del usuario: demostrar la modularidad con una API key de **otro proveedor de LLM** (tesis C-09 «Model Provider Adapter (LLMProvider)», Anexo E; ESC-MOD-01 en Anexo G y §5.2.3; M1 archivos modificados fuera de adapter/config = 0, M2 cambios en contratos comunes = 0, M3 pruebas aplicables PASS = 100 %; baseline `arch-v1.0` + rama/commit posterior con el `LLMProvider` alternativo). La key la pondrá el usuario en `app/.env`; **no se lee ni se pide en ningún mensaje**. Es un análisis de solo lectura: no hay cambio de código, contratos ni `.env`, ni tag, ni push/PR/merge. No se ordena nada a otros repositorios.

## Preguntas (cada una con archivo:línea y DESCONOCIDO donde no se pueda verificar)

1. ¿Estamos listos? ¿El puerto `LLMProvider` es neutral: sin SDK de OpenAI fuera del adaptador, sin tipos del proveedor en el dominio, sin parámetros acoplados como `reasoning_effort` o la API Responses? Brechas con archivo:línea (incluye contratos, DTO, errores, configuración y validación de entorno).
2. ¿Qué haría falta para un segundo adaptador real (proveedor por confirmar con el usuario) y qué cambia en configuración y entorno (nombre de la variable de la key, selección de proveedor, validación)?
3. ¿Cómo se miden M1, M2 y M3 sobre `git diff` (definiciones de la tesis, rutas permitidas, comandos exactos) y qué pruebas de contrato del puerto faltan?
4. D-10 fijó ESC-MOD-01 con un adaptador FALSO: con una key real, ¿conviene mantener el falso para las pruebas de contrato y usar el real para la evidencia? Recomendación.

## Entregable

`harness/reports/arch-v1.0-modularidad-llm-provider-core.md`: veredicto de preparación, brechas, trabajo para el segundo adaptador, medición M1/M2/M3, recomendación sobre D-10, qué requiere aprobación del usuario (contrato, funcionalidad nueva, configuración) y el WI mínimo. Debe contrastarse con la tesis (`referencias/tesis.md`, solo lectura, por sección) y con `spec/transversal/providers/spec.md`.

## Fuera de alcance

Implementar el adaptador, elegir el proveedor (lo confirma el usuario), tocar `.env`, correr experimentos o crear el tag `arch-v1.0`.
