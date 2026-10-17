# Tarjeta de estado Cross — decisiones y gates pendientes

**Corte:** 2026-10-12, America/Lima
**Estado:** verificado contra Harness y reportes propietarios al 2026-10-12. Core importó/acknowledged el correctivo autorizado; Integration tiene revisión final aprobada para `origin/feature/jean..bdb5754` y no tiene gap de código para el E2E local. Core `WI-CORE-042` está comprometido localmente en `0c2e65d`. Sandbox `WI-SANDBOX-002` está `DONE`, con revisión independiente `APPROVED`, 194 pruebas unitarias y 21/21 E2E Docker verdes. Los health checks locales de Core (`:3000/health`) y Sandbox (`:3001/health/ready`) responden 200; aún falta ejecutar un smoke cruzado Core→Sandbox. No hubo push, PR ni cambios de infraestructura.

Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Ya resuelto

- Core `WI-CORE-037` y Sandbox `WI-SANDBOX-001`: `projectRoot` está implementado; `INTEROP-2.8` coincide. No hace falta otro corte para esa función.
- WIs existentes para la validación PHP local: Core `WI-CORE-012`, `013`, `033`, `036`, `037` y `041`, más Sandbox `WI-SANDBOX-001`/`002`, constan cerrados y aprobados. Para E2E de experimentos OE5 se suman Core `WI-CORE-029`, `035` y `042`. Son cortes locales ya completados; ninguno autoriza GCE.
- Core `WI-CORE-040` decidió instancia única para GitHub Integration; no se requiere PostgreSQL de coordinación. `WI-GH-012` está `W-DONE` en el checkout de Integration y sus tres espejos coinciden con Core.
- Console `WI-CONSOLE-022`, `023` y `024` están `W-DONE`; Console está limpio y sincronizado con `origin/feature/jean` en `15ea1a4`. No necesita un cambio de UI para `projectRoot` ni para Evidence v1 actual.
- Core `WI-CORE-041` está cerrado y publicado. `WI-CORE-042` figura `W-DONE` en el commit local `0c2e65d`; no se ha publicado.
- Integration creó `CS-GH-20261011-003` en `1c32c2c`, con el SHA completo de `e9de71d`; Core lo importó y dejó `C-ACKNOWLEDGED` bajo `WI-CORE-040`. La revisión final de `origin/feature/jean..bdb5754` quedó `APPROVED`; el histórico `CS-GH-20260926-001` permanece fuera del rango e intacto, y `CS-GH-20261011-002` también permanece intacto. Nada se publicó.

## Gates activos y próximo corte local

### Smoke local Core→Sandbox

Sandbox ya cerró `WI-SANDBOX-002`: gates SDD, implementación, revisión independiente, checks técnicos, aislamiento y evidencia de ejecución están `PASSED`; PHPUnit confirmó UID 10001. La evidencia es interna del Sandbox (3 archivos, 21/21 E2E Docker), no una corrida Core→Sandbox. En el preflight actual, ambos endpoints responden 200.

El smoke cruzado continúa pendiente. El `DATABASE_URL` vigente de Core apunta a un destino no local. El Postgres de compose en `localhost:5433` no está listo para un Core aislado: una comprobación de solo lectura encontró 16 de 46 migraciones pendientes. No se ejecuta el flujo que escribiría estado contra la base no local ni se aplican migraciones en este corte. Esto es un prerrequisito seguro de ejecución, no un gap de código Core.

La decisión de mantener **SDD 2.1** separada no impide que Sandbox implemente un contrato vigente. SDD es la línea base de proceso/especificación del repositorio; `SYSTEM-*` e `INTEROP-*` versionan contratos de forma independiente. Se puede corregir el espejo `SYSTEM` mediante un WI local y Contract Sync sin declarar una homologación SDD global. La discrepancia del espejo se mantiene visible hasta que se resuelva por ese canal; no se actualiza por inferencia.

### GitHub Integration — corrección de procedencia

`WI-GH-012` está `W-DONE` local; `1c32c2c` añade el evento correctivo y `bdb5754` actualiza el changelog/disposición de alcance. `CS-GH-20261011-003` ya está importado y `C-ACKNOWLEDGED` en Core con evidencia; el evento histórico `CS-GH-20261011-002` no fue reescrito. La revisión final del rango `origin/feature/jean..bdb5754` fue `APPROVED`. El rango sigue sin publicar.

### Gate 0 — oráculos del piloto controlado

Jean confirmó que es PO únicamente para `tjc-piloto-ventas`, `tjc-piloto-reservas` y `tjc-piloto-suscripciones`. El borrador de nueve oráculos sigue `DRAFT`, no congelado y no autorizado para pruebas. La evaluación confirmatoria empresarial requiere validación del PO/actor funcional autorizado de la empresa.

Para cerrar Gate 0, revisar [la propuesta de oráculos](oe5-pilot-oracle-proposals-2026-10-11.md) y aprobar, corregir o dejar explícitamente sin resolver cada mapeo. Los puntos críticos son: 8 comportamientos listados frente a 9 casos; falta de fuente para RES-1; cancelación de reserva esperada al 50% frente al comportamiento del snapshot; solapamiento/adyacencia sin implementación concreta identificada; diferencia entre “pendiente S/90” y el modelo de suscripción; y el tratamiento de impuestos en Sales. No inventar el noveno comportamiento ni cambiar targets para forzar el ajuste.

## Camino corto al E2E local

1. `WI-SANDBOX-002` está cerrado con reviewer `APPROVED`; no requiere otra revisión.
2. Confirmar un destino de base seguro para Core sin migrar durante este corte. Con ambos health checks ya en 200, ejecutar un smoke técnico PHP Core→Sandbox y comprobar `projectRoot`, paths repo-relative y resultado de PHPUnit; no contarlo como observación oficial del piloto. No hacer escrituras contra el destino remoto vigente sin autorización.
3. Integration no tiene gap de código para el flujo local y su revisión de rango está aprobada; no hay trabajo de Integration que implementar antes del smoke. El rango permanece local.
4. Antes de las 54 ejecuciones oficiales, aprobar y congelar los nueve oráculos, snapshots/configuración y manifest de evidencia.

## Tarjeta concreta — futuro E2E GCE

`DEC-INF-001` ya está `APROBADO` en SYSTEM-2.9 mediante `WI-CORE-043`: se reutiliza `rag-test-execution-sandbox`, sin crear VM/NAT ni componentes. La decisión no cambia el firewall ni autoriza despliegue o una corrida remota. La regla canónica exige IAP-only; la evidencia vigente registra ingreso público existente y ausencia de regla IAP, y el SHA desplegado sigue sin verificarse. Por eso GCE aún no está listo para el E2E. `WI-CORE-043` sigue `W-IN_PROGRESS`: Console importó/ACK el Contract Sync pero su `WI-CONSOLE-025` está `W-SELECTED`, no aprobado ni implementado; Sandbox `WI-SANDBOX-003` está `DONE`.

`WI-CORE-008` sigue `W-PLANNED` y no habilita operación GCE. No hay WI aprobado para aplicar controles de red, verificar el SHA remoto o desplegar la revisión corregida; cualquier operación exige autorización específica. `DEC-VAL-001` sigue pendiente solo para código/evidencia empresarial y no bloquea el piloto controlado con repositorios propios. No se crea una DEC nueva.

`DEC-INF-001` continúa limitando el aprovisionamiento remoto; por sí sola no bloquea un E2E estrictamente local. No crear infraestructura ni cambiar secretos/configuración externa desde este corte.
