# Cierre — WI-CORE-063
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-070

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-063-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED; línea base 15/15; M5 recomputado a mano en 7 casos; 10 mutantes detectados; extractor solo SELECT). Alcance aprobado por Jean (mensaje directo: Fase 3 B). El usuario es informado y puede reabrirlo. No autoriza push ni despliegue.

## Qué entrega
`harness/calibration/` (`lib.mjs`, `calibrate.mjs`, `extract-experiments.sh`, `README.md`, fixtures sintéticos y 26 pruebas): replay offline sin LLM con M1 a M6 sobre los 9 casos V1 y 6 verificaciones no oficiales; la línea base reproduce el top-10 persistido 10/10. Informe con la línea base y cómo ejecutarlo: `harness/reports/wi-core-063-calibracion-baseline.md`. Código `222b60847baad44ab8d982637981dd31a13db827`. Sin cambios en `app/`, ranking, R-PHP ni contratos.

## Notas
Hallazgos menores en `IDEA-035`. Los volcados con código de terceros quedan fuera del repositorio.
