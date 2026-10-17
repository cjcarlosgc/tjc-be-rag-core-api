# WI-CORE-031 — Revisión independiente del usuario (Human Reviewer)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Registro redactado por el leader; el veredicto, las condiciones y las autorizaciones proceden del usuario en chat (2026-10-09), no de contenido observado.

**Veredicto del usuario: APPROVED** sobre el rango `12c8025..e09387b` (cortes 1-5) y la evidencia de `harness/reports/wi-core-031-implementation.md`.

**Deudas e interpretaciones aceptadas:** 422 `REASONING_EFFORT_UNSUPPORTED` ampliado a «temperature incompatible con razonamiento activo» (sin ErrorCode nuevo); `endpoint` opcional; esquema de herramienta inválido envuelto en `LLM_PROVIDER_UNAVAILABLE`; `status` raros como fallo no externo; `reasoning.context` `all_turns` no se envía; repositorio de experimentos tocado para persistir `endpoint`; arranque más estricto si `LLM_SUPPORTED_COMBINATIONS` trae niveles fuera de la escala; cambio de comportamiento del flujo de producto (ahora por `/v1/responses`).

**Humo real autorizado por el usuario:** lo ejecutó el agente principal con el proveedor compilado (HEAD `65003d9`): gpt-6-luna en `max`, bucle con las 4 herramientas reales y razonamiento cifrado reenviado, llamadas en paralelo, llamada final con `tools=[]`, guarda de `temperature`, y el flujo de producto con la configuración real del usuario (`LLM_MODEL=gpt-5.6-luna`, `LLM_REASONING_EFFORT=high`) y con gpt-4o-mini: todo correcto. Evidencia en `harness/reports/wi-core-031-responses-probe.md` (incluye corrección del paso 5, `2bb6147`).

**Entorno:** el usuario autorizó al agente principal a añadir `LLM_SUPPORTED_COMBINATIONS` a su `app/.env` (ignorado por git). Queda pendiente para el usuario hacer lo mismo en Render. Ni el leader ni los subagentes tocan `app/.env`.

**Contrato:** sin Contract Sync (`contractImpact=false`, `publishesContract=false`); verificado al cierre: el rango no toca DTO, controlador, prisma ni INTEROP.
