# WI-CORE-093 — análisis de viabilidad de un extractor de evidencia de solo lectura (FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** pedido de `[TN]-Cross` (2026-10-24), que relaya una idea del usuario: las «brechas de exportes» del runbook (prueba generada, salida completa de Composer/PHPUnit, logs) no necesitan un botón nuevo si la evidencia se extrae de la base con una sesión de Claude Code (la BD de desarrollo está autorizada), lo que evita funcionalidad nueva y la dependencia del tag `arch-v1.0`. Pide primero **qué de eso existe hoy en BD/almacenamiento y qué NO se persiste** (lo no persistido sería funcionalidad nueva y va después del tag) y, si es viable, un WI para un **extractor de solo lectura**: script versionado, fuera del producto (sin endpoints ni DTO nuevos), que dado un AnalysisRun y/o ExperimentRun escriba un paquete JSON/CSV con el test generado por repetición, la salida completa de Composer/PHPUnit y logs si están persistidos, el `modelConfig`, el trace de 9 enlaces con el chequeo inverso, hashes SHA-256 y los campos automáticos del registro de evidencia (Tabla 70). Solo SELECT, sin secretos en la salida. Aparte, los proyectos empresariales de la validación final (`Tesis-Validacion`) no se tocan.

## Alcance de este WI (solo análisis)

Informe `harness/reports/extractor-evidencia-analisis.md`: (1) inventario verificado en el esquema de Prisma, las migraciones y el código de qué se persiste (tablas, columnas, buckets del almacenamiento de objetos) para cada elemento pedido, y qué NO se persiste o se trunca; (2) viabilidad de cada pieza del extractor solo con SELECT y lectura del almacenamiento, incluido el chequeo inverso del trace y los hashes; (3) propuesta de WI (alcance, ubicación del script y si cuenta como cambio del repositorio, forma de conexión sin exponer secretos, formato del paquete, criterios de aceptación, aprobaciones del usuario, relación con el tag). No se escribe el extractor, no se lee `.env`, no se consulta la base real en este análisis (cualquier afirmación que dependa de datos reales se marca ⚠), no se toca código, contratos ni otros repositorios.

## Criterios

Cada afirmación cita tabla/columna o archivo:línea; se distingue «persistido» de «calculable» y de «no existe»; revisión independiente del `reviewer`; sin secretos.
