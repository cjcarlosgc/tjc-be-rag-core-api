# WI-CORE-010 — revisión independiente

**Veredicto:** `APPROVED`, sin hallazgos.
**Reviewer:** agente `reviewer`, distinto del implementer.

Se verificó que:

- Los casos del validador real cubren evento importado después, exactamente en y antes del `closedAt`; el legado sin marca permanece exigible y una marca malformada no se acepta.
- `contractSyncWasKnownAt()` define el corte temporal estricto y se usa en el validador de completados.
- El import añade la marca solo al inbox del consumidor; la reimportación preserva primera marca y estados ACK/RESOLVED.
- La normalización excluye `consumerImportedAt` y campos locales de lifecycle, pero conserva el payload fuente al calcular el digest.

Comprobaciones revisadas: 12/12 pruebas dirigidas; validadores SDD, work-items, completions y Harness; `git diff --check`. No se detectaron regresiones ni cambios a los snapshots históricos.
