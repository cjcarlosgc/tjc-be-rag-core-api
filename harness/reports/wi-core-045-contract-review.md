Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low
# WI-CORE-045 — revisión contractual previa a editar INTEROP/SYSTEM

**Veredicto: CHANGES_REQUESTED** (la propuesta A–E es aceptable en fondo; requiere los ajustes de abajo antes de editar). DEC-VAL-002 se publica como PROPOSED; no hay DECISION_REQUIRED que bloquee este WI documental.

## 1. Compatibilidad
- A (404 FUNCTIONAL_QUESTION_NOT_FOUND, orden de errores): aclaratorio. Código verificado en `functional-knowledge.service.ts` (`questionNotFound`, `isRunStale`). Sin cambio de ruta, campo ni código; Console/Integration/Sandbox no se rompen.
- A (continuationAttemptId): aclaratorio; el tipo `Id | null` ya existe. Solo se documenta cuándo es null y que es opaco.
- A/B (functionalBehaviorValidated): aclaratorio; mismo tipo boolean, semántica ya implementada (handler líneas ~324).
- B (resultSummary OC11): aclaratorio SOLO si se redacta como «texto para personas, no enum, sin valor garantizado»; el texto «PR excede 300 archivos…» es hoy comportamiento NO implementado (lo dará el WI de OC11). No debe leerse como garantía vigente.
- C (DEC-VAL-002): PROPOSED, sin efecto normativo hasta aprobación. Compatible. Su aprobación sí cambia la clasificación de SYSTEM (hoy `INFRASTRUCTURE_FAILURE` solo por job; símbolo con SandboxUnavailable es TECHNICAL) y el Check del PR: es cambio de comportamiento observable, no solo aclaración.
- Console/Integration/Sandbox: ninguno necesita cambio de código. Integration solo recibe documentación del límite 300 que ya es suyo (GH-INTEROP «Compare», UNVERIFIABLE).

## 2. Versionado
- La convención (`delivery-workflow.md` l.11) dice que INTEROP/SYSTEM «solo cambian [de versión] cuando cambia su contrato correspondiente». INTEROP se espeja byte por byte en Console: cualquier edición de texto produce un archivo distinto con la misma etiqueta INTEROP-2.8, lo que vuelve indistinguibles los espejos viejos y nuevos y rompe la verificación por versión.
- Recomendación: **INTEROP-2.9** (aditivo, `breaking:false`; aclara §6.10/§6.11 y fija el 404 como parte del contrato). Una «nota de estado» sin versión no basta porque A y d/e agregan reglas normativas observables (código de error previo a autorización, null/no null, semántica de boolean).
- SYSTEM: **no** SYSTEM-2.10 mientras DEC-VAL-002 sea solo PROPOSED y se inserte como bloque de decisión sin alterar la lista de clasificación vigente; PERO el archivo cambia. Precedente: SYSTEM-2.9 subió por aprobar DEC-INF-001. Acepto «sin bump + nota fechada» solo si el bloque se limita a la sección DEC-VAL-002 y una línea de estado; si el leader inserta texto bajo «Baseline, generación y clasificación» (propuesta C), pido SYSTEM-2.10 para evitar dos textos distintos bajo la misma versión en el espejo. Opción más limpia: dejar el texto normativo de C únicamente en la sección `DEC-VAL-002` y en «Baseline» solo una línea «Ver DEC-VAL-002 (PROPOSED)»; entonces sin bump.
- Reglas: la aprobación posterior de DEC-VAL-002 exigirá SYSTEM-2.10 (o 2.11 si ya se usó) y probablemente INTEROP-2.10 si cambia §6.10.

## 3. Redacción — cambios exactos pedidos
1. A, primer párrafo: quitar «(`OBSOLETE`, no `current` o fuera de `ACTION_REQUIRED`...)» como enumeración cerrada de causas; decir «no es accionable (...)» y añadir «Condiciones evaluadas en este orden: Run inexistente o no visible → 404 ANALYSIS_RUN_NOT_FOUND; pregunta no accionable → 404 FUNCTIONAL_QUESTION_NOT_FOUND; rol insuficiente → 403 PROJECT_ROLE_INSUFFICIENT.» Con esto un Reader que responde tarde recibe 404, no 403: es la consecuencia deliberada; decirlo explícitamente (no filtra existencia porque ya tiene visibilidad del Run).
2. A, «una respuesta tardía no se conserva como regla potencial»: reemplazar por «no se conserva»; «regla potencial» no es término definido en SYSTEM.
3. A, continuationAttemptId: añadir «Es null también si la respuesta ANSWERED deja al Run en ACTION_REQUIRED»; mantener «opaco, no consultable». Conservar el comentario de INTEROP-2.7 sobre ABSTAINED.
4. functionalBehaviorValidated: redactar «true solo si Run SUCCESS o NO_ADDITIONAL_TESTS_REQUIRED; false en cualquier otro estado y mientras no completó». Quitar «No acredita que un baseline se haya ejecutado (OC09)» salvo que OC09 esté definido en spec; si no, citar la feature 013.
5. B: marcar la frase del mensaje de OC11 como «comportamiento objetivo del WI de OC11 (pendiente)», no estado actual. Mantener que 300 es de GitHub Integration (`COMPARE_MAX_CHANGED_FILES` no se nombra en el contrato de Core; sí «límite de GitHub Integration»: el nombre de constante es detalle de otro repo y puede volverse obsoleto, omitirlo).
6. C: «Fallo de plataforma por símbolo» como DEC-VAL-002 PROPOSED es correcto. Añadir que el estado actual (excepción de Sandbox por símbolo → TECHNICAL_GENERATION_FAILURE) permanece vigente hasta aprobación, y que la alternativa A2/A3 cambia el color del Check (`failure` vs `neutral`) y la publicación del companion PR. Mantener `Blocks: spec/features/013-pr-driven-analysis` limitado al WI de código de OC08.

