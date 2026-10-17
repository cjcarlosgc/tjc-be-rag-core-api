# Consistencia del contrato canónico — WI-CORE-014

**Fecha:** 2026-09-27 16:32 America/Lima
**Contrato:** `spec/contracts/github-integration-contract.md` (`GH-INTEROP-1.2`)

- Core mantiene un único archivo canónico de GitHub Integration; no hay una segunda copia contractual local en Core.
- Las referencias actuales de Core en `spec/README.md`, contratos, constituciones y features apuntan a `GH-INTEROP-1.2`. El contrato público `INTEROP-2.6` y `SYSTEM-2.5` conservan sus versiones y rutas.
- El evento `CS-CORE-20260927-002` solicitará a GitHub Integration y Console sincronizar el archivo canónico completo byte por byte y reconocer la obligación en sus WIs locales.
- La importación/ACK del consumidor y la implementación de GitHub Integration son pasos posteriores; exigir el cierre de Console-008 aquí crearía un ciclo con Core-011. Este gate acredita que Core publicó una fuente canónica internamente consistente y dejó una instrucción verificable para los dos espejos.

No se declara que los espejos de los consumidores ya hayan importado el evento ni que el cambio esté implementado o desplegado.
