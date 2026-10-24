# WI-CORE-082 — propuesta de aserciones CT-01…CT-10 (solo lectura, FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Origen:** pregunta directa del usuario en el chat de Core el 2026-10-22: «veamos las aserciones». En `arch-v1.0-inventario-contratos-core.md` quedó anotado que la tesis no define qué aserciones comprueba cada CT-01…CT-10 (solo la «Evidencia» por contrato en el Anexo E, Tabla 52) y que el usuario debía fijarlas; Core las **propone** y el usuario las aprueba, modifica o descarta. Nada se implementa.

## Qué se entrega

`harness/reports/arch-v1.0-aserciones-ct-propuesta.md`: por cada contrato C-01…C-10 del Anexo E de la tesis (`referencias/tesis.md`, solo lectura), una propuesta de 3 a 6 aserciones verificables que definirían «CT-0x pasa»: derivadas de la fila del Anexo E (entrada, salida, precondiciones, postcondiciones, errores/estados, dependencias, evidencia), de los contratos vigentes (`spec/contracts/`), de las pruebas ya existentes (inventario WI-CORE-080) y de las brechas del inventario; para cada una: aserción, dónde se probaría (Core o el repo hermano), prueba existente que ya la cubre (si la hay) y esfuerzo. Sin escribir pruebas, sin corridas oficiales ni números de IOE, sin tag, sin tocar `app/`, contratos ni la tesis.
