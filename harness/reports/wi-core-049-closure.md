# Cierre — WI-CORE-049
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-056

## Veredicto del usuario
Directo en el chat de Core (2026-10-12): «Sí, aprobada as-built», sobre `DEC-INF-002` con lo verificado por Cross y la decisión relayada «Aprobado tal como quedó, rate limit sí, rotación de 90 días y IAP respaldo».

## Qué entrega
SYSTEM-2.12 con `DEC-INF-002` APROBADA AS-BUILT (sucesor del estado PROPOSED de SYSTEM-2.11), sustitución explícita solo del ingreso por IAP al puerto del servicio y de la obligación de limitar HTTP/HTTPS para 80/443 hacia el proxy; superficie de riesgo sin suavizar; rate limit aprobado con valores iniciales a ratificar por Sandbox/Cross; rotación cada 90 días (dueño: Jean); IAP como respaldo; INTEROP-2.12 mínimo; corrección editorial de `DEC-VAL-002` y del estado de OC11. Texto fuente `864aa837b95fa379cc2c6d0a98f37521ff3eb3b6`; eventos `CS-CORE-20261012-011` (console) y `CS-CORE-20261012-012` (sandbox); `-009`/`-010` superados. Sin `app/`, VM, firewall ni Render.

## Pendiente
Work item de código `isAllowedSandboxUrl` (WI-CORE-050, preparado, sin implementar hasta indicación); implementación del rate limit y rotación por Sandbox/Cross con autorización operativa.
