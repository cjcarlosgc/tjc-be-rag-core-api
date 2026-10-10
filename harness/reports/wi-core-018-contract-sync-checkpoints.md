# WI-CORE-018 — Contract Sync y sincronización canónica
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

- `start`, `implementation-delivery` y `before-review`: PASS con cero eventos entrantes relevantes pendientes. `CS-20260920-001` y `CS-20260921-003` constan `NOT_RELEVANT` solo para este WI (`wi-core-018-contract-sync-scope-review.md`).
- Publicado `CS-CORE-20261008-002` (`C-PENDING`, `breaking: false`, destino Console) con la implementación de lo ya definido en INTEROP-2.7. `publishesContract` del registro se cambió a `true` para permitirlo.
- Sincronización canónica: SYSTEM-2.6/INTEROP-2.7 no cambian en este WI; los espejos de Console y GitHub Integration ya se sincronizaron en WI-CORE-017. Pendiente de decisión del usuario: el contract-reviewer pide una nota de una frase en §6.11 (preguntas históricas -> `EXPECTED_RESULT`/`LEGACY`; opcionalmente el orden 404 antes de 403). Cambiar texto contractual requiere su aprobación y un Contract Sync nuevo, por lo que el Leader no lo aplicó.
- Decisión del usuario (Human Reviewer): se aplicó la nota de una frase en INTEROP-2.7 §6.11 (históricas -> `EXPECTED_RESULT`/`LEGACY`, commit `1c317f4`) y `CS-CORE-20261008-002` se reemitió (sin importar aún por Console) con esa ampliación y `sourceRevision` `1c317f4ab5baad0214f2f6d3c003e7f9db68be24`; ver `contract-sync-publish-cs-core-20261008-002.md`. Versión INTEROP sin cambio.
- `before-done`: PASS el 2026-10-08 tras el veredicto humano; cero eventos entrantes relevantes pendientes y las mismas clasificaciones locales.
