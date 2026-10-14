# WI-CORE-066 — comprobaciones técnicas
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Implementación por `implementer` (claude-haiku-5-5, esfuerzo low), un corte; verificación del leader. Commit e7f4e0a.
- Código: `resolvePhpConstructorTypes` (resolutor puro), `PhpDependencyEntry.via?`, render «(vía X)», `resolveTransitiveEntries` en el servicio (excluye declarante, directas, interfaz/enum/trait; solo con firma; total ≤ 20; best-effort), tope que retira primero profundidad 2, `transitiveEntries` interno, `importsUsed` aditivo en `findPhpConstructorDeclarations`, prompt `.5`.
- Rojo → verde: `php-dependency-depth2.spec.ts` (13 pruebas: resolutor, render, dedup/ciclo, exclusiones, límite, tope, error de repositorio, traza sin cambio) y ajustes de repositorio, prompt builder y replay.
- `npx vitest run` (app): 148 archivos pasan, 7 omitidos; 2424 pruebas pasan, 104 omitidas. `oxlint src` sin hallazgos. `tsc --noEmit`: 45 errores (igual que la base, delta 0). Sin build; sin migraciones; sin contrato (traza con solo directas, mapeo de traza y DTOs intactos).
- Riesgos: la traza no muestra las entradas de profundidad 2 (solo el texto del prompt; decisión pendiente de Jean); +52 tokens en SUB-1/SUB-2; cambia el comportamiento PHP en producción al desplegar (solo RAG).
