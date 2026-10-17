Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

# WI-CORE-049 — revisión contractual previa a editar SYSTEM

**status:** CHANGES_REQUESTED (menores y acotados; sin DECISION_REQUIRED: la decisión sigue PROPOSED y su aprobación es del usuario).
**filesAffected (propuestos):** `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md` (solo §6.10 y cabecera/nota de versión), `CHANGELOG.md`, espejo Console.

## 1. Sustitución parcial de DEC-INF-001 (cambios pedidos)
- La sustitución parcial es coherente y no contradice aislamiento, retención, alcance de datos, `DEC-VAL-001` ni `DEC-AUTH-001` (el token sigue opaco, precompartido y fuera de Console/container).
- C1. El párrafo «Red» mezcla tres cosas; la propuesta debe decir cuáles sustituye: (a) el «servicio de Sandbox por IAP, TCP 3000» se sustituye; (b) «SSH por IAP, 35.235.240.0/20, TCP 22, OS Login y 2FA» se conserva; (c) «no publicar el puerto de Sandbox en 0.0.0.0/0» se conserva y se refuerza. Añadir: «El resto del párrafo "Red" de `DEC-INF-001` (SSH, hallazgos de reglas existentes, obligación de limitarlas) sigue vigente».
- C2. Conflicto omitido: `DEC-INF-001` documenta reglas existentes `0.0.0.0/0` para HTTP/HTTPS por los tags `http-server`/`https-server`. Un proxy TLS en 443 caería bajo esa regla pública. Añadir a Propuesta/Riesgos: «El puerto TLS no puede heredar las reglas públicas HTTP/HTTPS existentes; se debe retirar esa exposición para la instancia (o usar otro tag/puerto) antes de cualquier uso, y verificarlo».
- C3. Riesgo faltante: `/health/live` y `/health/ready` no requieren bearer (INTEROP §3) y quedarían alcanzables detrás del proxy; el proxy debe limitarlos o no exponerlos. Y el proxy no debe registrar `Authorization` ni query (URLs firmadas no viajan por ese hop, pero los logs sí podrían capturar el bearer).
- C4. «Bearer (`DEC-AUTH-001`)»: añadir que el token pasa a viajar por Internet bajo TLS; esto aumenta la exigencia de rotación (riesgo 4 ya lo cubre) y no cambia DEC-AUTH-001.

## 2. Honestidad y completitud
- Reversión (volver a túnel IAP, `SANDBOX_URL` loopback) correcta y sin pérdida de datos.
- Impacto en experimentos: correcto. Añadir una frase: la latencia extra puede acercar ejecuciones al timeout del Sandbox y producir fallo de plataforma (`DEC-VAL-002`); eso no altera validez ni métricas por la condición del usuario de `DEC-VAL-002`, pero debe observarse.
- No afirmar como hecho lo no verificado (cambios pedidos):
  - «IP de salida publicadas de Render»: redactar «cuyo conjunto, estabilidad y exclusividad **no están verificados** y deben confirmarse con la documentación y el plan de Render antes de usarlas».
  - Contexto: «hoy solo funciona contra `http://127.0.0.1:3101`» es operativo, no contractual; la validación actual de `SANDBOX_URL` (`env.validation.ts`) solo exige que acompañe a `SANDBOX_SERVICE_TOKEN` y no restringe esquema/host. Reemplazar por «el único destino verificado hasta ahora es el túnel loopback (`http://127.0.0.1:3101`)».
  - TLS: el texto ya lo deja como pregunta abierta; añadir «ninguna opción de certificado está verificada ni elegida».
- Los siete riesgos listados son honestos; con C2/C3 quedan completos.

## 3. Versionado
- **SYSTEM-2.11: sí.** Hay sección nueva normativa en forma (registro de decisión PROPOSED con `Blocks`) y corrección editorial de Baseline/DEC-VAL-002; precedente: 2.10 y 2.9 también bumpearon por decisiones. «Fecha de corte» 2026-10-12. Actualizar «Regla de compatibilidad» con una entrada `SYSTEM-2.11` que diga explícitamente: DEC-INF-002 es PROPOSED sin efecto normativo, `DEC-INF-001` sigue vigente, Sandbox conserva SYSTEM-2.2 sin acción, y `INTEROP-2.11` es la versión compatible. Sugerencia menor: «Estado» de cabecera pasa a «APROBADO salvo decisiones `PENDING`/`PROPOSED` explícitas».
- **INTEROP:** §6.1/§7 (y todo el documento) no citan IAP, el puerto 3000 ni el modo de ingreso; solo hablan de HTTP interno, bearer y `SANDBOX_URL`. La decisión **no exige cambio de transporte** en INTEROP. En cambio, el «objetivo pendiente» de OC11 (§6.10, línea del `resultSummary`) es falso: `WI-CORE-046` está `W-DONE`. Recomendado **INTEROP-2.11** documental (precedente: INTEROP-2.10 fue aclaratorio) con cabecera `Compatible con: SYSTEM-2.11`, cambiando solo esa frase a comportamiento vigente (implementado en `WI-CORE-046`; mismo texto de `resultSummary`, sin estado nuevo) y una nota de versión; espejo byte a byte a Console. Alternativa aceptable: diferir y dejar INTEROP-2.10 «Compatible con SYSTEM-2.10» más nota en SYSTEM de que 2.10 sigue compatible; la desventaja es dejar una afirmación falsa vigente. Si se elige INTEROP-2.11, no tocar nada más del documento.

