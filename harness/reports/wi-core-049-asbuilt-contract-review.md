Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-049 — revisión contractual del texto as-built de DEC-INF-002 (previa a editar SYSTEM)

**status:** CHANGES_REQUESTED (cuatro ajustes de redacción acotados; sin DECISION_REQUIRED: el usuario ya aprobó «Sí, aprobada as-built»).
**Entradas:** `harness/reports/wi-core-049-asbuilt-proposal.md`, revisión previa, `DEC-INF-001`, `DEC-INF-002` (PROPOSED vigente), `DEC-AUTH-001`, cabeceras de INTEROP-2.11 y SYSTEM-2.11.

## 1. Fidelidad a hechos y decisión
Correcta en lo esencial: hechos (a)–(d) atribuidos a Cross, «Core no los verificó ni toca la VM», 80/443 desde `0.0.0.0/0` declarado sin suavizar, sin filtro por IP de Render, token por Internet, sslip.io/Let's Encrypt como dependencias, `/health/*` sin bearer, no autoriza operaciones. Decisión del usuario citada textualmente. Ajustes:
- **A1.** El texto cierra con «sustituye la PROPOSED» pero conserva en «Riesgos» fragmentos de la PROPOSED (IP de salida de Render como control, riesgos 1, 7 y 9). Al reescribir, eliminar de la sección toda mención a filtrar por IP de Render/cambio de IP de salida como riesgo vigente, salvo la frase «no hay filtro por IP de Render» que ya está. Retirar el riesgo 7 (reglas `http-server`/`https-server`) o reformularlo: ahora el as-built SÍ expone 80/443 públicos mediante una regla propia (`rag-sandbox-https-allow`), no por heredar los tags.
- **A2.** «Cualquier host de Internet alcanza el proxy y solo el bearer más el rate limit frenan el abuso»: correcto pero el rate limit aún no existe; mantener la frase «Hasta su implementación el único freno es el bearer» también en «Superficie de riesgo» y en `Estado`, no solo en el párrafo de rate limit.
- **A3.** Añadir en hechos: «el puerto efectivo del Sandbox es 3001 (no el 3000 de `DEC-INF-001`)». El proposal lo usa sin decir que difiere del 3000 documentado; evita ambigüedad en «sustituye TCP 3000».

## 2. Rate limit y Caddy
- El texto lo presenta como «valor inicial propuesto, a ratificar por Sandbox/Cross tras observar un PR real» y es honesto sobre Caddy (limitador no estándar, módulo `caddy-ratelimit` vía xcaddy u otro delante). Aceptable.
- **R1.** El encabezado «(aprobado; pendiente de implementar…)» puede leerse como valores aprobados. Redactar: «Control aprobado (rate limit sí); **valores no aprobados**: inicial a ratificar por Sandbox/Cross».
- **R2.** El sondeo no es dato fijo: Core sondea según el `pollAfterMs` que devuelve el Sandbox (`sandbox-execution.service.ts`, `pollAfterMs ?? firstPollAfterMs`). Declarar que «240/min por IP para `GET /executions/*` es una estimación; debe contrastarse con el `pollAfterMs` real y con ejecuciones concurrentes antes de ratificar, pues un límite menor al sondeo legítimo produce `429` y fallo de plataforma (`DEC-VAL-002`)». Añadir que Core hoy no documenta ni maneja un `429` del proxy como caso específico (no afirmar lo contrario).
- Estado actual honesto: «no implementado» ya aparece; mantener.

