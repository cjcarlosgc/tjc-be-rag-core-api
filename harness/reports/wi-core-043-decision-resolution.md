# WI-CORE-043 — Resolución de DEC-INF-001

Fecha: 2026-10-12
Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Decisión

Se aprueba reutilizar la VM GCE ya existente `rag-test-execution-sandbox` (`us-central1-a`, `e2-standard-4`, disco de arranque de 100 GB), sin crear VM, Cloud NAT, balanceador, base adicional ni otro componente. Esta selección aplica solo al piloto con repositorios controlados por el usuario; no autoriza código de empresa ni evidencia empresarial, y `DEC-VAL-001` permanece PENDING.

## Evidencia de solo lectura de GCE

- El usuario confirma que el repositorio ya está clonado en esta VM y que hubo un primer despliegue con fallas antes de las correcciones recientes. No se inspeccionó el checkout remoto ni se verificó qué commit se desplegó; no se presume que la VM tenga la revisión corregida.
- `gcloud compute instances describe rag-test-execution-sandbox --zone=us-central1-a --project=project-9070d3e1-a873-4cd6-8db` (consulta de solo lectura, 2026-10-12 08:19 UTC): salida 0; VM `RUNNING`, tipo `e2-standard-4`, disco `rag-test-execution-sandbox` de 100 GB, IP externa presente, OS Login y 2FA habilitados, tags `http-server` y `https-server`.
- `gcloud compute resource-policies describe default-schedule-1 --region=us-central1 --project=project-9070d3e1-a873-4cd6-8db`: snapshots diarios, `maxRetentionDays: 14`, `onSourceDiskDelete: KEEP_AUTO_SNAPSHOTS`.
- `gcloud compute firewall-rules list --project=project-9070d3e1-a873-4cd6-8db --filter='network:default'`: `default-allow-ssh` (TCP 22) y `default-allow-rdp` (TCP 3389) permiten desde `0.0.0.0/0`; las reglas HTTP/HTTPS permiten 80/443 desde `0.0.0.0/0` a instancias con los tags presentes. Estas reglas siguen activas y no se modificaron.

## Controles y consecuencias aceptados

- Ingreso previsto por IAP TCP forwarding a TCP 22 y al servicio Sandbox TCP 3000 (puerto predeterminado; confirmar `PORT` efectivo). La documentación oficial requiere una regla de ingreso desde `35.235.240.0/20` para los puertos TCP específicos y advierte que las reglas predeterminadas de SSH/RDP permiten acceso desde cualquier IP: <https://docs.cloud.google.com/iap/docs/using-tcp-forwarding>.
- La IP externa existente se conserva para la salida requerida al descargar dependencias; no se considera canal de ingreso de Sandbox. No se agrega NAT.
- Se conservan los controles ya aprobados de Sandbox por ejecución: container efímero, UID/GID 10001 no-root, `CapDrop: ALL`, `no-new-privileges`, workspace aislado y pruebas sin red.
- La instancia encendida incurre cargos de cómputo; también pueden cobrarse disco, IP y snapshots. No se presume saldo de crédito ni gratuidad. Se recomienda limitar su uso a ventanas E2E y detenerla al terminar la sesión de pruebas.
- La inspección actual encontró SSH 22, RDP 3389, HTTP 80, HTTPS 443 e ICMP con ingreso amplio desde `0.0.0.0/0`; además la instancia conserva tags `http-server`/`https-server`. No se encontró una regla IAP. La política aprobada todavía no está aplicada.
- El disco/snapshot puede retener el repositorio clonado. Los snapshots diarios se conservan hasta 14 días y pueden permanecer aunque se elimine el disco; limpiar un workspace o container no los purga. Por ello, esta VM queda limitada a repositorios del piloto controlados por el usuario y sin requisitos empresariales de retención.

## Límites de esta resolución

La decisión actualiza el contrato canónico, pero no altera firewall, VM, disco o snapshots, no actualiza el checkout remoto, no despliega el Sandbox y no cambia la línea base SDD. Antes de usar el servicio remoto se debe corregir y verificar el ingreso público actual para que SSH/Sandbox solo sean accesibles por IAP; después se debe confirmar el commit desplegado y probar la revisión corregida. Esas acciones operativas deben realizarse bajo autorización explícita. Sandbox permanece en SDD 2.1; la sincronización del contrato vía Contract Sync no declara homologación global.
