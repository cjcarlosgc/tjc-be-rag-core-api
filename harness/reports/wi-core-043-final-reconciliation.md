# WI-CORE-043 — reconciliación final y preflight remoto de solo lectura

Fecha: 2026-10-12
Modelo: leader · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## Cierre del alcance documental

- En Core, `DEC-INF-001` está **APROBADO** en SYSTEM-2.9: se reutiliza `rag-test-execution-sandbox` en `us-central1-a`, sin VM, NAT ni componentes adicionales. `DEC-VAL-001` sigue pendiente solo para código/evidencia empresariales; no bloquea un piloto controlado.
- Console terminó `WI-CONSOLE-025`. Su inbox deja `CS-CORE-20261012-001` en `C-RESOLVED`, y su reporte registra hashes iguales a la fuente: SYSTEM `925bfc63c4bc83a9d169ad5d982bf566fc7fcc56144cf023827c705bd7cab238`; INTEROP `703f65472c1d12e4e2303df15fa2e006ac5a956ef96f9ac820fb9cb2bdb0174e`.
- Sandbox terminó `WI-SANDBOX-003` como preflight local y mantiene el inbox en `ACKNOWLEDGED`. Se conserva su SDD 2.1/SYSTEM-2.2: su `DEC-INF-001=PENDING` es parte de su baseline local y no se cambia ni se llama obsoleto. El ACK/preflight no constituye aprobación local de la decisión, despliegue ni autorización de infraestructura. El criterio de Core queda satisfecho por el WI local completado; no se requiere forzar `C-RESOLVED` para este corte.
- El outbox Core conserva su estado publicado `C-PENDING`; no se altera para fingir que el SHA o la operación remota se completaron. Esta sesión Core no ejecutó E2E, despliegue, SSH, cambio GCE, ni consulta/migración de base de datos.

## Verificación GCE recibida y límite de esta sesión

El usuario aportó desde Cross una inspección de solo lectura previa al hardening: la VM `rag-test-execution-sandbox` aparecía `RUNNING` en `us-central1-a`, NIC `10.128.0.2`, IP externa `<SANDBOX_IP>`, tags `http-server` y `https-server`; las reglas efectivas permitían desde `0.0.0.0/0` TCP 22, 80, 443, RDP 3389 e ICMP, sin ingreso IAP. No se intentó conexión SSH pública.

Tras la autorización explícita del usuario, Cross aplicó y verificó en modo lectura: `iap.googleapis.com` habilitada; tag exclusivo `rag-test-execution-sandbox-iap-only` solo en esta VM; prioridad 900 permite `35.235.240.0/20` a TCP 22 y 3001; prioridad 901 deniega el resto de TCP/UDP/ICMP IPv4. `get-effective-firewalls` confirma que esas reglas efectivas superan los `default-allow-http/https/ssh/rdp/icmp/internal`; las reglas default no se modificaron. No se añadió IAM porque el usuario ya tenía rol Owner; no se infieren políticas heredadas.

`command -v gcloud` no encontró ejecutable en el host Core, por lo que la verificación posterior también es evidencia comunicada desde la sesión Cross/Sandbox, no una consulta reproducida aquí. El túnel IAP a TCP 3001 devolvió `backend failed to connect`. Después de que el usuario aprobara 2FA, SSH por IAP completó autenticación y se hizo una inspección de solo lectura: `systemctl is-active docker` informó `active`, pero `docker ps -a` no listó contenedores, ni running ni stopped. `docker image ls` mostró solo `tjc-sandbox-php:8.3`, `node:22-slim` y `hello-world:latest`; las imágenes no exponen la etiqueta OCI `org.opencontainers.image.revision`. No hay un contenedor desplegado cuyo SHA pueda verificarse y no hay workload Sandbox activo.

La misma sesión leyó el checkout de la VM: HEAD `11f5d9e60fa7941a2a00c69aaf950873d91833b3`; `git ls-remote origin refs/heads/feature/jean` devolvió `1139abc131a9037d74f68c83d02ee94fd964feeb`, commit `feat(sandbox): execute PHP from project root`. El HEAD de la VM es ancestro directo y está un commit detrás del remoto. No se hizo `pull` ni `deploy`; tampoco se afirma que el HEAD del checkout sea una revisión desplegada.

El contrato canónico menciona TCP 3000 como puerto predeterminado y exige confirmar el `PORT` efectivo. La autorización operativa en curso especifica 3001; antes de aceptar el firewall como listo, confirmar por lectura cuál es el puerto real del servicio. No abrir ambos puertos por inferencia.

## Guía operativa para futura verificación (solo lectura)

Ejecutar desde una sesión autorizada de Google Cloud, sin cambiar configuración global, metadata ni recursos. Los dos comandos siguientes son consultas de lectura y excluyen metadata que pudiera contener datos sensibles:

```sh
GCP_PROJECT=project-9070d3e1-a873-4cd6-8db
GCE_INSTANCE=rag-test-execution-sandbox
GCE_ZONE=us-central1-a

gcloud compute instances describe "$GCE_INSTANCE" \
  --project="$GCP_PROJECT" --zone="$GCE_ZONE" \
  --format='json(name,status,zone,machineType,networkInterfaces.network,networkInterfaces.networkIP,networkInterfaces.accessConfigs.natIP,tags.items)'

gcloud compute instances network-interfaces get-effective-firewalls "$GCE_INSTANCE" \
  --project="$GCP_PROJECT" --zone="$GCE_ZONE" --network-interface=nic0 --format=json
```

