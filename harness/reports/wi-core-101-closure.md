# WI-CORE-101 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: la materialización del snapshot ya no enmascara errores y la limpieza del workspace es best-effort, sin contrato. `materialize` espera a todas las escrituras de cada lote (`Promise.allSettled`) y relanza el primer rechazo real (misma instancia); la utilidad nueva `removeWorkspaceDir` (`app/src/common/`) reintenta el `rm` (`maxRetries: 2`) y nunca lanza (aviso con solo el código de error); `ZipExtractionService` y el `cleanup` de los handlers usan el mismo comportamiento. Sin cambio de ruta, DTO, enum, `ErrorCode`, evento, esquema, variable de entorno ni migración; los handlers no cambian.

- **Verificación (leader):** lint exit 0, build exit 0, `test` completo 3152 pasan y 121 omitidos con 0 fallos (+14 pruebas sobre la base de 3138), validadores del Harness en verde.
- **Revisión independiente (`reviewer`):** APPROVED en el ciclo 1 de 2, sin hallazgos HIGH ni MEDIUM; volver a `Promise.all` falla 5 de 5 veces (determinista); 9 mutaciones propias (6 detectadas, 3 supervivientes que cubrían zip y orden del primer rechazo). 2 LOW aplicados en el cierre: pruebas nuevas (dos rechazos en un lote y spec del zip) con las tres mutaciones ahora detectadas, y `maxRetries` de 3 a 2.
- **No resuelto, declarado:** la causa de fondo del fallo original de la descarga en el smoke de casbin sigue siendo desconocida (estaba enmascarada); a partir de este cambio, un fallo de ese tipo mostrará el error real en el resumen del Run. Sin reintento automático de la materialización (opción C, política).
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
- **Publicación:** PR a `develop` bajo la autorización permanente; el tag `arch-v1.0` no se toca hasta el OK de cross (decisión del usuario).
