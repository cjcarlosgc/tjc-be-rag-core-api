# Publicación Contract Sync — CS-CORE-20260927-002

- **WI productor:** WI-CORE-014.
- **Consumidores:** GitHub Integration y Developer Console.
- **Contrato:** `spec/contracts/github-integration-contract.md` (`GH-INTEROP-1.2`).
- **Commit fuente:** `40a93bead66e7eac15f515065ec204e3526b78df`.
- **Estado al publicar:** `C-PENDING`.
- **Cambio:** `pullRequest.createdAt` transporta el instante de creación original validado o `null`; la lectura histórica solo devuelve `OK` con fecha verificable y usa `UNVERIFIABLE` sin valor parcial en otro caso. Core no usa `receivedAt` como sustituto y mantiene los Runs afectados ocultos durante la recuperación durable.
- **Acción solicitada:** importar y espejar byte por byte el contrato canónico; reconocer la obligación en un WI del consumidor antes de implementar o declarar disponibilidad.

El evento se publica en el outbox Core. La importación/ACK, la implementación de GitHub Integration y el uso por Console siguen pendientes en sus repositorios. No se cambió otro repositorio ni se hizo push, PR, merge o despliegue.
