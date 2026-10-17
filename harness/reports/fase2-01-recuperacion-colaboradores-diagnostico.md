# Fase 2 · #1 — Diagnóstico de recuperación de colaboradores (solo lectura)

Fecha: 2026-10-13. Origen: handoff Cross `HANDOFF_FASE2_01_RECUPERACION_COLABORADORES.md`. Alcance: diagnóstico y propuesta; **no se implementó nada**, sin producción/Render, sin push; el piloto V1 (evidencia congelada) no se re-ejecuta. Datos: SELECT de solo lectura sobre la base real (`context_traces`, `code_chunks`, `test_targets`, `experiment_runs`); lógica del código en `app/src/retrieval/`. Los 9 experimentos oficiales: SAL-1 `3c3c309d`, SAL-2 `066e935c`, SAL-3 `c354950c`, RES-1 `99bce66e`, RES-2 `6d15550d`, RES-3 `7b430bfd`, SUB-1 `5c830a18`, SUB-2 `434491f3`, SUB-3 `ac67c712`.

## 1. Respuesta directa (SUB-1 y SUB-2)

1. **¿`RenewalDatePolicy` fue recuperada?** Sí, pero **descartada**. Está en el top-20 semántico y aparece como candidata en las 3 repeticiones de ambos experimentos:

   | Exp | chunk | rank | semanticScore | structuralMatch | combinedScore | decision | discardReason |
   |---|---|---|---|---|---|---|---|
   | SUB-1 | `RenewalDatePolicy` (clase, 163 tok) | 15 | 0.4609 | ninguno | 0.3226 | DISCARDED | TOP_K_LIMIT |
   | SUB-2 | `RenewalDatePolicy` (clase, 163 tok) | 15 | 0.4788 | ninguno | 0.3352 | DISCARDED | TOP_K_LIMIT |

   Su método `nextDate` no llegó a candidato por semántica (no estaba en el top-20); los tests `RenewalDatePolicyTest` sí (ranks 16-17, también descartados). Configuración efectiva: `topK=10`, `semanticWeight=0.7`, `structuralWeight=0.3`, `maxContextTokens=8000` (el presupuesto no intervino: 797/775 tokens).

