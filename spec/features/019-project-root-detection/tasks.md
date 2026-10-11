# 019 — Subtareas vigentes

- [x] **ST-CORE-043 · T-DONE · WI-CORE-036 · HU01, HU03, HU04:** descubrir y persistir `projectRoot` para el único candidato PHP del repositorio; aislar el subtree, congelar `effectiveProjectRoot`, mantener un único Project por repo y no pedir selección en Console. El caso de dos o más candidatos queda sujeto a `DEC-PHP-ROOT-001`.
- [x] **ST-CORE-044 · T-DONE · WI-CORE-037 · HU10, HU11, HU12:** enviar `effectiveProjectRoot` al Sandbox, ejecutar instalación y PHPUnit en el cwd del subproyecto, y materializar artefactos usando paths canónicos relativos al repositorio. Evidencia: `harness/reports/wi-core-037-closure.md`.
