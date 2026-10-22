# WI-CORE-080 — inventario de cobertura C-01…C-10 para arch-v1.0 (solo lectura, FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** pedido de la sesión cross como decisión del usuario («preparar ya el inventario, solo lectura, sin cambiar código»), 2026-10-21. No es un cambio de producto: no toca `app/`, contratos ni esquemas; el único entregable es un reporte en `harness/reports/`. Tipo `HARNESS`, carril `FAST`, con revisión independiente del `reviewer` (exactitud del mapa).

## Qué se entrega

`harness/reports/arch-v1.0-inventario-contratos-core.md`: una tabla corta con, por cada contrato C-01…C-10 del Anexo E de la tesis (`referencias/tesis.md`, «Anexo E. Catálogo de contratos arquitectónicos», Tabla 52; también «Anexo G» / HITO-OE1): (1) la fila del Anexo E citada (responsabilidad y prueba CT-0x asociada); (2) qué pruebas existentes de Core cubren la frontera (archivo y nombre); (3) qué no cubre ninguna; (4) qué prueba nueva haría falta (sin escribirla); (5) si la frontera es de Core o depende de otro repositorio (Sandbox: C-06/C-07 con el cliente real de Core; Integration y Console para sus fronteras). Sin corridas oficiales ni números de IOE: eso va después, sobre `arch-v1.0`. No se modifica la tesis (`referencias/` es solo lectura) ni se crea el tag.