## 3. Versionado: SYSTEM-2.12, no editar 2.11
SYSTEM-2.11 ya fue publicado y subido (eventos `-009/-010`), y su contenido normativo declarado es «PROPOSED sin efecto normativo». Pasar a APROBADA cambia el efecto normativo: es un cambio de versión, no una errata. **Publicar SYSTEM-2.12** (fecha 2026-10-12, `WI-CORE-049`), con entrada de «Regla de compatibilidad» que diga: «`DEC-INF-002` APROBADA as-built; sustituye parcialmente solo el servicio de Sandbox por IAP/TCP 3000 de `DEC-INF-001`; sin cambio de rutas, campos, códigos ni transporte HTTP; Sandbox conserva SYSTEM-2.2 y no requiere acción de código». Mantener 2.11 en la historia sin reescribir.
- **INTEROP-2.12 documental: sí**, mínimo: cambiar solo cabecera (`Versión: INTEROP-2.12`, `Compatible con: SYSTEM-2.12`) y la nota de versión («sin cambio de rutas, campos, códigos, estados ni transporte»), porque Core↔Console mantienen espejo byte a byte y la cabecera «Compatible con» quedaría apuntando a una versión superada. No tocar §6.x. Actualizar README (línea base «SDD 3.0 / INTEROP-2.12», «Core mantiene SYSTEM-2.12») y la referencia en feature 013 si cita 2.11. CHANGELOG con entrada nueva; no reescribir las de 2.11.
- «Estado» de cabecera de SYSTEM: puede seguir como está (aún hay `PENDING`, p. ej. `DEC-VAL-001`).

## 4. Contradicciones
- **DEC-AUTH-001:** sin contradicción; el secreto sigue opaco/precompartido, fuera de Console y container. Añadir en la resolución que viaja por Internet bajo TLS sin cambiar la decisión (ya está).
- **DEC-VAL-001 / DEC-VAL-002:** sin contradicción; el código empresarial sigue bloqueado y se mantiene el alcance a repos de demostración. Añadir una frase: «Exponer 80/443 públicos no habilita código empresarial ni datos de producción (`DEC-VAL-001` PENDING)».
- **DEC-INF-001 (cambio requerido C-INF).** La redacción propuesta «el resto del párrafo "Red" sigue vigente» **contradice** el as-built: el párrafo exige «no publicar el puerto de Sandbox en `0.0.0.0/0`» (se cumple: 3001 solo por IAP) pero también «limitar o eludir» las exposiciones HTTP/HTTPS `0.0.0.0/0` antes de reutilizar la VM, y el as-built crea a propósito una regla pública 80/443. Redacción exigida:
  > «Sustituye de `DEC-INF-001` («Red»): (i) el ingreso al servicio del Sandbox exclusivamente por IAP/TCP 3000, que pasa a ser respaldo y reversión; (ii) la obligación de limitar o eludir toda exposición pública HTTP/HTTPS de la instancia, **solo** para TCP 80/443 abiertos de forma deliberada y acotada al proxy TLS (`rag-sandbox-https-allow`). Siguen vigentes: SSH/administración solo por IAP (`35.235.240.0/20`, TCP 22, OS Login y 2FA), «no publicar el puerto del servicio de Sandbox (3001/3000) en `0.0.0.0/0`» y la obligación de limitar o retirar las demás reglas públicas (SSH, RDP, ICMP) para la instancia; el resto de `DEC-INF-001` no cambia.»
  Añadir que `DEC-INF-001` y esta decisión se leen juntas y que ante conflicto prevalece `DEC-INF-002` solo en los puntos (i) y (ii).
- Verificar en el texto que no queden reglas públicas de SSH/RDP/ICMP sin mención: Cross no las reportó; declarar «estado de esas reglas no verificado en este as-built» en lugar de omitirlas.

