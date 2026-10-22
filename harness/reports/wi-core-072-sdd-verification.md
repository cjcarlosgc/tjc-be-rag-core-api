# WI-CORE-072 — verificación SDD (retroactiva)
Modelo: sdd-analyst · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Veredicto: **CHANGES_REQUESTED** (solo ajustes documentales menores; ningún blocker de alcance). Alcance: commits `5fa5666` y `9945342` y el árbol actual de Core.

## 1. Residuos de «Modo fuera de casa» / awayMode / «Modo Noche»
No hay residuos vigentes en reglas. Vigentes legítimos (negación o validador): `harness/validate-harness.mjs:62` (rechaza awayMode), `harness/state-schema.md:79` (declara su eliminación), `harness/README.md:20` y `:32` (declaran que no existe). `harness/work-items.json:4149` es el propio WI-CORE-072. «Modo Noche»: 0 apariciones. Históricos aceptables: `harness/reports/*` (cierres y revisiones de WI-027…068, `delivery-*`, `merge-review-php-core-pr13.md`) y `harness/state.json` (líneas 6939, 6952, 8263, 8276, 11760, 11797, 13214, 13747…18010, `recommendedNextStep`/notas de handoff de WI cerrados). `harness/progress/current.md:5`: coincidencia solo por la cadena «awayMode/fuera de casa» dentro de texto de progreso histórico (lista de WI cerrados); es registro histórico, no regla. Sin residuos fuera de estos grupos.

## 2. Consistencia documental
Consistentes entre AGENTS.md, WORKFLOW.md, delivery-workflow.md, state-schema.md, roles, agent-profiles.yaml, `.claude/README.md` y harness/README.md en: reviewer IA por defecto e independiente (AGENTS.md:52, WORKFLOW.md:59, roles/reviewer.md), no sustituye DEC ni aprobaciones de alcance/contrato, máximo 2 ciclos (AGENTS.md:52, WORKFLOW.md:59, state-schema `maxReviewCycles: 2`), coordinación por cross (AGENTS.md:29-30, delivery-workflow.md:62-66), cuatro repositorios (AGENTS.md:20, delivery-workflow.md:9, spec/README.md:5), un WI activo con paralelismo dentro del corte (AGENTS.md:22; README), commit autónomo por corte y push/PR/merge solo por orden (AGENTS.md:28, delivery-workflow.md:74, WORKFLOW.md:57), vía rápida (WORKFLOW.md:23-30), reviewers bajo demanda (WORKFLOW.md:34).

Huecos y contradicciones menores:
- G1. «Máximo 2 ciclos» sin matiz: los validadores aceptan una excepción de 4 ciclos con autorización explícita (`harness/validate-completions.mjs:57-66`, `harness/validate-harness.mjs:92-96`). Los documentos no la mencionan en la regla SDD 3.1 (AGENTS.md:52, WORKFLOW.md:59). Es una precisión editorial; documentar «salvo excepción autorizada por el usuario».
- G2. `harness/WORKFLOW.md:28` hace opcional el `sdd-analyst` en FAST, pero `harness/validate-harness.mjs:129` exige `gates.sddVerified === 'G-PASSED'` desde fases posteriores y no distingue `lane`; el documento no dice cómo cumplir el gate en FAST (leader verifica y registra G-PASSED). Falta una frase.
- G3. WORKFLOW.md:7 (`W-AWAITING_APPROVAL` obligatorio) frente a FAST: no se dice si la vía rápida conserva la aprobación del usuario. Aclarar.
- G4. Dos fuentes duplican el texto de «Revisión independiente» (AGENTS.md:52 y WORKFLOW.md:59 son idénticos a nivel de frase); riesgo de divergencia futura, no contradicción actual.
- G5. `.claude/README.md:5` y roles/agent-profiles listan 7 agentes de `.claude/agents/` (+ human-reviewer sin perfil): coherente. `ux-reviewer`: 0 apariciones en agent-profiles.yaml de Core, coherente con README («solo Console»).

## 3. Validadores frente a documentos
- `harness/validate-work-items.mjs:80-81` valida `lane ∈ {STANDARD, FAST}` y rechaza FAST con `contractImpact` o `publishesContract` (coincide con WORKFLOW.md:30; el documento menciona solo «impacto de contrato», el validador también `publishesContract`; coherente).
- `harness/validate-harness.mjs:62,64` rechaza awayMode y exige sddVersion 3.1; `scripts/sdd-check.mjs:11` exige sddVersion 3.1. Coinciden con state-schema.md:79.
- Hueco H1 (contradice harness/README.md:20): README afirma que los cinco validadores «comprueban sddVersion 3.1, rechazan awayMode y validan el campo lane». Verificado: `awayMode` solo lo rechaza `validate-harness.mjs`; `lane` solo lo valida `validate-work-items.mjs`; `sdd-check.mjs` no comprueba ninguno de los dos más allá de la versión. `validate-completions.mjs` y `contract-sync.mjs`: sin referencias a `3.1`, `lane` ni `awayMode` (grep). Corregir la redacción del README (qué valida cada script) o ampliar los validadores.
- Ejecución: `node harness/validate-work-items.mjs` OK (CORE, 72 WI); `node scripts/sdd-check.mjs` OK. `node harness/validate-harness.mjs` FALLA hoy: «SDD gate must pass before this phase» porque el activeWorkItem WI-CORE-072 está `W-IN_PROGRESS` con `sddVerified: G-NOT_RUN`. Es esperado hasta registrar este reporte como evidencia y poner `sddVerified: G-PASSED`.

