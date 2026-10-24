# WI-CORE-095 — runbook operativo de los pilotos, versión 2 (FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** pedido de `[TN]-Cross` (2026-10-24) tras el smoke del Sandbox (WI-SANDBOX-021, `tjc-be-test-execution-sandbox/harness/reports/wi-sandbox-021-smoke-evidence.md`): imagen PHP ampliada (intl, gd, zip, bcmath, gmp; ICU 76.1; PHP 8.3.36; `memory_limit` 512M), money PASA (1060 tests), orm PASA (3686 tests; con `memory_limit` 128M fallaba), Vouchers NO APTO (37 errores «no such table»; su CI corre `testbench migrate:fresh`, `testbench.yaml` fuerza pgsql y con SQLite las migraciones fallan; `pdo_pgsql` no lo arregla). El usuario decide si se sustituye P3; **no se da por descartado**. Además: aviso de despertar Integration y Core con `/health` antes de cada sesión y de cada PR, y §3.f reemplazada por el handoff de cross (estructura de carpetas, identificadores `EV-OE5-xxx` y sellado SHA-256). Sustituye la versión de WI-CORE-092.

## Alcance

Reemplazar `harness/reports/pilotos-runbook-operativo.md` por la versión 2: (a) §0 y §1.2 sin «money bloqueado por intl» ni «faltan extensiones» (imagen nueva, ICU 76.1, PHP 8.3.36, `memory_limit` 512M); (b) resultados del smoke de money y orm con fuente; (c) Vouchers «NO APTO según el smoke, EN REVISIÓN» y qué no debe hacer el operador; (d) aviso `GET /health` de Integration y Core antes de cada sesión y de cada PR (§0 y §2.a); (e) §3.f remite al handoff de cross; (f) checklist de smoke con la imagen nueva, §4 y glosario coherentes. Todo ✔/⚠ honesto: lo que sale del informe del Sandbox es ✔ citando el archivo; lo que solo se confirma ejecutando es ⚠ (en particular, que la imagen nueva esté desplegada en la VM).

## Fuera de alcance

Ejecutar el smoke, desplegar la imagen, decidir sobre P3, definir la estructura de evidencias (la define el handoff de cross), cambios en código, contratos, `.env`, tesis u otros repositorios; push por petición de cross (se publica con el siguiente lote bajo la autorización permanente del usuario).

## Criterios

El documento v2 cumple los cambios (a)–(f) con citas verificables; revisión independiente del `reviewer` contra el informe del Sandbox, su Dockerfile y el código; sin secretos; se entrega a cross la ruta.