Comprobar que la identidad y zona corresponden a la VM esperada. En reglas efectivas de ingreso, confirmar IAP `35.235.240.0/20` limitado a esta instancia y solo TCP 22 y el puerto efectivo de Sandbox. La operación autorizada especifica TCP 3001; contrastarlo con `PORT` por un canal de configuración autorizado sin imprimir secretos. No debe quedar ingreso público a SSH, Sandbox, RDP, HTTP/HTTPS o ICMP por reglas/tags/políticas aplicables. Si la salida efectiva contradice el alcance autorizado, detenerse; esta guía no autoriza correcciones adicionales.

Para identificar la revisión desplegada, primero se necesita un canal IAP seguro ya configurado y autorizado; no conectarse por la IP pública ni usar un procedimiento que escriba claves SSH o metadata. Desde una sesión remota de solo lectura, seleccionar el contenedor **del servicio Sandbox** (no uno efímero de PHPUnit) y leer únicamente su imagen y etiqueta OCI, nunca el entorno ni la inspección completa:

```sh
# En la VM, el runtime observado fue Docker.
sudo docker ps --no-trunc --filter status=running --format '{{.ID}} {{.Image}} {{.Names}}'
sudo docker inspect --type container --format '{{.Image}}' <container-id>
sudo docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' <image-id>
```

Comparar `org.opencontainers.image.revision` con el SHA completo de un commit Sandbox **revisado, aprobado y comprometido** que contenga los fixes requeridos. No usar como sustituto `HEAD` del checkout, un árbol sucio, la revisión Core ni el tag mutable de una imagen. Si la etiqueta falta, está vacía o difiere, SHA no verificado: no correr el E2E. Estas consultas locales del runtime son de lectura, pero quedan para una futura sesión IAP autorizada; no se ejecutaron aquí.

Fuentes oficiales para los comandos y el rango IAP: [referencia de `get-effective-firewalls`](https://docs.cloud.google.com/sdk/gcloud/reference/compute/instances/network-interfaces/get-effective-firewalls) y [IAP TCP forwarding](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding).

## Puertas que siguen antes de E2E

1. IAP-only/firewall efectivo está verificado por Cross dentro del alcance autorizado; esta sesión no ejecutó ni repetirá cambios GCE.
2. La autenticación 2FA y SSH por IAP ya se completaron. La inspección encontró cero contenedores; el checkout de la VM está un commit detrás de `origin/feature/jean`, pero no se hizo `pull`/`deploy` y ese HEAD no acredita una revisión desplegada.
3. Para habilitar E2E, hace falta una orden/autorización explícita de despliegue sobre un commit revisado y aprobado. Después, confirmar que el workload esté activo, leer su etiqueta OCI de revisión y compararla con ese SHA. Resolver por lectura el listener y el `PORT` efectivo (3001 usado en el túnel frente al 3000 predeterminado canónico); si se necesita iniciar/actualizar el servicio, mantenerlo dentro de la orden explícita de despliegue.
4. Obtener autorización explícita separada para la corrida E2E remota una vez confirmado el workload, el puerto y el SHA desplegado.

No existe otro WI Core aprobado y desbloqueado que habilite esta operación. `WI-CORE-008` está `W-PLANNED`, P2, no aprobado y cubre verificación de despliegue organizacional/sincronización, no autoriza cambios GCE ni una corrida. No se selecciona ni crea otro WI por inferencia.

## Gates y evidencia

- `before-review` (13:36:31 UTC) y `before-done` (13:38:22 UTC): registrados; ambos pasan con `relevantPendingSyncIds: []`. Console está resuelto y el preflight Sandbox está completo/ACK según el alcance local aprobado.
- `command -v gcloud`: no encontró ejecutable en el host de esta sesión; la evidencia efectiva de firewall quedó atribuida al usuario vía Cross.
- `node scripts/sdd-check.mjs` — PASS (`SDD check OK`).
- `node harness/validate-work-items.mjs` — PASS (`Work item validation passed (CORE, 43 WI)`).
- `node harness/validate-harness.mjs` — PASS (`Harness V3 validation passed`).
- `git diff --check` — PASS; se revisaron aparte los espacios finales de los reportes nuevos/no rastreados.
- `node harness/validate-completions.mjs` — PASS (`Completion validation passed (40 completed WI)`) después de persistir el snapshot W-DONE.
- No se ejecutaron lint, pruebas de producto ni build porque el corte es documental/Harness y no toca `app/`, dependencias o configuración de ejecución.
- El veredicto independiente del ciclo 2 aprobó el corte documental; sus bloqueos de publicación/atención de consumidores ya están satisfechos en el alcance descrito arriba. Se respeta el máximo de dos ciclos. Cross aplicó IAP/firewall autorizado; esta sesión Core no cambió GCE ni hizo SSH. La lectura SSH por IAP posterior se atribuye a la sesión Sandbox/Cross; no se hizo despliegue ni E2E.
