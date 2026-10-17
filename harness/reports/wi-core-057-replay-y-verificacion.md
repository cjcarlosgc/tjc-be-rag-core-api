# WI-CORE-057 — replay offline de los 9 casos del piloto V1 y criterio de verificación
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Replay (offline, sin LLM, sin DB)
`app/src/retrieval/php-dependency-replay.spec.ts` (se omite sin `PHP_DEP_REPLAY_DIR`): para cada caso reconstruye el `RetrievalResult` con los candidatos y puntajes persistidos (`cands.json`), ejecuta el `ContextBuilder` real con y sin la sección y el `PhpDependencyContextService` real (repositorio falso con los chunks del caso). **Resultado: 9/9 casos con `relatedChunks`, `audit.candidates` (decisión, rank, puntaje), `contextTokens`, `selectedChunks` y `retrievedChunks` idénticos con y sin sección, y el conjunto SELECTED reproduce el persistido: el top-10 no cambia.**

| Caso | Target | Entradas | Tokens sección | contextTokens base | Extra |
|---|---|---|---|---|---|
| SAL-1 | `DiscountPolicy::discountFor` | `Customer`, `Promotion` (firma, IMPORT) | 51 | 517 | 9.9 % |
| SAL-2 | `DiscountCalculator::applyPercentage` | — | 0 | 457 | 0 % |
| SAL-3 | `OrderLine::total` | — | 0 | 478 | 0 % |
| RES-1 | `AvailabilityService::canReserve` | `ReservationRepository` (constructor), `Resource`, `ReservationPeriod` | 64 | 444 | 14.4 % |
| RES-2 | `AvailabilityService::canReserve` | igual que RES-1 | 64 | 448 | 14.3 % |
| RES-3 | `CancellationPolicy::refundAmount` | — (solo `DateTimeImmutable`, global) | 0 | 654 | 0 % |
| SUB-1 | `RenewalService::renew` | `PaymentGateway`, `SubscriptionRepository` (Contracts), **`RenewalDatePolicy` → `Pilot\Subscriptions\Services\RenewalDatePolicy` (SAME_NAMESPACE)**, `Subscription` | 91 | 700 | 13.0 % |
| SUB-2 | `RenewalService::renew` | igual que SUB-1 | 91 | 678 | 13.4 % |
| SUB-3 | `Subscription::applyPendingPlan` | `Plan`, `SubscriptionStatus` (SAME_NAMESPACE) | 53 | 647 | 8.2 % |

Tokens extra: 0 a 91 por caso (hasta 14.4 % del contexto base; el tope es 300). En SUB-1/SUB-2 no existe ninguna entrada `Pilot\Subscriptions\Contracts\RenewalDatePolicy`: el nombre inventado por el LLM queda contradicho por el nombre correcto en el prompt.

Límites: `knownTypes` del replay sale de los chunks del caso (en producción, de toda la versión); las entradas IMPORT valen por el `use` del código, no por el índice; el replay no mide si el LLM genera pruebas válidas.

## Criterio de verificación para SUB-1/SUB-2 tras el despliegue (experimento no oficial)
1. Traza RAG del experimento (`GET /context-traces/{traceId}`): `dependencyContext` presente con `RenewalDatePolicy → Pilot\Subscriptions\Services\RenewalDatePolicy` (`resolvedBy: SAME_NAMESPACE`, `origin: CONSTRUCTOR`), `PaymentGateway`/`SubscriptionRepository` bajo `Contracts`, `unresolvedCount: 0`, `tokenCount` ≈ 91 y `truncated: false`.
2. `contextTokens`, `selectedChunks`, `retrievedChunks`, candidatos y `configuration` iguales a los del piloto V1 (top-10 sin cambio).
3. Prueba generada: el `use`/namespace de `RenewalDatePolicy` es `Pilot\Subscriptions\Services\RenewalDatePolicy`; ya no aparece `Pilot\Subscriptions\Contracts\RenewalDatePolicy` ni `UnknownTypeException` por ese tipo (evidencia privada de `WI-CORE-053`, `testContent`).
4. Declarar que los resultados son de la versión «RAG-PHP con sección de dependencias» y no comparables con el piloto V1 congelado.