## 4. Referencias obsoletas de la Fase 1
Corregidas en 5fa5666: README.md (ya no dice «se trasladará»; `grep trasladar` = 0), `.claude/README.md` (lista los 7 agentes), `spec/README.md` (línea base SDD 3.1 en cuatro repositorios). Los números de contrato que 5fa5666 puso en spec/README (2.12/2.16/1.7) se actualizaron después a SYSTEM-2.13, INTEROP-2.17, GH-INTEROP-1.8, que coinciden con las cabeceras de `spec/contracts/*.md`. Sin pendientes.

## 5. Checklist de harness/README.md (verificación con shasum, comparando los cuatro repos hermanos locales)
Idénticos en los cuatro (hash de prefijo igual): `harness/agent-assignment.mjs` (3039f6), `contract-sync-id.mjs` (ce6c9e), `contract-sync-lifecycle.mjs` (1480fe), `roles/human-reviewer.md` (ff3e78), `.claude/settings.json` (18376e), los seis agentes `sdd-analyst`/`implementer`/`implementer-high`/`contract-reviewer`/`reviewer`/`merge-reviewer`, `spec/contracts/system-contract.md` (be55bb) e `interoperability-contract.md` (ab2887), `github-integration-contract.md` (375604) en Core, GH y Console, ausente en Sandbox (coherente con README), directorio `spec/contracts/schemas/` (hash agregado 196d7e en los cuatro) y `app/scripts/generate-contract-types.mjs` (25a0b66d en los cuatro).
Hallazgos:
- C1. `app/src/contracts/contract-validator.ts` NO es idéntico: Console (e5cb2fb5) difiere de Core, GH y Sandbox (7ca8e5b6); la diferencia vista es de estilo (sin punto y coma). Contradice «idéntico byte a byte». Corregir Console o relajar el README.
- C2. README usa rutas relativas a `app/` sin decirlo: escribe `src/contracts/contract-validator.ts` y marca `(en app/)` solo en el script. Los esquemas están en `spec/contracts/schemas/` (raíz). Precisar rutas (`app/src/contracts/contract-validator.ts`).
- C3. README no da el comando de verificación (p. ej. un bucle `shasum` o `git ls-files`); «verificable con shasum» sin receta. Para `schemas/` y `examples/` hace falta un hash agregado (el usado aquí: `find ... | sort | xargs shasum | shasum`).
- C4. «los tipos de `src/contracts/generated/` salen idénticos al regenerar» no se verificó (no se ejecutó regeneración en esta tarea de solo lectura).
- C5. El archivo `harness/roles/human-reviewer.md` es idéntico entre repos, pero `AGENTS.md`/WORKFLOW dicen que `harness/roles/` (salvo human-reviewer) puede diferir: coherente.
- C6. Los repos hermanos en esta máquina son `tjc-be-github-integration-api`, `tjc-be-test-execution-sandbox` y `tjc-fe-rag-developer-console`; el README no los nombra con esas rutas, solo `GH`/`SANDBOX`/`CONSOLE`.

## Resumen de acciones recomendadas
1. Corregir H1 (qué valida cada script) en `harness/README.md:20`.
2. Corregir C1 (Console `contract-validator.ts`) o anotar la diferencia en el README; precisar C2/C3.
3. Documentar G1, G2 y G3 (excepción de 4 ciclos; gate sddVerified y aprobación en FAST).
4. Tras ello registrar `sddVerified: G-PASSED`, correr `validate-harness.mjs` y continuar con la revisión independiente.


## Resolución del leader

- H1/C2/C3: `harness/README.md` precisa qué valida cada script, usa rutas con `app/` y añade la receta del hash agregado para directorios.
- C1: `contract-validator.ts` de Console difiere solo en formato (sin punto y coma); se movió a «Diferencias permitidas» en vez de marcarlo idéntico. No se edita otro repositorio desde Core.
- G1: `WORKFLOW.md` documenta que los validadores solo admiten ampliar el máximo de ciclos con una excepción escrita del usuario por WI (histórico `WI-CORE-036`).
- G2/G3: `WORKFLOW.md` aclara que la vía rápida no cambia la máquina de estados ni los gates (`sddVerified` lo registra el leader con evidencia; la aprobación de alcance sigue su regla normal).
- G4: el texto de «Revisión independiente» duplicado en `AGENTS.md` y `WORKFLOW.md` se acepta; riesgo de divergencia anotado.
- C4: la comprobación de tipos generados idénticos la cubre `pnpm contracts:check` en cada repo (no en este WI).
