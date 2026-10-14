# WI-CORE-065 — revisión independiente (ciclo 1/2, Modo fuera de casa)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (sin hallazgos bloqueantes). Rango revisado: `c7d9436..ef3e24f`. Sin push ni build.

## Verificaciones
1. **Alcance:** el diff coincide con `wi-core-065-scope-approval.md`: firma del constructor solo en la sección de dependencias del brazo RAG; dos convenciones comunes; versión `.4`. Archivos fuera de `app/src`, `harness/` y `spec/`: ninguno. Sin cambios en otros repositorios, sin migraciones, sin secretos (solo literales de prueba como `$secret`/`secret db detail`).
2. **Igualdad de redacción:** `PHP_PHPUNIT_CONVENTION_LINES` (único módulo) alimenta a RAG y agente; pruebas existentes fijan 5 líneas y versión `.4`. TypeScript sin cambio. El agente no recibe la sección.
3. **No interferencia:** `php-dependency-replay.spec.ts` con los datos del replay: 9/9. `calibrate.mjs` sobre 9 casos V1 y 11 experimentos: todos «OK linea base», M5 10/10. Sin cambios en ranking, pesos, topK ni R-PHP.
4. **Cifras (recalculadas con `calibrate.mjs`):** extra de firmas SAL-1 24, RES-1/2 33, SUB-1/2 37, SUB-3 13, resto 0; sección 123/145/176/114 (coincide con el informe); +70 de convenciones; total 70–107 tokens; sección ≤ 300. M6: R-ANON-FINAL 2/2 (P 1,0, S 1,0), R-STATIC-THIS 2/2 (1,0/1,0), R-SIG 6 trials con hit, 5 con evidencia (P 0,83, S 1,0), R-FINAL 13/13, R-SAME 1/3, R-NS P 0,17: coinciden con el informe. Las reglas nuevas no se activan en los 9 casos V1 (declarado correctamente).
5. **Pruebas:** `vitest run` de retrieval, generation, context-traces, experiments y project-versions: 47 archivos pasan, 702 pruebas OK (13 omitidas); `node --test harness/calibration/*.test.mjs`: 33/33.
6. **Límites del código:** consulta de repositorio best-effort (try/catch, sin filtrar el mensaje de error, mapa vacío ante fallo); tope `MAX_CONSTRUCTOR_LOOKUPS = 20`; excluye INTERFACE/ENUM/TRAIT cuando el índice los conoce; ambigüedad (constructor en más de un archivo) se omite; `partIndex: 1`; el tope de 300 tokens retira firmas desde la última entrada y marca `truncated`, luego entradas. La traza expuesta usa lista blanca (`context-traces.service.ts:635`) y la prueba confirma que `signature` no sale; sin cambio de contrato. `signature` sí queda en el detalle persistido interno (aceptable, no es contrato).
7. **Spec 004:** nueva sección coherente con la implementación y las cifras; declara la limitación de profundidad 1 y que no es comparable con `.3`.

## Hallazgos (todos menores, no bloquean)
- **L1 (bajo):** `CONSTRUCTOR_PATTERN` toma la primera ocurrencia de `function __construct(`; si el docblock previo del chunk citara literalmente esa cadena podría leerse una firma errónea. Muy improbable; se puede anclar a código fuera de comentarios en un WI futuro.
- **L2 (bajo):** heredoc/nowdoc en valores por defecto no se tratan como cadena (en PHP no son válidos en parámetros antes de 8.x constantes, por lo que el riesgo es nulo en la práctica).
- **L3 (informativo):** redundancia textual `(constructor) — constructor(...)` ya declarada y medida; el efecto real sobre el LLM no se mide sin experimento (el criterio de verificación del informe es adecuado).
- **L4 (informativo):** la ausencia de firma en tipos fuera de la sección (p. ej. `Plan` en SUB-1) queda documentada como limitación; el efecto sobre `ArgumentCountError` puede ser parcial.

## Estado
Sin `DECISION_REQUIRED`. El WI puede pasar a la aprobación/cierre según el flujo; push sigue requiriendo orden explícita del usuario y revisión del rango completo del sprint.