## 4. Corrección editorial B
Exacta con el estado real (`WI-CORE-048` cerrado el 2026-10-12, W-DONE). Únicas tres ocurrencias a corregir: Baseline línea «implementación pendiente», `DEC-VAL-002 · Estado de la implementación` y la nota de 2.10 puede quedar como historia. Texto B.2 aprobado; añadir «(`app/`: `sandbox`/validación)» no es necesario. No reescribir la «Condición del usuario» ni la Resolución.

## 5. Contract Sync
- `component`: CORE (productor). `breaking: false`. `scopePaths`: `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`.
- Targets: **sandbox: sí** (informativo; la decisión, de aprobarse, afecta a su VM/proxy/firewall; `requiredAction`: «ninguna ahora; no implementar ni tocar infraestructura; esperar aprobación del usuario y autorización operativa»; Sandbox conserva SYSTEM-2.2). **console: solo si** se elige INTEROP-2.11 (`requiredAction`: «sincronizar el espejo INTEROP-2.11 byte a byte; sin cambio de comportamiento»). **github-integration: no**.
- `changed`: «DEC-INF-002 PROPOSED (sin efecto normativo) y correcciones editoriales de estado (DEC-VAL-002 implementada; OC11 implementado)». Publicar el evento tras la edición, vía el flujo de Contract Sync del WI (handoff a otra sesión solo con confirmación expresa del usuario).

## 6. No autoriza infraestructura
Correcto: la sección declara «no autoriza ninguna operación de infraestructura» y `Blocks` no bloquea trabajo local. Añadir una línea final: «Aprobar esta decisión no autoriza cambios de firewall, proxy, VM, DNS, certificados ni de Render; cada uno requiere autorización operativa explícita». El WI de código `isAllowedSandboxUrl` queda aparte y no debe empezar antes de la aprobación.

## Resumen
CHANGES_REQUESTED: aplicar C1–C4, las tres redacciones de §2, SYSTEM-2.11 con entrada de compatibilidad, INTEROP-2.11 documental (o diferir con nota), Contract Sync como en §5.

## Confirmación (revisión del texto aplicado, 2026-10-12)

**Veredicto: APPROVED.** Verificado sobre `git diff -- spec CHANGELOG.md`:
- C1: `Propuesta` sustituye solo el servicio del Sandbox por IAP/TCP 3000 y declara vigente el resto del párrafo «Red» (SSH/OS Login/2FA, hallazgos, «no publicar en 0.0.0.0/0»). C2: riesgo 7 (reglas `http-server`/`https-server`). C3: riesgo 8 (`/health/*` sin bearer, sin registrar `Authorization`). C4: riesgo 3 (token por Internet bajo TLS, sin cambiar `DEC-AUTH-001`).
- Honestidad: IP de salida de Render «no verificadas»; destino verificado único = túnel loopback; ninguna opción TLS verificada ni elegida; latencia/timeout y `DEC-VAL-002` en riesgo 10 e impacto.
- Estado: PROPOSED, sin efecto normativo, `DEC-INF-001` vigente; no autoriza firewall, proxy, VM, DNS, certificados ni Render; `Blocks` no alcanza el trabajo local; reversión al túnel IAP. Sin contradicción con `DEC-INF-001` ni `DEC-AUTH-001`.
- Versionado: SYSTEM-2.11 (cabecera, «Estado» con `PROPOSED`, regla de compatibilidad), INTEROP-2.11 documental (cabecera, nota de versión, §6.10 pasa de «pendiente» a «Implementado en `WI-CORE-046`» con el mismo texto), README y feature 013 alineados; no quedan citas vigentes a 2.10 salvo historia.
- Corrección B: las dos ocurrencias de `DEC-VAL-002` (Baseline y «Estado de la implementación») dicen implementada en `WI-CORE-048`; Condición y Resolución intactas.
- Observación no bloqueante: el INTEROP-2.11 §6.10 que Console deberá espejar sigue sin tocar el transporte.

**Contract Sync (CORE, productor, `breaking: false`)**
- `changed`: «SYSTEM-2.11/INTEROP-2.11: DEC-INF-002 PROPOSED (sin efecto normativo) y correcciones editoriales de estado (DEC-VAL-002 implementada en WI-CORE-048; mensaje de OC11 implementado en WI-CORE-046). Sin cambios de rutas, campos, códigos ni transporte.»
- console: `requiredAction`: «Sincronizar el espejo INTEROP-2.11 (y SYSTEM-2.11 si lo mantiene) byte a byte; sin cambio de comportamiento.»
- sandbox: `requiredAction`: «Ninguna ahora; conserva SYSTEM-2.2. No implementar ni tocar firewall/proxy/VM hasta aprobación del usuario y autorización operativa explícita.»
