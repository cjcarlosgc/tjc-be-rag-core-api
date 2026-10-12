# WI-CORE-004 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** el usuario (Human Reviewer), en el chat de Core, relayado por el coordinador.

Orden relayada por Cross: «Sobre core, mándale a cerrar los CASOS para poder empezar con el e2e (WI CONSOLE 04)». Pregunta de alcance del coordinador y respuesta directa del usuario: «Sí, aprobar y empezar».

## Alcance aprobado
Formalizar OC01–OC15 desde happy paths (HU03–HU16): por caso, entrada, salida observable, invariantes, estado final del Run y del Check y prueba propuesta (con referencia a pruebas existentes cuando ya exista cobertura, sin asumir cobertura por el catálogo), con trazabilidad a las especificaciones vigentes (SYSTEM-2.9, INTEROP-2.8, GH-INTEROP-1.7, verificadas en `spec/contracts`). Referencia de solo lectura: Console, commit `c4379ec`, Feature 013.

## Límites
- No se inventan casos ni subcasos que el usuario no haya aprobado. Los casos que el usuario dijo que reportaría (OC01, OC02, OC03, OC04, OC12 y OC15) se formalizan solo desde lo ya implementado y especificado; lo que dependa de su criterio sale como `DECISION_REQUIRED` con preguntas mínimas, de una en una y con recomendación, sin bloquear los demás casos.
- Ninguna `DEC` se cierra por inferencia. Sin cambio de contrato: si un caso exigiera enmendar INTEROP o GH-INTEROP, se detiene y se describe.
- Solo documentación de spec y harness; `app/` solo para pruebas si la spec lo exige y el usuario lo aprueba.
- Sin push, PR ni merge. El usuario revisa el diff y emite el veredicto: no se lanza reviewer agente ni se declara `W-DONE`.
