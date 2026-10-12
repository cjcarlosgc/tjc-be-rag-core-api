# WI-CORE-050 — preparación (isAllowedSandboxUrl, sin implementar)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Estado `W-PLANNED`: aprobado por el usuario junto con `DEC-INF-002` (SYSTEM-2.12, «Seguimiento aprobado aparte»), pero preparado y **sin implementar hasta indicación** del coordinador/usuario.

## Alcance
`app/src/config/env.validation.ts`: validar `SANDBOX_URL` con una función `isAllowedSandboxUrl` análoga a `isAllowedGithubIntegrationUrl` (`env.validation.ts:384`): HTTPS obligatorio en `production`; HTTP solo en loopback (`localhost`, `127.0.0.1`, `[::1]`) fuera de producción; sin credenciales, ruta (salvo `/`), query ni hash. No debe romper `http://localhost:3001` ni `http://127.0.0.1:3101`, ni la regla existente «`SANDBOX_URL` y `SANDBOX_SERVICE_TOKEN` se configuran juntos» (DEC-AUTH-001). Mensaje de error sin imprimir el valor.

## Riesgos y pruebas
- Una producción con `SANDBOX_URL` http fallaría al arrancar: comprobar antes con Cross que Render usa `https://136-115-2-208.sslip.io` (verificado por Cross el 2026-10-12).
- Pruebas roja-verde en `env.validation.spec.ts`: https en producción ok; http loopback en producción rechazado; http no loopback fuera de producción rechazado; con credenciales/ruta/query rechazado; los dos URL de desarrollo siguen válidos; sin `SANDBOX_URL` sigue permitido.
- Sin cambio de contrato ni de comportamiento del cliente Sandbox; sin build en `app/`.
