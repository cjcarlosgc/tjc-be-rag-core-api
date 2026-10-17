# WI-CORE-063 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Herramienta por `implementer` (claude-haiku-5-5, esfuerzo low) en dos cortes; ejecución del extractor y de la calibración por el leader.
- `node --test harness/calibration/*.test.mjs` 26/26; `node --test harness/*.test.mjs` 31/31 (57 en total con ambos). `validate-harness` pasa. Sin cambios en `app/`, contratos ni migraciones.
- Extracción de solo lectura (`default_transaction_read_only=on`, `statement_timeout`), credencial leída de `app/.env` sin imprimirla; volcados con código de terceros fuera del repositorio (scratchpad); el repo solo recibe código del harness, fixtures sintéticos y este informe con números agregados. Se corrigió un error de tipos `json`/`jsonb` del extractor al ejecutarlo contra la base real.
- Línea base reproduce el SELECTED persistido 10/10 en 9 + 6 casos. Corrección de M6/R-SAME por falsos positivos medidos contra los resultados reales. Riesgo conocido: la URL de la base pasa como argumento de `psql` y es visible en la lista de procesos mientras corre (máquina local).
