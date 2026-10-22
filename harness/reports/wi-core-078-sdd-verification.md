# WI-CORE-078 — verificación SDD (solo lectura)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Estado: DECISION_REQUIRED (solo la aprobación de alcance, con los números de abajo). No se leyó `app/.env`. No se tocó código ni `state.json`.

## 1. L1 — mensajes que repiten un valor de entorno

Solo hay dos sitios en `app/src/config/env.validation.ts`:

| Línea | Variable(s) | Mensaje actual |
|---|---|---|
| 425 | `SANDBOX_POLL_RETRIES`, `SANDBOX_POLL_RETRY_DELAY_MS` (vía `parseSandboxPollInteger`) | `...${name}="${text.slice(0, 40)}" no es válido; debe ser un entero ${rangeLabel}.` |
| 457 | `LLM_REASONING_EFFORT` | `...LLM_REASONING_EFFORT="${effort.slice(0, 40)}" no es un esfuerzo válido; valores válidos: ...` |

No repiten el valor: `LLM_MODEL` (l. 441, solo el default constante), l. 419 (default constante), l. 287 (`errors.toString()` de class-validator, que lista propiedad y constraint, no el valor), l. 296-348 (texto fijo), l. 478/483 (texto fijo). No hay otro con el patrón.

**Propuesta de escape.** Un helper único `echoEnvValue(text)` que devuelve el literal ya con comillas, y los dos mensajes pasan de `="${x}"` a `=${echoEnvValue(x)}`.
- Orden: **recortar primero (a 40 puntos de código, `Array.from(text).slice(0, 40).join('')`) y escapar después.** Así nunca se corta una secuencia de escape a la mitad (`\u00`), «40 caracteres» sigue significando 40 caracteres del valor, y el mensaje queda acotado (máx. 40 × 6 + 2). Recortar después daría literales inválidos.
- `JSON.stringify` escapa `"`, `\`, `\n`, `\r`, `\t` y todo C0 (< U+0020) como `\uXXXX`. Un sustituto suelto sale como `\udXXX` (JSON bien formado). Lo que NO escapa y puede partir/falsear una línea de log: `U+007F`, `U+0080–U+009F` (incluye NEL U+0085), `U+2028`, `U+2029`. Se escapan con un `replace(/[\u007f-\u009f  ]/g, c => '\\u' + hex4)` posterior. El resto de Unicode imprimible (acentos, CJK, emoji) se deja tal cual.
- Sin elipsis al recortar (un test fija exactamente 40 `x` seguidos de `" no es`).

**Compatibilidad.** Para un valor normal (`abc`, `ultra`, `HIGH`, `11`, `x`×40) `JSON.stringify` da exactamente `"valor"`, así que `="valor"` queda **idéntico**. Solo cambian valores con `"`, `\`, control, U+007F–U+009F, U+2028/9 (hoy se imprimen crudos). Una `"` pasa a verse `\"`, es decir, esos mensajes SÍ cambian de texto, y es el objetivo.

