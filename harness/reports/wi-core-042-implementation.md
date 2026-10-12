# WI-CORE-042 — Implementación

Modelo: implementer · configurado `gpt-6-luna` · atendido `unknown` · esfuerzo `medium`

## Resultado

El cierre que se añade al alcanzar `toolCallCap` remite ahora a las convenciones de lenguaje, framework, formato, namespace y ruta del mensaje inicial, sin imponer TypeScript. No se alteró el contador, el cap, las herramientas configuradas ni la configuración del proveedor.

Se añadieron regresiones que fuerzan el cap para PHP/PHPUnit y TypeScript/Vitest. Ambas verifican que las instrucciones iniciales continúan en el historial y que la llamada final usa `tools: []`; el caso PHP verifica un archivo Laravel/PHPUnit 11 completo (`<?php`, namespace `Tests\\Feature`, `Tests\\TestCase`, clase y método `test_...`) y que el cierre no mencione TypeScript ni Pest.

El ciclo 1 de revisión encontró que la primera variante del fixture PHP usaba Pest pese al título PHPUnit. Se corrigieron únicamente el prompt y las aserciones de esa regresión; el código de producto no cambió. El resultado actual es el que se describe arriba y queda para segunda revisión independiente.

## Archivos

- `app/src/generation/agent/generalist-agent.service.ts`
- `app/src/generation/agent/generalist-agent.service.spec.ts`

## Verificación

- `npx vitest run src/generation/agent/generalist-agent.service.spec.ts`: 1 archivo, 19 pruebas aprobadas.
- `pnpm lint`: aprobado.
- `pnpm test` (repetido tras el arreglo del fixture): 138 archivos aprobados, 6 omitidos; 2.104 pruebas aprobadas, 104 omitidas.
- `pnpm build`: aprobado.
- `git diff --check`: aprobado.

La implementación queda pendiente de revisión independiente. No se modificaron contratos, persistencia, Sandbox, otros repositorios ni infraestructura; no hubo commit ni push.

**Handoff del implementer:** `APPROVED` · sin blockers · archivos y verificaciones enumerados arriba · siguiente paso: revisión independiente del corte.
