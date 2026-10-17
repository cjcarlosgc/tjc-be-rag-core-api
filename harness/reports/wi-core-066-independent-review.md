# WI-CORE-066 — revisión independiente (ciclo 1/2, Modo fuera de casa)
Modelo: reviewer · configurado claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (sin hallazgos bloqueantes; 3 observaciones menores no bloqueantes).

## Alcance y evidencia revisada
Rango `f6fbeeb..HEAD` (código e7f4e0a), reportes técnico y de replay, spec 004, aprobación de alcance. Re-ejecutado: `vitest run src/retrieval src/generation src/project-versions/persistence src/experiments src/context-traces` → 37 archivos pasan, 652 pruebas verdes. No se ejecutó build ni push.

## Puntos críticos
- Ciclos y dedup: `seen` parte con la clase declarante y las directas; A→B→A no reintroduce A; duplicados entre directas de origen distinto: gana la primera. Cubierto por prueba.
- Exclusión interfaz/enum/trait: solo se expanden directas con kind `CLASS` (kind desconocido se omite, conservador) y solo se aceptan declaraciones `CLASS` de profundidad 2. OK.
- Solo con firma: una entrada de profundidad 2 exige constructor con firma extraída; constructor ambiguo (repositorio) se omite. OK.
- Límites: total directas + profundidad 2 ≤ 20 (`remaining`) y ≤ 20 nombres por consulta. OK.
- Best-effort: try/catch alrededor de ambas consultas; `warn` solo con `errorName`; prueba verifica que el mensaje de error no se imprime. Resolutor puro nunca lanza.
- Traza/DTO/INTEROP: `entries` filtra `via === undefined`; `transitiveEntries` no llega al mapeo (lista blanca de `experiment-job.handler.ts` y DTOs sin diff). Sin campo nuevo ni migración.
- Agente generalista: no llama a `phpDependencyContextService.resolve`; la sección solo la renderiza `buildPhp` con `dependencyContext` del brazo RAG.
- Sin inventar: SAME_NAMESPACE/literal solo si el tipo está en `knownTypes` y además `findPhpTypeDeclarations` lo confirma como clase. OK.
- `importsUsed` en `findPhpConstructorDeclarations`: aditivo (campo extra en `select` y en el retorno); pruebas del repositorio actualizadas. OK.
- Convenciones: solo cambia la constante de versión a `.5`; redacción intacta. Sin cambios en ranking/pesos/R-PHP. Sin secretos en el diff.
- Tope 300 tokens: retira primero profundidad 2 desde la última, luego aplica la política vigente. Correcto.

## Observaciones (no bloquean)
1. (Baja) Verificación de cifras: `php-dependency-replay.spec.ts` se omite en este entorno (datos V1 externos ausentes); no pude reproducir 228 tokens / +52 / M5 10/10. Lo respalda la lógica y las pruebas unitarias; conviene que el usuario o el leader lo confirmen en el entorno con los datos.
2. (Baja) `tokenCount` y `truncated` de la traza reflejan ahora la sección completa (incluida profundidad 2, ya retirada o no), aunque las entradas trazadas sean solo directas: un `tokenCount` mayor que la suma visible, o `truncated: true` por retirada de profundidad 2, no es explicable desde la traza. Forma intacta; semántica a documentar o a decidir por Jean junto con la visibilidad de profundidad 2 (ya declarada pendiente).
3. (Baja) Los candidatos se recortan al límite antes de confirmar que son clases concretas: interfaces/enums de profundidad 2 pueden consumir el cupo y desplazar clases válidas cuando hay muchas. Impacto práctico mínimo con el tope de 20 y el tope de tokens.
4. (Informativa) El validador de análisis (`analysis-run-validation-job.handler.ts`) usa el mismo servicio y por tanto también recibe profundidad 2; es coherente con WI-057 (es contexto RAG) pero amplía el efecto más allá del experimento. Sin impacto contractual.
5. (Informativa) `harness/calibration/lib.mjs` figura en los archivos del WI pero no aparece en el diff; los datos de calibración (`deps.json`) citados en el reporte no están en el rango.
