# WI-CORE-082 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: propuesta de aserciones CT-01…CT-10 en `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` (WI `HARNESS`, carril `FAST`, solo lectura), pedida por el usuario el 2026-10-22 («veamos las aserciones»). No toca `app/`, contratos, esquemas ni `referencias/`; sin pruebas escritas, sin corridas oficiales ni números de IOE; sin tag.

- **Contenido:** 52 aserciones (3 a 6 por contrato). Con el criterio explícito del documento: **21 cubiertas, 14 parciales y 17 sin cobertura** (cuadran con las filas y por CT; el ciclo 2 pidió reclasificar CT-10-A3 como parcial porque falta registrar la evidencia de la corrida de CI, y se aplicó).
- **Decisiones del usuario ya tomadas (2026-10-23, chat de Core):** D-1 un registro de evidencia por CT (SHA, comando, resultado); D-5 «contexto insuficiente» = sin código del target, o sin candidato que pase el mínimo y faltan reglas requeridas ⇒ ACTION_REQUIRED (Core hoy no lo define ni lo prueba); D-10 baseline de ESC-MOD-01 = suite de contrato de `LLMProvider` contra OpenAI y un adaptador falso, segundo proveedor real en OE5.
- **Pendientes del usuario:** D-2, D-3, D-4, D-6, D-7, D-9 y D-11 (D-8 se retiró: la Tabla 56 ya exige los SHA), cada una con recomendación en el informe.
- **Revisión independiente (`reviewer`):** CHANGES_REQUESTED en el ciclo 1 (F-1…F-10: criterio de «parcial» no reproducible, CT-08-A2/A4 prometían como automáticas funciones que Core no tiene, cobertura sobrestimada en CT-10-A1/A2 y CT-03-A4, ruta y nombres imprecisos) y APPROVED en el ciclo 2 de 2, con O-1 aplicada en el cierre. `contract-reviewer`: no aplica; sin Contract Sync.
- `retryLimitRespected`: 2 de 2 ciclos de revisión usados.

Discrepancias tesis↔código señaladas sin decidir: C-01 (webhook de GitHub vs evento interno de Integration con bearer), C-10 («puertos» vs Prisma/SQL directo), C-03/C-05 (dónde vive el ranking final), «contexto insuficiente» sin definición, y C-08 (el trace solo expone PRESENT/NOT_APPLICABLE; no hay consulta inversa ni marca de enlace inconsistente). Siguiente paso: resolver las decisiones pendientes y abrir un WI de implementación en el orden de la sección 3 del informe (CT-08 manual primero).
