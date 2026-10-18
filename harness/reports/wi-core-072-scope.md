# WI-CORE-072 — regularización retroactiva de SDD 3.1 (en cola)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado: W-PLANNED** hasta que cierre WI-CORE-070 (un solo WI activo). Alcance aprobado por el usuario el 2026-10-19 en el chat de Core («la apruebo también», con elección explícita de «WI HARNESS retroactivo»).

## Naturaleza retroactiva

Los commits `5fa5666` y `9945342` (SDD 3.1: sin Modo fuera de casa ni `awayMode`, reviewer IA por defecto, vía rápida `lane: FAST`, coordinación por cross, `harness/README.md` con el checklist de homologación) se ejecutaron desde la sesión cross por orden expresa del usuario, antes de que existiera este WI y sin revisión independiente. Este WI no reescribe esa historia: la registra, la somete a revisión independiente (`reviewer`, `implementationAgent: cross`) y deja evidencia reproducible.

## Fuera de alcance

Cualquier cambio de producto en `app/` y de contratos. Sin push, PR ni merge.