2. **¿Qué relaciones R-PHP1..R-PHP5 aplican entre `RenewalService` y `RenewalDatePolicy`? Ninguna**, y por una limitación de lo que el código considera "el target", no por un bug aislado:
   - El ancla es el **chunk del método `renew`** (`retrieval.service.ts:classifyPhpRelation`). Su `importsUsed` es solo `{Subscription, SubscriptionStatus}` y su cuerpo usa `$this->dates->nextDate(...)`: el nombre del tipo `RenewalDatePolicy` **solo aparece en el constructor** (`private RenewalDatePolicy $dates`), que es otro chunk.
   - R-PHP1 IMPORTS: exige que O(K) esté en `importsUsed` del ancla; una clase del mismo namespace no tiene `use`, por lo que nunca está.
   - R-PHP3 SAME_NAMESPACE: sí comparte namespace (`Pilot\Subscriptions\Services`), pero exige que el **contenido del ancla** mencione el nombre corto como palabra completa; el cuerpo de `renew` no lo hace (usa la propiedad `$dates`).
   - R-PHP4 (FQN con `\`) y R-PHP2 (IMPORTED_BY) no aplican; R-PHP5 solo marca la clase declarante (`RenewalService`, rank 1).
   - Mismo patrón para las otras dos dependencias inyectadas por constructor: `PaymentGateway` y `SubscriptionRepository` (importadas en la clase, pero el método `renew` no las lista); quedaron en ranks 11-14 solo por semántica.

3. **¿Qué ocupó el top-10?** Sin relación estructural, `RenewalDatePolicy` compite con `0.7·semántico`; en cambio las 8 piezas de `Subscription` (clase + 7 miembros) y `SubscriptionStatus` reciben `+0.3` por **R-PHP1 IMPORTS** (el método importa `Subscription`/`SubscriptionStatus`), con scores 0.60–0.78. Top-10 de SUB-1 (rank → score): 1 `RenewalService` (clase, DECLARING_CLASS, 0.8312); 2 `Subscription` (0.7826); 3 `renewAt` (0.7240); 4 `handleFailedPayment` (0.6643); 5 `status` (0.6391); 6 `Subscription.constructor` (0.6330); 7 `schedulePlanChange` (0.6045); 8 `applyPendingPlan` (0.6026); 9 `SubscriptionStatus` (0.5897); 10 `SubscriptionRepository::save` (0.4539, solo semántico). Es decir, **8/10 plazas** para miembros de `Subscription`/`SubscriptionStatus`, ninguna para los tres colaboradores inyectados.

4. **Por qué el LLM inventó `Contracts\RenewalDatePolicy`:** el chunk de la clase `RenewalService` (seleccionado, 141/130 tokens) sí contiene el constructor con `RenewalDatePolicy $dates`, pero sin namespace ni `use` (mismo namespace); las otras dos dependencias del mismo constructor viven en `Contracts\` (`PaymentGateway`, `SubscriptionRepository`) y el LLM extrapoló. Sin el chunk `RenewalDatePolicy` en contexto no tuvo el FQCN. El agente, que lee el archivo, falló 2/6 por otra causa (mock de clase `final`).

## 2. Colaboradores por caso (los 9) y si entraron al contexto

Colaboradores = tipos del constructor de la clase declarante, de la firma del método y de `new X` en el cuerpo. "Tipo presente" = el chunk de la **clase/interfaz** está en el top-10 (línea base real, reproducida exactamente).

| Caso | Target | Colaboradores | Presentes (tipo) | Faltan |
|---|---|---|---|---|
| SAL-1 | `DiscountPolicy::discountFor` | `Customer`, `Promotion` | ambos (rank 5 y 2) | — |
| SAL-2 | `DiscountCalculator::applyPercentage` | ninguno | n/a | — |
| SAL-3 | `OrderLine::total` | ninguno (usa solo propiedades) | n/a | — |
| RES-1 / RES-2 | `AvailabilityService::canReserve` | `ReservationRepository`, `ReservationPeriod`, `Resource` | los 3 (ranks 5, 4, 3) | — |
| RES-3 | `CancellationPolicy::refundAmount` | ninguno (solo `DateTimeImmutable`) | n/a | — |
| SUB-1 / SUB-2 | `RenewalService::renew` | `PaymentGateway`, `SubscriptionRepository`, `Subscription`, `RenewalDatePolicy` | solo `Subscription` | **`PaymentGateway`, `SubscriptionRepository` (solo el miembro `save`), `RenewalDatePolicy`** |
| SUB-3 | `Subscription::applyPendingPlan` | `Plan`, `SubscriptionStatus` | `Plan` | `SubscriptionStatus` (tipo del constructor; el cuerpo no lo usa, relevancia baja) |

Conclusión: el problema **solo se manifiesta con servicios que reciben dependencias por constructor y las usan vía propiedad** (SUB-1/SUB-2). En SAL y RES los colaboradores entraron porque el método tiene `use`/firma tipada con ellos (R-PHP1) o por similitud. Es un patrón típico de servicios de dominio con inyección; probable en proyectos reales.

## 3. Causa raíz

Dos causas combinadas, ninguna es un fallo de implementación respecto de la especificación vigente:

- **C1 — Alcance de "el target":** las relaciones R-PHP1/R-PHP3 se evalúan solo contra el chunk del método ancla; las dependencias inyectadas por constructor (tipos del constructor y propiedades) son invisibles. La implementación coincide con DEC-PHP-RET-001 (R-PHP3: "el target menciona el nombre corto"); es una **limitación de la especificación**, no un bug.
- **C2 — Inflación por miembro:** R-PHP1 etiqueta **cada chunk** (clase y todos sus métodos) de una clase importada; una sola clase importada ocupa hasta 8 de las 10 plazas, y desplaza candidatas relevantes con semántica media.

## 4. Replay offline (aceptación) — resultados

Reproducción: `harness/reports/fase2-01-replay-colaboradores.py` (reimplementa `classifyPhpRelation` y el score `0.7·sem + 0.3·estructural`; usa los `semanticScore` persistidos del top-20 de la repetición 1 y todos los chunks de la versión). **Validación: la línea base reproduce exactamente el top-10 real en los 9 casos** (conjunto idéntico). Variantes simuladas (solo estructura; sin LLM; los puntajes semánticos son los reales):

- **V1 (corrige C1):** el ancla incluye además el constructor de la clase declarante (su contenido y sus `importsUsed`) para R-PHP1/R-PHP3.
- **V2 (V1 + corrige C2):** además, IMPORTS/SAME_NAMESPACE solo etiquetan el chunk del tipo y los miembros cuyo nombre aparece en el target.

| Caso | Base | V1 | V2 |
|---|---|---|---|
| SUB-1 | `RenewalDatePolicy` rank 15; faltan 3 colaboradores | `PaymentGateway` y `SubscriptionRepository` entran (ranks 8 y 5); **`RenewalDatePolicy` rank 11 (sigue fuera)** | **los 4 colaboradores presentes** (`RenewalDatePolicy` rank 9); sale `handleFailedPayment`, `constructor`, `schedulePlanChange`, `SubscriptionStatus`; tokens 595→675 |
| SUB-2 | rank 15 | `RenewalDatePolicy` rank 11 | **los 4 presentes** (rank 9); tokens 584→664 |
| SUB-3 | falta `SubscriptionStatus` | `SubscriptionStatus` rank 11 (fuera) | `SubscriptionStatus` entra (rank 10), sale `Plan.constructor` |
| SAL-1/2/3, RES-3 | — | sin cambios, salvo SAL-3: gana `Order`, pierde `TaxPolicy` (**falso positivo**: `\bOrder\b` coincide con la cadena literal "Order line quantity must be positive." del constructor) | SAL-3 igual |
| RES-1/2 | 3/3 tipos presentes | 3/3 (reordenados) | 3/3; pierde miembros `Resource.constructor`, `durationMinutes`; gana `Reservation.constructor` y un test de humo |

Lectura: **corregir solo C1 (V1) no basta** para el caso que motivó el trabajo; hace falta limitar la inflación (V2). V2 no pierde ningún **tipo** colaborador en los 9 casos; cambia qué miembros acompañan.

## 5. Propuesta (sin implementar) y decisiones

- **Cambio mínimo recomendado = V1 + V2**, ambos dentro de SE (semántico + R-PHP1..5, 0.7/0.3, top-10), sin cambiar pesos ni K:
  1. R-PHP1/R-PHP3: el ancla es método + constructor de la clase declarante (tipos inyectados), y R-PHP3 debe **ignorar literales de cadena y comentarios** al buscar el nombre corto (evita el falso positivo de SAL-3).
  2. IMPORTS/SAME_NAMESPACE: etiquetar el chunk del tipo y solo los miembros referenciados por nombre en el target (en vez de todos los miembros).
- **Decisión de Jean (DEC-RAG-001, PENDING):** ambos puntos alteran qué chunks reciben la señal estructural, es decir, el ranking de la tesis (OE2 SE vs SEM y comparabilidad con el piloto V1). Hay que decidir si se aplica como corrección a la especificación de R-PHP1/R-PHP3 (con enmienda del contrato/spec 005/008 y registro en CHANGELOG) o si se reserva para una versión V2 del experimento. No lo apruebo yo.
- **Alternativa de menor riesgo (no toca ranking):** enriquecer el *formato* del contexto con una sección "dependencias del target" con los FQCN de los tipos del constructor (de AST), de modo que el LLM no tenga que inferir el namespace. Evitaría el `UnknownTypeException` sin mover el top-10, pero no entrega el código del colaborador (no evita mocks de clases `final`).
- **Prueba de aceptación propuesta:** (a) spec de `RetrievalService`/`ContextBuilder` con un fixture PHP tipo `RenewalService` (dependencia inyectada del mismo namespace, no nombrada en el método) que exija el tipo en el top-10; (b) replay offline automatizado sobre los 9 casos: `RenewalDatePolicy` seleccionada en SUB-1/SUB-2 y ningún tipo colaborador de la línea base perdido; (c) regresión TypeScript sin cambio.
- **Estimación:** 1 WI, ~1 jornada (retrieval + pruebas + replay) más revisión independiente; contrato público sin cambio (matchedVia/structuralMatch ya existen).

## 6. Riesgos y límites

- **Efecto en OE2:** cualquier cambio en SE altera la comparación SE vs SEM; SEM no cambia. Habría que declarar la versión de recuperación en el paper.
- **Tokens:** +80–90 tokens en SUB-1/SUB-2 (V2), sin riesgo de presupuesto (8 000).
- **Trazas congeladas:** no se modifican; toda medición posterior es versión nueva.
- **Límites del replay:** simulación estructural con el puntaje semántico persistido del top-20 (fijo); no mide calidad de las pruebas generadas ni llama al LLM; heurística de "miembro referenciado" por nombre (puede dar falsos positivos con nombres comunes como `status`); n=9 casos de 2 proyectos piloto.
- **Qué NO prueba:** que el LLM generaría pruebas válidas con el contexto V2; solo que el colaborador entra al contexto.

Modelo: Claude Sonnet 5.5 (informe de diagnóstico, sin cambios en `app/`).