## 5. Contract Sync sucesor
- `component`: CORE (productor); `breaking: false`; `scopePaths`: `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`.
- **console: sí.** `requiredAction`: «Sincronizar el espejo INTEROP-2.12 (y SYSTEM-2.12 si lo mantiene) byte a byte; sin cambio de comportamiento.» (Console conserva espejos SYSTEM-2.9/INTEROP-2.8 hasta su sync; no inferir que ya tiene 2.11.)
- **sandbox: sí** (informativo). `changed`: «DEC-INF-002 aprobada as-built; el servicio queda expuesto por Caddy/TLS en 80/443 públicos con bearer.» `requiredAction`: «Ratificar los valores del rate limit (o proponer otros) y la rotación de 90 días con su dueño; implementar el limitador en el proxy solo con autorización operativa explícita. Conserva SYSTEM-2.2; no tocar VM, firewall ni proxy sin autorización operativa.»
- **github-integration: no** (no consume el servicio ni este contrato).
- `changed` general: «SYSTEM-2.12/INTEROP-2.12: DEC-INF-002 pasa de PROPOSED a APROBADA as-built (sustituye parcialmente DEC-INF-001, Red). Sin cambios de rutas, campos, códigos ni transporte.»
- Eventos `CS-CORE-20261012-009/010` no se reescriben; los sucesores los referencian como superados.

## 6. No autoriza infraestructura
Correcto («Este documento no autoriza nuevas operaciones…»). Mantener la línea de la revisión previa: aprobar la decisión no autoriza cambios de firewall, proxy, VM, DNS, certificados ni Render. Que el rate limit, la rotación y el cierre de 80/443 requieran autorización operativa explícita. El WI de código `isAllowedSandboxUrl` sigue aparte y no se implementa sin indicación.

## Resumen
CHANGES_REQUESTED: aplicar A1–A3, R1–R2, la sustitución exacta de §4 (C-INF), SYSTEM-2.12 + INTEROP-2.12 documental, y Contract Sync a console y sandbox (sin github-integration). Tras aplicar, la confirmación es de bajo esfuerzo.

## Confirmación

**status:** CHANGES_REQUESTED (un ajuste menor, R2; el resto verificado en `git diff -- spec CHANGELOG.md`).

- **A1 OK.** Sin riesgos 1/7/9 de la PROPOSED; solo queda «no hay filtro por IP de Render». Matiz no bloqueante: «(sus IP de salida son rangos compartidos…)» (`system-contract.md`, «Superficie de riesgo») afirma como hecho algo que Cross no verificó; reformular como «no verificadas».
- **A2 OK.** «Hasta que el rate limit se implemente… el único freno es el bearer» en `Estado` y en «Rate limit»; «Superficie de riesgo» condiciona el rate limit a «cuando se implemente».
- **A3 OK.** Puerto efectivo 3001 frente al 3000 de `DEC-INF-001` declarado en «Resolución» y «As-built».
- **R1 OK.** «Control aprobado (rate limit sí); los valores NO están aprobados… a ratificar por Sandbox/Cross».
- **R2 parcial.** Se declara el 240/min como estimación a contrastar y la fuente `pollAfterMs`. Falta: (a) contrastar también con ejecuciones concurrentes; (b) decir que Core hoy no documenta ni maneja un `429` del proxy como caso específico. La frase «un 429 del proxy a Core produce un fallo de plataforma» (párrafo «Rate limit», `system-contract.md`) afirma un comportamiento no verificado; reformular a «puede producir».
- **C-INF OK.** Sustituye explícitamente solo (i) ingreso por IAP al puerto del servicio y (ii) limitar HTTP/HTTPS para TCP 80/443 al proxy. Siguen vigentes SSH por IAP con OS Login y 2FA, no publicar 3001/3000, limitar las demás reglas públicas (SSH, RDP, ICMP; estado no verificado) y el resto de `DEC-INF-001`. `DEC-VAL-001` PENDING sin cambio.
- **SYSTEM-2.12 / INTEROP-2.12 OK.** INTEROP: solo cabecera y nota (sin §6.x); SYSTEM: cabecera, `Estado` («PENDING»; sin PROPOSED restantes), «Regla de compatibilidad»; 2.11 conservada como historia. README, feature 013 y CHANGELOG (entrada nueva) coherentes; sin menciones residuales a 2.11 como vigente.
- **Hechos/autorización OK.** Hechos atribuidos a Cross («Core no los modificó ni verificó»); «no autoriza nuevas operaciones de firewall, proxy, VM, DNS ni certificados»; `isAllowedSandboxUrl` sin implementar.
