# 019 — Detección de projectRoot para aplicaciones PHP

**Estado:** aprobado para candidato único; candidatos PHP múltiples quedan `PENDING` en `DEC-PHP-ROOT-001`.
**Historias:** HU01, HU03, HU04, HU10, HU11, HU12

## Objetivo

Soportar un repositorio GitHub que contiene una aplicación PHP en un subdirectorio sin cambiar la cardinalidad vigente de binding: un repositorio vinculado por Project y un `projectRoot` por Project. Core descubre la raíz de una aplicación PHP desde el snapshot y limita análisis, generación y ejecución a ese subtree. Console no pregunta qué Project debe crearse ni ofrece selección de raíz en este corte; puede mostrar la raíz que Core detectó como dato informativo.

## Decisiones y límites

- Se conserva la regla de `SYSTEM-2.7`: un `repositoryId` solo puede estar vinculado a un Project. No se permiten Projects simultáneos para distintas aplicaciones del mismo repositorio.
- Un Project tiene un único `projectRoot` efectivo. No se mezclan parsers PHP y TypeScript dentro de una `ProjectVersion`.
- El nombre base exacto y case-sensitive `composer.json` en el snapshot lógico es el marcador primario de un candidato PHP, aplicando las exclusiones de archivos/directorios ya definidas en `018-php-laravel-support`; nombres con otra capitalización no son marcadores. `composer.lock`, `artisan`, `phpunit.xml`, `phpunit.xml.dist` y `phpunit/phpunit` solo caracterizan el candidato y no sustituyen al manifiesto ni sirven para puntuarlo.
- Cero candidatos: conservar la detección legacy desde la raíz del repositorio; si ningún stack es compatible, usar la incompatibilidad existente.
- Un candidato: seleccionar automáticamente el directorio que contiene `composer.json`; `.` representa la raíz lógica del repositorio. No se muestra un diálogo de selección en Console.
- Dos o más candidatos: no aplicar ranking/score ni seleccionar por heurística. Console no solicita elegir aplicación o Project. El resultado ejecutable para este subcaso requiere la decisión pendiente `DEC-PHP-ROOT-001`; no bloquea el trabajo de candidato único.
- La detección y clasificación PHP no depende de PHPUnit. Un proyecto PHP sin PHPUnit se reconoce como PHP, pero no es ejecutable por `PHP_LARAVEL_PHPUNIT`.
- `projectRoot` es POSIX, relativo a `repositoryRoot`, normalizado, existente y sin traversal ni escape por symlink. No incluye el wrapper incidental de un ZIP. En PHP, la raíz efectiva contiene el `composer.json` seleccionado.
- Los paths públicos y los paths de artefactos son relativos a la raíz del repositorio, con el prefijo `projectRoot`. El runner puede reexpresarlos respecto al `workingDir` interno sin alterar la ruta canónica.
- La configuración activa de Project conserva durablemente el `projectRoot` vigente; cada `ProjectVersion` conserva durablemente `effectiveProjectRoot` para que cambios posteriores no alteren el significado de ejecuciones históricas. Versiones previas al campo se backfillean con `.` conforme a la semántica histórica de raíz de repositorio. No se prescribe nombre de columna o entidad.
- El Sandbox recibe la raíz efectiva resuelta por Core. Mantiene separado `extractionRoot`, `repositoryRoot` y `projectRoot`; la detección de un único wrapper ZIP solo normaliza empaquetado y nunca se persiste como raíz lógica.
- GitHub Integration conserva y sirve el tree/contenido por SHA; no decide qué subdirectorio es una aplicación ni aplica reglas Composer/PHPUnit.

## Aislamiento PHP y compatibilidad

Para un Project con `projectRoot = sistema-ventas-dn`, el parser, el inventario, la detección PHPUnit, retrieval, generación y exploración de `GENERALIST_AGENT` solo procesan ese subtree. El snapshot puede conservar el repositorio completo para trazabilidad. Los artefactos de test se materializan bajo `sistema-ventas-dn/` y el Sandbox instala dependencias y ejecuta PHPUnit con cwd en el directorio seleccionado.

TypeScript/Jest/Vitest conserva su detección y ejecución legacy, incluso cuando el repositorio contiene un frontend hermano. No se modifica CORS, no se levanta el frontend para ejecutar PHPUnit, no se agrega MySQL al Sandbox y no se modifican repositorios empresariales de validación.

## Validación y piloto

La aceptación técnica debe cubrir raíz `.`, raíz anidada única, frontend hermano ignorado, wrapper ZIP externo, wrapper más raíz PHP anidada, traversal/ruta absoluta inválida, symlink que escape, artefacto dentro del subtree, cwd de Composer/PHPUnit, y preservación de rutas repo-relative. La detección de múltiples manifiestos debe demostrar que no elige por score; el resultado de producto para ese caso queda fuera hasta resolver `DEC-PHP-ROOT-001`.

Los repositorios empresariales `validacion-cursos`, `validacion-ventas` y `validacion-certificados` son insumos de validación reportados por el handoff, no fuentes del contrato ni evidencia local verificada en este corte. No modificarlos ni copiar oráculos, arreglos de tests o este handoff allí. Antes de ejecutar, confirmar permisos, SHA/HEAD congelado, dependencias y el harness real de cada repositorio. El caso de certificados permanece reconocido como PHP sin PHPUnit, temporalmente fuera de la validación ejecutable.

Los tres repositorios controlados y sus nueve targets experimentales se detallan en `008-experimental-comparison`; los oráculos permanecen externos. Las nueve pruebas de piloto no reemplazan ni renumeran `OC01`–`OC15`.

## DEC-PHP-ROOT-001 — Varios candidatos PHP sin selector Console

**Estado:** PENDING
**Blocks:** `spec/features/019-project-root-detection` (solo el subcaso con dos o más `composer.json`; no bloquea candidato único)
**Pregunta:** Cuando un único repositorio vinculado contiene dos o más candidatos `composer.json`, ¿se rechaza el análisis por ambigüedad hasta que cambie la estructura, se admite configuración administrativa de `projectRoot` fuera de Console, o se define otro mecanismo sin crear Projects adicionales ni selección de usuario en Console?

## Fuera de alcance

- Cambiar `RepositoryBinding.repositoryId @unique` o permitir varios Projects por repositorio.
- Pregunta de selección de Project/aplicación o selector de `projectRoot` en Console.
- Cambios a GitHub Integration, CORS, MySQL, Docker público o infraestructura externa.
- Modificación de repositorios empresariales o incorporación de oráculos a repositorios piloto.
- Resolver el tratamiento futuro de proyectos PHP sin PHPUnit.
