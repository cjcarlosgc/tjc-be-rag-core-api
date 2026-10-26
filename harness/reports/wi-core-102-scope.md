# WI-CORE-102 — alcance: snapshot con fixtures no-PHP para el Sandbox (C1 del Piloto v2)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Aprobado por el usuario (chat de Core, 2026-10-25):** «Apruebo D-v2-1 a D-v2-6 como los recomienda Core y el alcance de WI-CORE-102→105, incluido el Contract Sync aditivo INTEROP 2.22 a Console. Ábrelos en ese orden, uno a la vez, en feature/jean, sin push ni deploy hasta que yo lo ordene.» D-v2-3 (C1-a, solo Core): extensiones de texto, sin `.env*`, ≤ 500 archivos, ≤ 1 MiB por archivo y ≤ 5 MiB en total, skip-on-failure registrado. Sin push, PR, merge ni deploy hasta que el usuario lo ordene (sustituye a la autorización permanente para este ciclo).

## Problema y evidencia (v1, arch-v1.0 cc3e49d303)
El snapshot que Core envía al Sandbox solo contiene el pool PHP (`isPhpPoolFile`: `.php` no-blade, `composer.json`, `composer.lock`, `phpunit.xml(.dist)`; sin `node_modules .git dist build coverage .next vendor storage cache`). En casbin los tests leen `examples/*.conf|csv` (72 archivos, ~460 KB, ~280 referencias en 13 de 25 archivos de test) → `file_get_contents(/app/examples/rbac_model.conf): No such file`. 5 ✗ en casbin-c1/c2/c3, ambos brazos. Cadena: `GithubSnapshotMaterializerService.materialize` → `zipDirectory` → `persistSnapshot` (`project-versions/<id>/snapshot.zip`) y, en Validation, `analysis-runs/<id>/snapshot.zip`.

## Alcance (D-v2-3, C1-a, solo Core)
- Predicado nuevo `isSandboxSnapshotFile(path)` en `project-versions/indexing.constants.ts`: pool PHP vigente ∪ fixtures de texto. `isPhpPoolFile` / `isPoolFile` NO cambian (índice, FileDiscovery y herramientas del GA siguen igual).
- Fixtures: extensión de texto de una lista cerrada (conf, csv, tsv, json, yml, yaml, xml, ini, txt, neon, sql, dist), en cualquier directorio no ignorado; se excluyen nombres `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` y TODO `.env*` y cualquier ruta con segmento ignorado.
- Topes: ≤ 500 archivos, ≤ 1 MiB por archivo (tras descargar), ≤ 5 MiB en total; orden determinista por ruta; lo omitido (tope, fallo de lectura, UTF-8 no válido) se registra (sin rutas sensibles ni contenido) y NO tumba la materialización (hoy un archivo fallido la tumba para el pool: se conserva ese comportamiento para el pool PHP, pero el fixture degrada a «omitido»).
- Orden de operaciones: los fixtures se bajan DESPUÉS de indexar y justo antes de zipear (persistSnapshot en `snapshot-analysis-job.handler.ts`; zip en `analysis-run-validation-job.handler.ts`), de modo que índice, discovery y herramientas del GA no los ven; solo llegan al Sandbox, mismo zip para ambos brazos, nunca a OpenAI.
- Escritura: texto UTF-8 (lista de extensiones de texto; no binarios).
- Sin cambio de ruta, DTO, enum, ErrorCode, evento, esquema, variable de entorno ni migración; sin cambio en el Sandbox ni en Integration.

## Fuera de alcance
Variante C1-b (tamaño en el árbol, Integration + GH-INTEROP); fixtures en repos empresariales (DEC-VAL-001 PENDING, bloquea ingestión/producción con código empresarial: el piloto usa forks públicos); reintento automático de materialización; cambiar el filtro del índice o del GA.

## Criterios de aceptación
1. El zip de un repo PHP incluye los fixtures de la lista bajo los topes y NO incluye `.env*`, binarios, lockfiles de Node ni rutas ignoradas.
2. Un fixture que falla al leer, supera el tope o excede los totales se omite y se registra; el resto del snapshot se materializa.
3. `isPhpPoolFile`, `isPoolFile`, descubrimiento de archivos, índice y herramientas del agente: sin cambios (pruebas existentes en verde + prueba de no regresión).
4. El conjunto se aplica igual en experimentos (snapshot de análisis) y en Validation (snapshot del Run).
5. Contract Sync sin impacto (snapshot = transporte interno, spec 002:13); lint, build y test en verde; revisión independiente del reviewer.

## CT y specs
CT-06 (aserción nueva: contenido del zip); CT-06-A2/A3 intactas. Specs: 002 (composición del snapshot) y 019:27 (corregir «puede conservar el repositorio completo»), CHANGELOG. 018:134 (las herramientas del agente siguen leyendo solo el pool) y 008 se revisaron y no requieren cambio.

## Riesgos / decisiones aplicables
- DEC-INF-001/002: alcance de datos = repos de demostración/piloto controlados por el usuario (se mantiene: forks públicos).
- DEC-VAL-001 PENDING: no se amplía a repos empresariales; los fixtures ampliarían lo almacenado en Storage cuando se haga.
- Latencia: +N llamadas Core→Integration→GitHub (casbin +72), lotes de 8.
- Material no UTF-8 válido en una extensión de texto → se omite y registra.

## Mitigaciones añadidas tras la revisión independiente (dentro del alcance aprobado: omisión con contadores)
- Guard de relación de compresión: se omite un fixture con ratio > 80 (el Sandbox rechaza el snapshot entero si una entrada supera 100, `safe-archive-extractor.ts`).
- Lista de nombres sensibles: no viajan fixtures cuyo nombre base contenga `auth`, `credential(s)`, `secret(s)` o `service-account` como palabra (p. ej. `auth.json` de Composer).