**Pruebas que fijan los mensajes actuales** (`app/src/config/env.validation.spec.ts`), ninguna se rompe:
- LLM_REASONING_EFFORT: «outside the reasoning scale…» (l. 208-216, `"ultra"`, `"HIGH"`, `x`×40).
- SANDBOX_POLL_*: «not numeric» (l. 382-387), rango (l. 409-417, `"11"`, `"0"`), truncado a 40 (l. 421-423), «does not expose secrets».
- Ninguna usa comillas, `\`, saltos de línea ni Unicode: no hay prueba que cambie.

## 2. Topes de SANDBOX_MAX_POLL_ATTEMPTS y SANDBOX_REQUEST_TIMEOUT_MS

**Usos (archivo:línea)**
- Declaración: `env.validation.ts:180-186` (`@IsInt @Min(100)` = 10_000 y `@IsInt @Min(1)` = 120).
- Defaults de código: `sandbox-execution.service.ts:78-79` (`DEFAULT_REQUEST_TIMEOUT_MS = 10_000`, `DEFAULT_MAX_POLL_ATTEMPTS = 120`); `.env.example:72-73` (10000 y 120).
- `SANDBOX_MAX_POLL_ATTEMPTS`: `sandbox-execution.service.ts:343-346` (cota del bucle de consultas de estado); `experiment-job.handler.ts:512-515` (cota de latido).
- `SANDBOX_REQUEST_TIMEOUT_MS`: `sandbox-execution.service.ts:505-509` (AbortController por request); `experiment-job.handler.ts:508-511` (cota de latido).
- Cota: `attempt-recovery.ts:121-136` (`sandboxHttpBoundMs`) y `resolveHeartbeatStaleMs` (l. 141-150); `heartbeatStaleMs()` en `experiment-job.handler.ts:~500-526`.
- Pruebas que las usan como entrada (no validan topes): `experiment-job.handler.spec.ts:5107-5108,5177-5178`, `sandbox-execution.*.spec.ts`, `attempt-recovery.spec.ts:111-210`.

**Hoy sin tope superior.** Con `SANDBOX_MAX_POLL_ATTEMPTS=1e9` el bucle no termina en la práctica y `heartbeatStaleMs` crece sin límite (retraso de detección de un intento muerto). Un `SANDBOX_REQUEST_TIMEOUT_MS` enorme hace lo mismo y supera el `setTimeout` máximo (2^31-1 ms ≈ 24,8 días, desborda a 1 ms).

**Mismo problema que SANDBOX_POLL_* (verificado leyendo el código, sin ejecutar):** class-validator con `enableImplicitConversion` hace `Number(valor)`: `"1e3"`→1000, `"0x10"`→16, `" 5 "`→5, `"+3"`→3 pasan; `""`→0 falla solo por `@Min` (mensaje de class-validator, no claro); `"abc"` y decimales fallan por `@IsInt` también con mensaje genérico. Es decir: se aceptan notaciones raras y los mensajes no dicen valor ni rango.

**Propuesta** (patrón `validateSandboxPollSettings`, texto crudo, `^\d+$`, `Number.isSafeInteger`, ausente = default, vacío/solo espacios = error). Se retiran `@IsInt/@Min` de ambas propiedades (pasan a `@IsOptional()` como las POLL) y se escribe el número normalizado en `validated`. Se reutiliza `parseSandboxPollInteger` generalizada (nombre y etiqueta del tope); esto es 1 helper, no una función nueva.
- `SANDBOX_MAX_POLL_ATTEMPTS`: entero **1..600** (default 120).
- `SANDBOX_REQUEST_TIMEOUT_MS`: entero **100..60000** ms (default 10000).
- Mensajes exactos (mismo formato que 077):
  - `Configuración de entorno inválida: SANDBOX_MAX_POLL_ATTEMPTS="x" no es válido; debe ser un entero entre 1 y 600.`
  - `Configuración de entorno inválida: SANDBOX_REQUEST_TIMEOUT_MS="x" no es válido; debe ser un entero entre 100 y 60000 (ms).`
  - Vacío: `Configuración de entorno inválida: SANDBOX_MAX_POLL_ATTEMPTS no puede estar vacío; si no la define se usa el valor por defecto 120.` y `...SANDBOX_REQUEST_TIMEOUT_MS no puede estar vacío; si no la define se usa el valor por defecto 10000.`

**Justificación con números** (cota B = T + (P+1)·((R+1)·T + Σ min(D·2^k, 30000)), defaults R=3, D=500):
- Defaults: perGet = 4·10 000 + 3 500 = 43 500; B = 10 000 + 121·43 500 = **5 273 500 ms** (≈1,46 h).
- Tope propuesto con R, D por defecto: T=60 000, P=600 → perGet = 240 000 + 3 500 = 243 500; B = 60 000 + 601·243 500 ≈ **146,4 M ms (≈40,7 h)**. Es el techo con reintentos por defecto; con T=10 000, P=600: B = 10 000 + 601·43 500 ≈ 26,2 M ms (≈7,3 h).
- Un tope por variable NO acota el producto (R=10, D=30 000, T=60 000, P=600 daría ≈577 M ms ≈ 6,7 días). Se declara: los topes evitan valores absurdos/desbordes, no acotan B. Una cota conjunta (p. ej. B ≤ 24 h) rechazaría la combinación P=600, T=60 000 aun con R por defecto: **no la recomiendo**; si se quisiera, es decisión aparte.
- Por qué 600 y 60 000: P=600 = 5× el default (con espera mínima ≥1 s, ≥10 min de sondeo; ya ≥ 1 h con `pollAfterMs` típicos); T=60 000 = 6× el default y 2× `OPENAI_TIMEOUT_MS`; ambos > cualquier valor plausible de producción visto en el repo (defaults 120/10 000; las pruebas usan 5/5000). Ninguno se acerca al límite de `setTimeout`.
- Efecto de un `heartbeatStaleMs` grande: solo retrasa detectar un intento muerto; `EXPERIMENT_HEARTBEAT_STALE_MS` permite fijarlo a mano.

**Riesgo en Render:** se desconocen los valores reales. Fallarían el arranque: `SANDBOX_MAX_POLL_ATTEMPTS` >600 (p. ej. 1000, 1200 o 3600 usados «por seguridad»), `SANDBOX_REQUEST_TIMEOUT_MS` >60000 (p. ej. 120000), y cualquier valor con unidades (`10s`, `10_000`), decimales (`2.5`), signo (`+120`), notación (`1e4`), vacío o con espacios internos. `" 120 "` con espacios laterales sigue válido (trim). Mitigación obligatoria: **el usuario revisa las dos variables en el panel de Render antes de desplegar** (o confirma que no están definidas). Rollback trivial: el arranque falla con mensaje claro, se corrige la variable.

## 3. O3 — ¿sumar pollAfterMs a la cota de latido?

Cálculo (defaults): peor caso de esperas = 120 × MAX_POLL_AFTER_MS (30 000) = **3 600 000 ms**.
- Hoy `heartbeatStaleMs` = GENERATION_TIMEOUT (120 000, deducido de 5 393 500 − 5 273 500) + B 5 273 500 = **5 393 500 ms** (≈1 h 29 m 54 s).
- Sumando las esperas: 5 393 500 + 3 600 000 = **8 993 500 ms** (≈2 h 29 m 54 s), +66,8 %.

**¿ES un cambio de comportamiento observable? Sí.** Es una constante de reconciliación: un intento RUNNING cuyo worker murió se declara vencido y se relanza solo tras `heartbeatStaleMs` sin latido. Subirlo 1 h (a) retrasa en 1 h la detección y el relanzamiento de intentos muertos, (b) alarga el tiempo hasta estado terminal/reintento visible para el usuario y por tiempo real (WI-074), (c) cambia qué pruebas de recuperación fijan valores concretos (`attempt-recovery.spec.ts:119,184,195,207` fijan 5 273 500 y 1 220 000) y los registros/logs. Beneficio: evitaría relanzar un intento vivo si el Sandbox informara siempre 30 s (caso extremo; hoy el default `FALLBACK_POLL_AFTER_MS` es 1000 ms y el latido ya se renueva mientras el worker vive, así que el falso positivo requiere worker sin latido, no solo espera larga). La cota es una cota superior conservadora, no una probabilidad.

**Recomendación: NO tocarlo en este WI** salvo decisión explícita del usuario. Trade-off: no tocar mantiene detección más rápida (1,5 h frente a 2,5 h) con un riesgo teórico de relanzar un intento muy lento en un Sandbox que pida 30 s siempre; tocarlo da más margen contra falsos relanzamientos a costa de 1 h extra de recuperación. Dejar como observación O3 documentada (sin cambio) en el cierre.

## 4. Pruebas nuevas, documentación y riesgos

Pruebas nuevas (en `env.validation.spec.ts`; ninguna existente cambia):
1. Eco: valor con `"` y `\` (se muestra escapado); con `\n`/`\r`/`\t` y U+0085/U+2028 (el mensaje no contiene saltos reales: `not.toMatch(/[\n\r\u0085  ]/)` sobre la parte del valor); emoji y acentos intactos; sustituto suelto escapado; valor de 60 caracteres con escape en la frontera (no hay `\u` truncado); para `SANDBOX_POLL_*` y `LLM_REASONING_EFFORT`.
2. Regresión de formato: `="abc"`, `="ultra"`, `="x"×40` idénticos.
3. Topes: default sin variable (120 y 10000); límites 1/600 y 100/60000 aceptados y guardados como número; 0, 601, 99, 60001, `abc`, `2.5`, `-1`, `+3`, `1e3`, `0x10`, números enormes, vacío y solo espacios fallan con el mensaje exacto; recorte a 40; `" 120 "` válido; sin secretos en el mensaje.
4. Prueba de unidad del helper de eco y una sobre `sandboxHttpBoundMs` con los topes máximos (sin desborde, finito, `< 2^53`).

