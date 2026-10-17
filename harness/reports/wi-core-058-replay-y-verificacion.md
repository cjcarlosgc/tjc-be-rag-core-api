# WI-CORE-058 — replay offline de los 9 casos y criterio de verificación
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## Replay (offline, sin LLM, sin DB)
`app/src/retrieval/php-dependency-replay.spec.ts` (se omite sin `PHP_DEP_REPLAY_DIR`): `ContextBuilder` y `PhpDependencyContextService` reales con un repositorio falso que sirve los chunks del caso (incluido `findPhpTypeDeclarations`). **Resultado: 9/9 casos con `relatedChunks`, `audit.candidates` (decisión, rank, puntaje), `contextTokens`, `selectedChunks` y `retrievedChunks` idénticos con y sin sección, y SELECTED = persistido: el top-10 no cambia.**

| Caso | Target | Entradas (con marca `final`) | Tokens sección | Sin marcas | Extra por marcas | contextTokens base | % sobre base |
|---|---|---|---|---|---|---|---|
| SUB-1 | `RenewalService::renew` | 4 (`RenewalDatePolicy`, `Subscription` final; `PaymentGateway`, `SubscriptionRepository` interfaces sin marca) | 139 | 91 | 48 | 700 | 19.9 % |
| SUB-2 | `RenewalService::renew` | igual que SUB-1 | 139 | 91 | 48 | 678 | 20.5 % |
| SUB-3 | `Subscription::applyPendingPlan` | 2 (`Plan` final; `SubscriptionStatus` enum final) | 101 | 53 | 48 | 647 | 15.6 % |
| SAL-1 | `DiscountPolicy::discountFor` | 2 (`Customer`, `Promotion` final) | 99 | 51 | 48 | 517 | 19.1 % |
| SAL-2 | `DiscountCalculator::applyPercentage` | 0 | 0 | 0 | 0 | 457 | 0 % |
| SAL-3 | `OrderLine::total` | 0 | 0 | 0 | 0 | 478 | 0 % |
| RES-1 | `AvailabilityService::canReserve` | 3 (`Resource`, `ReservationPeriod` final; `ReservationRepository` interfaz sin marca) | 112 | 64 | 48 | 444 | 25.2 % |
| RES-2 | `AvailabilityService::canReserve` | igual que RES-1 | 112 | 64 | 48 | 448 | 25.0 % |
| RES-3 | `CancellationPolicy::refundAmount` | 0 | 0 | 0 | 0 | 654 | 0 % |

Cada marca añade 24 tokens (48 en los casos con dos marcas); todas las secciones quedan por debajo del tope de 300. En el piloto V1 casi todas las clases concretas son `final` (estilo del fixture): el marcador diferencia las interfaces mockeables de las clases que no lo son.

Límites: el replay no mide si el LLM genera pruebas válidas con la marca; tipos de `vendor/` o fuera del índice no se marcan (no se afirma); un FQCN con dos declaraciones en el índice no se distingue (el repositorio devuelve una fila por nombre).

## Criterio de verificación para SUB-1/SUB-2 tras el despliegue (experimento no oficial)
1. Traza RAG (`GET /context-traces/{traceId}`): `dependencyContext.entries` con `RenewalDatePolicy` y `Subscription` con `final: true`; `PaymentGateway` y `SubscriptionRepository` sin `final`; `tokenCount` ≈ 139 y `truncated: false`.
2. `contextTokens`, `selectedChunks`, `retrievedChunks`, candidatos y `configuration` iguales a los de `WI-CORE-057` (top-10 sin cambio).
3. La prueba generada no usa `createMock`/`createStub`/`getMockBuilder` sobre `RenewalDatePolicy` ni sobre `Subscription`: usa `new` (o el tipo real) y mockea solo las interfaces; ya no aparece `ClassIsFinalException` por esos tipos (evidencia privada de `WI-CORE-053`, `testContent`; `errorSummary` de la repetición).
4. Comparar con los experimentos `951a7bb2` y `656140e5` (3/5 fallos RAG y 2/4 del agente por `ClassIsFinalException`); el agente generalista no recibe la sección: su comportamiento no debe cambiar, y debe anotarse la versión «RAG-PHP con dependencias y marca final».
