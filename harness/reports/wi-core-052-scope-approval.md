# WI-CORE-052 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 (según el coordinador) · **Autoriza:** Jean (Human Reviewer), directamente en el chat de Core: «Sí, WI de constructs PHP ya». `POTENTIALLY_IMPACTED` para PHP NO fue aprobado: queda como hallazgo/decisión aparte.

## Hallazgo
`snapshot-intelligence/snapshot-analysis-job.handler.ts:354-355`: `if (!isPhp) { … symbolBehaviorConstructsService.compute(…) }` («PHP queda diferido: su columna se queda nula»). `WI-CORE-032` habilitó el extractor (`extractPhpBehaviorConstructs`) y el servicio/evaluador, pero no el llamador; por eso `analysis_symbols.behaviorConstructs` es NULL (no `[]`) en símbolos PHP y nunca hay `ACTION_REQUIRED` en PHP. `SymbolBehaviorConstructsService` ya despacha por lenguaje.

## Alcance
Quitar el condicional para que `compute()` se ejecute también en PHP (HEAD del workspace y `baseSha`; archivo `added` sin base; base no encontrada → `[]`), verificando que con `projectRoot` el `filePath` prefijado resuelve el archivo correcto (monorepo con `projectRoot` `backend`). No se cambian extractor ni evaluador salvo lo imprescindible. Los fallos de GitHub al leer la base siguen como hoy. Documentar en la feature 013 (OC04) que PHP queda cubierto.

## Riesgos declarados
Más llamadas a GitHub (una por archivo PHP cambiado) y cambio de comportamiento en producción: PRs PHP con construcciones nuevas pasarán a `ACTION_REQUIRED` (esperado por `DEC-FK-003/004`) y necesitarán respuesta de Maintainer/Admin. Sin afectar experimentos, OE2/OE5, evidencia ni métricas.
