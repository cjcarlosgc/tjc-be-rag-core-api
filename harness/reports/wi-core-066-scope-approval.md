# WI-CORE-066 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): «incluir también la firma del constructor de los tipos que aparecen en los constructores de las dependencias directas (profundidad 2), con el mismo tope de tokens y solo en el brazo RAG; sin tocar ranking, pesos ni R-PHP; prueba rojo→verde y medición en el banco; sin push ni despliegue sin mi orden».

## Evidencia de origen
`WI-CORE-065` (limitación L4 / decisión pendiente): en SUB-1 la firma de `Plan` (`Plan::__construct(public string $code, public float $monthlyPrice)`) no aparece porque `Plan` no es dependencia directa de `RenewalService`; es un tipo del constructor de `Subscription`. La verificación posterior a WI-064 dio `ArgumentCountError` en 4/6 trials RAG por `new Plan(monthlyPrice: …)` sin `$code`.

## Alcance estricto
- Solo profundidad 2 de firmas: partiendo de las dependencias directas ya resueltas, resolver los tipos del constructor de esas dependencias con el mismo resolutor (literal/IMPORT/SAME_NAMESPACE solo si existen en el índice; sin inventar), y agregar su firma (clase concreta con constructor; excluir interfaz/enum/trait; dedup; ciclos; ≤ límite de entradas) en la sección, con origen visible («vía X»), solo en el brazo RAG; mismo tope de 300 tokens con retirada de las firmas de mayor profundidad primero.
- Sin campo nuevo en la traza ni contrato; versión del prompt `php-prompt-2026-10-14.5`.
- Fuera de alcance (candidatos en backlog, NO aprobados): cambios en la redacción de las convenciones, refuerzo de «extends/implements», regla `implements` en R-ANON-FINAL, profundidad > 2, y DEC-RAG-001.
- Medición en `harness/calibration`: M5 top-10 idéntico (V1 + verificaciones), M4 tokens extra por caso (informar truncado), M1/R-SIG con la firma de `Plan` presente, reglas existentes sin regresión. Revisión independiente (Modo fuera de casa). Sin push/deploy/DB real.