## 4. Contract Sync
- Targets: `console` y `github-integration`. Sandbox NO: la clasificación por categoría ya la emite y el contrato SYSTEM que se edita es propiedad del lado Core; Sandbox mantiene SYSTEM-2.2/línea 2.1.
- scopePaths: `spec/contracts/interoperability-contract.md` y `spec/contracts/system-contract.md`. (Integration solo mira el segundo por la mención de Compare.) El contrato GH no se edita, no incluirlo.
- breaking: false.
- changed (propuesto): «INTEROP-2.9: aclara 404 FUNCTIONAL_QUESTION_NOT_FOUND y su orden frente a ANALYSIS_RUN_NOT_FOUND/403 en POST …/answers (§6.11), continuationAttemptId null u opaco, semántica de functionalBehaviorValidated y resultSummary de OC11 (§6.10/§6.11). SYSTEM: DEC-VAL-002 PROPOSED (fallo de plataforma por símbolo y precedencia del Run), sin efecto normativo hasta su aprobación.»
- requiredAction console: «Espejar INTEROP-2.9 byte por byte; sin cambio de DTO. Tratar 404 FUNCTIONAL_QUESTION_NOT_FOUND en el envío de respuestas como pregunta obsoleta y refrescar el inbox; no asumir que continuationAttemptId no nulo es consultable.»
- requiredAction github-integration: «Revisar solo la descripción del límite de 300 archivos del compare como propiedad de Integration; sin cambio de código ni contrato GH. Espejar INTEROP-2.9 solo si lo mantiene.»
- `sourceWorkItem: WI-CORE-045`, `sourceRevision`: SHA completo del commit contractual (no reescribir tras publicar).

## 5. Cabeceras
- INTEROP «Compatible con: SYSTEM-2.7» es una incoherencia previa: el propio §8 cita SYSTEM-2.9 y el SYSTEM actual es 2.9. Corregirla en este corte a `SYSTEM-2.9` (o a `SYSTEM-2.9 (DEC-VAL-002 PROPOSED)`); como se sube la versión INTEROP de todos modos, no genera cambio extra. Actualizar también «Fecha de corte» y la frase §1 «INTEROP-2.8 es la versión documental vigente».
- En §1 y el párrafo de estados, no eliminar la historia 2.7/2.8; solo añadir 2.9.

## 6. DEC-VAL-002
Publicar como PROPOSED con recomendación y alternativas, como hace DEC-VAL-001 (PENDING). No esperar aprobación para el resto del corte: la propia aprobación de alcance (b) lo prevé. No implementar ni citar su precedencia como regla vigente en feature 013/OC08 sin la etiqueta PROPOSED.

## Confirmación (2026-10-12)

**APPROVED.** El texto aplicado cumple §3-§6: orden de errores 404 ANALYSIS_RUN_NOT_FOUND / 404 FUNCTIONAL_QUESTION_NOT_FOUND / 403 con la consecuencia para Reader declarada; «no se conserva» sin «regla potencial» en los contratos; `continuationAttemptId` null (ABSTAINED o ANSWERED que deja ACTION_REQUIRED) y opaco; `functionalBehaviorValidated` solo true con SUCCESS o NO_ADDITIONAL_TESTS_REQUIRED, con cita a OC09; `resultSummary` de OC11 marcado como objetivo pendiente sin nombre de constante; DEC-VAL-002 PROPOSED solo en su sección más una línea en «Baseline», con estado vigente y alternativas A2/A3 que cambian el Check, y `Blocks` acotado al WI de código de OC08; cabecera INTEROP-2.9 / Compatible con SYSTEM-2.9; SYSTEM-2.9 sin bump.

Observación no bloqueante: `spec/contracts/system-contract.md` l.68 sigue diciendo que el detalle vive en `INTEROP-2.8`; puede corregirse a INTEROP-2.9 en el siguiente bump de SYSTEM (no tocar ahora para no cambiar texto de SYSTEM fuera de DEC-VAL-002 bajo la misma versión).
