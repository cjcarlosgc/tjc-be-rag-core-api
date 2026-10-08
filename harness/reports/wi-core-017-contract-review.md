# WI-CORE-017 — Revisión contractual
Modelo: contract-reviewer · configurado claude-sonnet-5-5 (solicitado como `sonnet`) · atendido unknown · esfuerzo low. Lanzado como agente de propósito general con el rol y la configuración del perfil `contract-reviewer`, por autorización del usuario; solo lectura.

## Ronda 1 — `CHANGES_REQUESTED`
Dos BLOCKER y cinco MAJOR sobre `2ae20cf`:
1. El binding aún exigía Maintainer en INTEROP §6.8 mientras la matriz decía Writer.
2. SYSTEM-2.6 conservaba la jerarquía de tres roles y los permisos de Maintainer en tres puntos de `DEC-ORG-001/002`.
3. §6.13 seguía marcada «Implementado» incluyendo Writer.
4. El párrafo HU09 «implementado» incluía `scenarioKey`.
5. Los registros Writer no figuraban en la revocación ni en la reverificación.
6. La spec de `014-organizations-access` conservaba la jerarquía antigua.
7. Una prueba existente (`accessible-project.filter.spec.ts`) enumera solo tres roles.
Además, MINOR sobre interfaces duplicadas, autorización y errores de rutas nuevas, tipos de la evidencia, un código de error para razonamiento no soportado, un typo y una lista de operaciones.

## Corrección
Aplicada en `33c1ca7` y `9c8cda8`: binding, evidencia y registros con Writer; marcas «definido, pendiente» y «hasta `WI-CORE-019`»; nota de precedencia de `DEC-ORG-003` sobre la historia; interfaces `*V27Additions`; `422 REASONING_EFFORT_UNSUPPORTED`; tipos y errores enumerados; la prueba citada en `WI-CORE-019`.

## Ronda 2 — `APPROVED`
Los 13 hallazgos constan resueltos; sin contradicciones nuevas. Observación MINOR atendida en `9c8cda8`: línea de estado al inicio de la matriz de §6.13. Compatibilidad: GH-INTEROP-1.2 no cambia y sus hechos de permiso bastan para derivar los cuatro roles. `CS-CORE-20261008-001` es correcto (`breaking: true`, sin cambios para Sandbox).

Reserva declarada por el reviewer: el rol personalizado mapeado por su permiso base depende de que GitHub Integration lo entregue; lo confirma `WI-GH-011`.

## Ronda 3 — `APPROVED`
Tras incorporar las decisiones `DEC-FK-003`, `DEC-FK-004` y `DEC-EXP-004`, enumerar los nueve enlaces, fijar los estados terminales y la lista cerrada de `facts`, y reescribir los criterios de `WI-CORE-007` y `WI-CORE-018` a `WI-CORE-027`, el reviewer verificó coherencia entre decisiones, SYSTEM-2.6, §6.11, §6.5.1, §6.16 y los criterios, sin referencias obsoletas. Tres observaciones MINOR: (a) el detalle de normalización y el mapeo de `scenarioKind` de `DEC-FK-004` queda sujeto a la aprobación explícita del Human Reviewer al cerrar este WI; (b) y (c), de redacción (categorías de pregunta reservadas y el `422` de `DEC-EXP-004`), aplicadas en `3fb84af`. El reviewer no revisó los criterios de `WI-CORE-019`, `022`, `024` ni `026`; los cubrieron las auditorías SDD.
