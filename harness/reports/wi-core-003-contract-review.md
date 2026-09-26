# Revisión contractual — WI-CORE-003

Fecha: 2026-09-25. Reviewer independiente: `/root/oauth_contract_review`, rol `contract-reviewer`. Alcance: `GH-INTEROP-1.0` y sus referencias en contratos `SYSTEM`/`INTEROP` de Core y Console. Esta aprobación cubre la documentación y arquitectura revisadas; no declara terminado `WI-CORE-003` ni aprueba una implementación.

**Veredicto final:** `APPROVED`.

El primer pase pidió cambios por contradicciones que todavía describían la frontera privada como no aprobada y atribuían a Core llamadas GitHub directas. Se actualizaron las referencias en los contratos `SYSTEM` e `INTEROP` de ambos repositorios. La verificación final confirmó que las dos copias `SYSTEM` y `INTEROP` coinciden byte por byte y que el onboarding refleja Core → GitHub Integration para discovery.

La revisión confirma que Supabase Auth permanece como identidad, Console continúa llamando solo a Core, el provider token solo se transmite transitoriamente para discovery, el alcance amplio del OAuth `repo` queda explícito y su evaluación de menor privilegio se difiere a `IDEA-005`. El contrato está aprobado como diseño, aún no implementado ni desplegado.

Verificaciones posteriores a las correcciones:

- Core: `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs`, `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-003` y `git diff --check` — pasan.
- Console: `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `git diff --check` — pasan.
- `spec/contracts/system-contract.md` y `spec/contracts/interoperability-contract.md` coinciden byte por byte con sus copias de Console.

## Addendum — reorientación aprobada a GH-INTEROP-1.1 (2026-09-26)

El veredicto anterior cubría `GH-INTEROP-1.0`; su frase «Console continúa llamando solo a Core» quedó supersedida por la decisión aprobada después por el usuario. La topología vigente permite Console→GitHub Integration solo para App info, discovery, verificación y ramas; Core conserva dominio/persistencia y valida autorización síncrona, y las rutas Core equivalentes permanecen por compatibilidad. `GH-INTEROP-1.1` ya refleja el límite y tiene espejo idéntico. La revisión contractual formal de esta versión y el Contract Sync `CS-GH-20260926-001` siguen pendientes; este addendum no los aprueba ni cierra gates.
