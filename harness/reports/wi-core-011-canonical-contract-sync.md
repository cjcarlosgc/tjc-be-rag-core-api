# Contratos canónicos — WI-CORE-011

**Resultado:** `G-PASSED`
**Commit fuente:** `a99b3c315738966d956e9cb08833b2c42a7c85e5`

El comportamiento aprobado quedó consolidado en los contratos canónicos de Core:

- `spec/contracts/system-contract.md`: elegibilidad por fecha de creación original, retención/ocultamiento de Runs históricos y recuperación durable.
- `spec/contracts/interoperability-contract.md` (INTEROP-2.6): regla `pullRequest.createdAt >= RepositoryBinding.createdAt`, recuperación cuando la fecha no es verificable y filtrado de Runs antes de paginar.

La revisión contractual está registrada en `wi-core-011-contract-review.md`. El evento `CS-CORE-20260927-003` publica el espejo dirigido a Console; su importación y el WI consumidor siguen su propio ciclo y no son condición de cierre del productor Core.
