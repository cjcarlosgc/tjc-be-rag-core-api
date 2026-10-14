# WI-CORE-065 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (código, commit b9e6467) y corte B de harness del leader/implementer (commit 50b3060); verificación del leader.
- Código: `extractPhpConstructorSignature`, `PhpDependencyEntry.signature?`, tope de tokens que retira firmas primero, `findPhpConstructorDeclarations` en `code-chunks.repository.ts`, consulta best-effort en el servicio, convenciones (4) y (5) y versión `.4`.
- Rojo → verde: extracción de firma (promovidas, atributos, comentarios, ausencia), render y tope, repositorio, servicio (ambiguo/ausente no inventa), igualdad de redacción en ambos brazos, agente sin sección, TypeScript idéntico, versión; replay 9/9 con M5 idéntico.
- `npx vitest run` (app): 147 archivos pasan, 7 omitidos; 2411 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base, delta 0). `validate-harness` y `node --test harness/*.test.mjs harness/calibration/*.test.mjs` (64 pruebas) pasan. Sin build; sin migraciones; sin contrato público (traza sin `signature`).
- Riesgos: +70 tokens de convenciones y hasta +37 de firmas por prompt RAG (+6,6 % a +11,1 %); cambia el comportamiento en producción PHP al desplegar; redundancia textual menor `(constructor) — constructor(...)` en el render (aceptada, ya medida).
