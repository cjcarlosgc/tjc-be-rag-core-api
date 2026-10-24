# WI-CORE-084 — revisión independiente (ciclo 1 de 2)
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

**Veredicto: APPROVED** (con 1 observación menor no bloqueante).

## 1. Requisitos conservados (008 antes vs. después)
| Afirmación antigua | Estado |
|---|---|
| Congelar repositoryId, SHA y effectiveProjectRoot antes de la primera corrida; mismo snapshot por par | Presente (viñeta 1) |
| Condiciones pareadas, 3 repeticiones, sesiones frescas | Presente por referencia a «Alineación SMART V3 — OE5» (viñeta 2) |
| CF/CO/VT, sin oráculo ni ganador automático | Presente (viñeta 3) |
| Oráculos externos, no copiarlos a repos | Presente (viñeta 4) |
| No modificar repos piloto ni E2E hasta verificar acceso y congelar | Presente (viñeta 5) |
| Complemento de OC01–OC15 | Presente (último párrafo) |
| Permisos, HEADs, projectRoot confirmados antes de ejecutar | Cubierto por «verificar acceso y congelar» y el congelado de HEAD/projectRoot |
| «Dependencias y existencia de símbolos» a confirmar antes de ejecutar | PERDIDO como frase explícita (L-1, menor) |
| Aviso «tabla = protocolo de selección, no evidencia verificada» | Perdido; era propio de la tabla eliminada (aceptable) |
| Tabla de 9 símbolos, nombres de repos, 9 targets / 27 pares / 54 ejecuciones | Identidad y dato de investigación (aceptable; vive en cross/tesis) |

Hallazgo L-1 (menor, no bloqueante): la verificación previa de dependencias y de existencia del símbolo target no figura en la sección nueva. Sin embargo, se cubre en la práctica porque el target y el oráculo son decisión de investigación fuera del SDD y la verificación de símbolos forma parte del flujo de resolución de targets de Core. Sugerencia opcional: añadir «y dependencias y símbolos target» a la viñeta 5 en un cambio futuro; no justifica un segundo ciclo.

## 2. Contradicciones
- Coincide con «Alineación SMART V3 — OE5» (spec 008, líneas 56-65): repeticiones por target y estrategia, sesiones frescas, orden aleatorio reproducible, configuración y presupuesto comunes, oráculo excluido de RAG y GENERALIST_AGENT. La sección nueva remite a ella en lugar de duplicarla.
- Coincide con `spec/transversal/experimental-metrics` (CF primaria, CO secundaria, VT guardrail, sin ganador ni significancia automáticos).
- Sobre la configuración única del LLM (`providers/spec.md` WI-CORE-076/075): la sección dice «misma configuración de LLM», sin fijar modelo ni esfuerzo; sin conflicto (los modelos quedan en la sección WI-CORE-075 de 008).
- 019 line 37 remite a «Repositorios piloto del experimento», y ese encabezado existe exactamente en 008 línea 67.

## 3. No duplica lo que gobierna cross
El grep indicado sobre 008 (`brick|doctrine|Escola|11600|54 ejecuciones|27 pares`) no devuelve nada. La sección nueva menciona «modalidad (controlado o basado en un issue público)» solo como categoría genérica de decisión de investigación, sin fijar valor. Sin identidades ni totales. Observación: 008 L65 conserva «piloto cross-repo» (frase genérica, preexistente, correcta).

## 4. Restos antiguos en el SDD
`grep` de «Validación Ventas|SAL-1|RES-1|SUB-1|tjc-piloto» fuera de CHANGELOG/harness/reports: solo
- `spec/contracts/system-contract.md:287` (`tjc-piloto-ventas`, E2E histórico) → contratos, lote de erratas, fuera del alcance declarado;
- `spec/ideas.md:43` e IDEA-037 y `spec/features/004-rag-retrieval-context/spec.md:54,58` (coincidencias con términos de ejemplos de dependencias PHP, no identidades de pilotos; informativo, sin decisión);
- las menciones a «Suscripciones» restantes son WebSocket (no relacionadas).
El alcance declarado menciona además que `interoperability-contract.md` cita pilotos antiguos; el grep de tokens específicos no los halló, y se deja como lote de erratas. No se decide nada aquí.

## 5. Alcance y validadores
- El commit toca: CHANGELOG.md, harness (reporte, state.json, work-items.json), spec/008 (spec.md y tasks.md), spec/019/spec.md. `git diff HEAD~1 --stat -- app AGENTS.md spec/contracts` vacío. AGENTS.md de Core intacto.
- Validadores en verde: sdd-check (OK), validate-work-items (84 WI), validate-harness (Harness V3), validate-completions (80 WI).
- Árbol de trabajo limpio salvo este informe. No se leyó `app/.env`.

## Evidencia
`git show HEAD --stat`; comparación `HEAD~1:spec/features/008.../spec.md` líneas 67-95 vs. actual 67-80; greps citados; 4 validadores con rc=0.
