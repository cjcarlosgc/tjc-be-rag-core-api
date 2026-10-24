# WI-CORE-092 — runbook operativo de los pilotos (FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** pedido de `[TN]-Cross` (2026-10-24), que relaya una decisión del usuario sobre el reparto de pilotos: un compañero del usuario ejecuta P1 `brick/money` desde su propia máquina, el usuario ejecuta P3 `EscolaLMS/Vouchers` y P2 `doctrine/orm` (issue #11600) se hace después entre los dos; configuración fija `gpt-6-luna` con `LLM_REASONING_EFFORT=medium`; forks en `rag-tesis-org` (money, orm, Vouchers), rama de integración `develop`, Projects `piloto-money`, `piloto-orm` y `piloto-vouchers` ya vinculados. El compañero no tiene el `AGENTS.md` ni debe tocar `harness/` o `spec/`: necesita un manual operativo. Solo lectura sobre el software; no se toca código, contratos, `.env`, tesis ni otros repositorios.

## Alcance

Un documento `harness/reports/pilotos-runbook-operativo.md`, paso a paso y verificado contra `spec/008`, el código, la Console y los `composer.json`/workflows de los forks, para alguien que conoce PHP pero no el SDD: (0) prerrequisitos y el bloqueo conocido de acceso (verificación con GitHub); (1) qualification/smoke por piloto y si la brecha de extensiones de la imagen PHP bloquea; (2) cómo se crea un caso, se lanza el experimento RAG vs GENERALIST_AGENT con 3 repeticiones y se verifica el `modelConfig`; (3) qué exportar y dónde (evidencia del Run, resultados, trace de 9 enlaces, logs y hashes, y campos de la Tabla 70 rellenables automáticamente); (4) fallos esperables y qué NO hacer; (5) qué no puede hacer una segunda persona a la vez.

## Fuera de alcance

Definir el cambio funcional concreto o el oráculo de cada piloto (los entrega el equipo investigador); ejecutar corridas; cambiar configuración de Render; resolver el `UNVERIFIABLE` (diagnóstico aparte); tocar la tesis; push, PR o merge **por petición de cross** (el commit local es suficiente; la publicación sigue la autorización permanente del usuario con el siguiente lote).

## Criterios

El documento existe, cada afirmación verificable cita su fuente y marca ✔/⚠; revisión independiente del `reviewer` sobre la exactitud (códigos, rutas, pantallas, valores); sin secretos ni valores sensibles; se entrega a cross la ruta del archivo.
