# WI-CORE-067: revisión independiente (Modo fuera de casa, ciclo 1/2)

Veredicto: **APPROVED**

Rango revisado: 9e36b27..HEAD (código 1e782b0, docs ced5658).

## Verificado
- Alcance: solo cambian `php-phpunit-conventions.ts` (dos líneas + versión .6), specs, banco `harness/calibration`, spec 004 y harness. Sin cambios en ranking, pesos, R-PHP, targets, traza, contrato ni migraciones.
- Igualdad de redacción: las líneas viven en una sola constante usada por `prompt-builder.service.ts` (RAG) y `experiment-job.handler.ts` (agente); el spec valida ambos textos exactos y su presencia en el prompt.
- Tokens: recalculado con el tokenizador del banco, 196 (9e36b27) a 232 (HEAD), +36. Coincide.
- Tests: `node --test harness/calibration/*.test.mjs` 38/38; vitest de generation + php-dependency-depth2 108/108.
- Calibración con `calib-all67` en directorio externo nuevo: la tabla M6 coincide con el informe (R-ANON-FINAL 6/0/5/5 prec 0,83 sens 1; R-NEW-ENUM 1/0/1/1 prec 1 sens 1; el resto igual); línea base 10/10.
- R-ANON-FINAL con `implements`: tests cubren interfaz, clase no final y tipo desconocido sin marca; final con y sin `extends` previo marcado.
- Fixtures: clases inventadas (Acme\Billing), sin secretos ni datos reales.

## Hallazgos (todos menores, no bloqueantes)
1. Baja: R-NEW-ENUM recorre `testContent` completo con regex, por lo que `new Status(` dentro de un comentario o cadena se marcaría (falso positivo posible). Sin FP en la muestra real (0 con valid=true); aceptable como heurística, conviene documentarlo en la sección de limitaciones del README.
2. Baja: `implements` multilínea no se detecta (ya declarado como "solo cabeceras en una línea").
3. Informativa: si una clase anónima tiene `extends` final e `implements` final en la misma línea, se cuentan dos hits en un mismo trial; `hitTrials` cuenta trials, sin impacto en precisión.
4. Informativa: no se mide efecto de la redacción sin LLM (declarado en el informe).

Sin decisiones DEC abiertas ni cambios de alcance/contrato no aprobados.