Documentación: `.env.example` (rangos y default junto a `SANDBOX_REQUEST_TIMEOUT_MS`/`SANDBOX_MAX_POLL_ATTEMPTS`, aviso de que fuera de rango falla el arranque); `CHANGELOG.md` [Unreleased] con alcance aprobado, cambio de formato solo en caracteres especiales, topes nuevos, O3 sin cambio, aviso de revisar Render. Sin cambio de contrato ni de `spec/` normativo.

Riesgos: (1) arranque fallido en Render si hay valores fuera de rango (ver §2); (2) los topes no acotan el producto B (declarado); (3) quitar `@IsInt/@Min` de las dos propiedades: asegurar que `configService.get` siga entregando número (se escribe el normalizado en `validated`, como 077) y que no queden consumidores leyendo string; (4) los tests de handler/servicio que inyectan strings (`'10000'`) no pasan por validateEnv: sin impacto.

Decisiones PENDING/PROPOSED con Blocks que alcancen este WI: **ninguna**. `DEC-VAL-001` (PENDING) solo afecta retención/alcance de datos; `DEC-AUTH-001` solo la pareja URL/token; la verificación de WI-071 y una búsqueda de `Blocks`+PENDING/PROPOSED en `spec/` no encontraron otra.

## 5. Decisiones del usuario realmente necesarias
1. **Aprobar el alcance** con estos datos: escape L1 (recortar y luego escapar, con U+007F–U+009F/U+2028/9 extra), topes 1..600 y 100..60000, mensajes exactos, O3 sin cambio. Opcional: ajustar los topes si conoce valores reales de Render.
2. **Confirmar los valores actuales en Render** (acción suya, previa al despliegue; no bloquea la implementación).
3. O3: solo decisión si quiere SUMAR las esperas (no recomendado); por defecto no se toca.
Nada más.
