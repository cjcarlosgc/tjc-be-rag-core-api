# WI-CORE-049 — texto propuesto para SYSTEM-2.11 (previo a editar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

## A. Nueva sección tras `DEC-INF-001`

> ### DEC-INF-002 — Exposición del servicio de Sandbox a Core desplegado en Render
> **Estado:** PROPOSED (2026-10-12, `WI-CORE-049`; sin efecto normativo hasta su aprobación por el usuario; no autoriza ninguna operación de infraestructura).
> **Blocks:** el despliegue de Core en Render contra el Sandbox remoto de la VM; no bloquea el trabajo local ni el túnel IAP vigente.
> **Contexto:** `DEC-INF-001` fija el ingreso al servicio del Sandbox solo por IAP TCP forwarding. Un Core desplegado en Render (red pública) no puede abrir un túnel IAP interactivo; hoy solo funciona contra `http://127.0.0.1:3101` (túnel desde una máquina del usuario).
> **Propuesta:** sustituye **parcialmente** solo el párrafo «Red» de `DEC-INF-001`, y solo para el servicio del Sandbox: Core llega al Sandbox por HTTPS desde las IP de salida de Render, con TLS y `Authorization: Bearer` (`DEC-AUTH-001`). El acceso administrativo (SSH) sigue siendo IAP-only con OS Login y 2FA. El puerto HTTP del Sandbox nunca se publica: escucha en loopback o red interna y solo es alcanzable por un proxy TLS en la misma VM; el firewall limita el ingreso al puerto TLS a las IP de salida publicadas de Render y no abre `0.0.0.0/0`. El resto de `DEC-INF-001` (VM única, alcance de datos, aislamiento por ejecución, retención y condiciones de operación) no cambia.
> **Riesgos:** (1) las IP de salida de Render son compartidas por todos los servicios de la región; el firewall filtra el origen pero no identifica a Core, por lo que la barrera efectiva es TLS más el bearer; (2) el Sandbox ejecuta código de terceros: ampliar la superficie de red aumenta el impacto de una fuga del token o de una falla del proxy; (3) sin rate limit un cliente con el token puede agotar la VM; (4) el `SANDBOX_SERVICE_TOKEN` es un secreto precompartido sin rotación definida; (5) sin monitoreo ni alertas un abuso pasa inadvertido; (6) TLS sin dominio propio exige decidir entre un nombre público gratuito con certificado público o una CA privada en la que Core confíe (cambio de código inexistente hoy); (7) un cambio de IP de salida de Render deja a Core sin acceso hasta actualizar el firewall.
> **Reversión:** retirar la regla del puerto TLS y el proxy y volver al túnel IAP (`SANDBOX_URL` loopback), que `DEC-INF-001` mantiene como ruta aprobada.
> **Impacto en experimentos y métricas:** nulo en validez y resultados (mismo Sandbox, perfiles de ejecución, aislamiento y clasificación); las métricas de duración medidas por Core incorporan el tiempo de red adicional, por lo que no son comparables con corridas por túnel sin declararlo.
> **Cambios previstos si se aprueba:** el bump de versión que determine el contract-reviewer, validación de entorno `isAllowedSandboxUrl` análoga a `isAllowedGithubIntegrationUrl` (HTTPS obligatorio en producción; HTTP solo loopback fuera de producción; sin credenciales, ruta ni query; sin romper `http://localhost:3001` ni `http://127.0.0.1:3101`) en un work item de código aparte; proxy, firewall y VM son del componente Sandbox/Cross con autorización operativa explícita.
> **Preguntas abiertas para el usuario:** TLS sin dominio propio (nombre gratuito con certificado público o CA privada); dueño y ventana del proxy y del firewall; plan de Render e IP de salida estables; límite de ejecuciones por minuto y por Project; si se mantiene el túnel IAP de respaldo; mecanismo y periodicidad de rotación del token.


## B. Corrección editorial (deuda F3 de `WI-CORE-048`) en SYSTEM
1. «Baseline»: `Para un símbolo elegible cuya ejecución falla por plataforma … rige DEC-VAL-002 (APROBADA; implementación pendiente).` → `(APROBADA; implementada en WI-CORE-048)`.
2. `DEC-VAL-002 · Estado de la implementación`: «pendiente. Hasta que … sigue …» → «implementada en `WI-CORE-048` (2026-10-12): una excepción, timeout o categoría `INFRASTRUCTURE` del Sandbox por símbolo es fallo de plataforma y aplica la precedencia; evidencia por ejecución, experimentos y métricas sin cambio.»

## C. Pregunta de versionado para el reviewer
SYSTEM pasa de 2.10 a 2.11 (cambio normativo propuesto, aunque PROPOSED) o basta nota; INTEROP-2.10 §6.10 aún dice OC11 «objetivo pendiente» (ya implementado): ¿se corrige y entonces INTEROP-2.11, o se difiere? Fecha de corte y «Compatible con» en cabeceras.
