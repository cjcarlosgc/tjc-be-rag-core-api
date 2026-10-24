# WI-CORE-086 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Veredicto: APPROVED** (con 3 observaciones no bloqueantes).

## 1. Fidelidad
- D-3, D-6, D-7: repiten la recomendación aceptada sin cambiar su sentido (D-6 añade solo «Prisma/SQL», descriptivo y ya presente en la discrepancia de C-10).
- D-4: conserva el sentido (CT-03 candidatos+score; CT-05 recorte). Añade «orden determinista» y «topK/minimumScore», tomados del texto vigente de CT-03-A4 y CT-05-A2 («así quedó CT-03-A4»); aceptable. Ver O-1.
- D-12: refleja lo aprobado (una ronda; esquema CT-01, E-01, SYSTEM-2.15, corrección de `sandbox-result.failed.json`; sin `oracleRef`; INTEROP-2.20 / GH-INTEROP-1.9). El dato `COMPOSER_INSTALL_FAILED` inexistente / `DEPENDENCY_INSTALL_FAILED` real está verificado: `tjc-be-test-execution-sandbox/app/src/common/errors/sandbox-fact-error.ts:87`; el ejemplo en `spec/contracts/schemas/examples/sandbox-result.failed.json:11`; no hay `COMPOSER_INSTALL_FAILED` en `src` de Core ni Sandbox. Ver O-2 por la última frase.
- D-13: recoge «forks del usuario con la App instalada». Las consecuencias (workspace = dueño del fork; binding antes del PR) coinciden con el código: `repository-bindings.service.ts:65` (`requireInstallation`), `github-repository-access.service.ts` (`outsideWorkspace()` → 400 `REPOSITORY_OUTSIDE_WORKSPACE`, `appAccessRequired()` → 403 `GITHUB_APP_ACCESS_REQUIRED`), y están en `arch-v1.0-impacto-pilotos-core.md` (WI-CORE-085). Se señala correctamente como detalle abierto la cuenta dueña (personal u organización). Los números de línea exactos del reporte 085 no se re-verificaron uno a uno.

## 2. Coherencia interna
- Tabla resumen, CT-02 (nota), CT-04-A2, CT-10 (discrepancia) y «Orden sugerido» no contradicen las decisiones.
- Conteos recomputados por columna: 52 / 21 / 14 / 17 (cuadran; 21+14+17=52).
- No quedan «pendientes» obsoletos (sección «Pendientes: Ninguna…»). Ver O-3.

## 3. Alcance
`git status`: solo `harness/reports/arch-v1.0-aserciones-ct-propuesta.md`, `harness/state.json`, `harness/work-items.json`, `spec/features/017-.../tasks.md` (ST-CORE-093) y `harness/reports/wi-core-086-scope.md` (nuevo). Sin cambios en `app/`, `spec/contracts`, `referencias/`, `AGENTS.md` ni tesis.

## 4. Harness (PATH node22)
- `node scripts/sdd-check.mjs`: SDD check OK
- `node harness/validate-work-items.mjs`: passed (CORE, 86 WI)
- `node harness/validate-harness.mjs`: passed
- `node harness/validate-completions.mjs`: passed (82 completed WI)

## Observaciones (no bloqueantes)
- **O-1** (D-4, línea ~165 de la propuesta): las precisiones «orden determinista» y «topK/minimumScore» no son literales de la recomendación; si se quiere fidelidad estricta, dejar «CT-03 cubre candidatos+score y CT-05 el recorte (así quedó CT-03-A4)».
- **O-2** (D-12, última frase): «La ejecución es `WI-CORE-079` (reactivado); Integration, Sandbox y Console reciben su parte por Contract Sync vía cross» es plan del leader, no texto aprobado por el usuario; hoy WI-CORE-079 figura `W-PLANNED` con título solo de E-01. Conviene rotularlo «plan (no decisión)» o marcar que la reactivación/ampliación del WI sigue pendiente de registrarse.
- **O-3** (sección «Pendientes»): «Ninguna decisión de CT queda abierta» convive con el detalle abierto de D-13 (cuenta personal u organización). Sugerido: «Ninguna decisión de CT; detalle abierto fuera de CT: cuenta dueña de los forks (D-13)».

## 5. Decisiones que el usuario aún debe tomar
Solo la cuenta dueña de los forks (personal u organización), ya señalada en D-13 y en el alcance del WI. El documento no da por decidido nada más.
