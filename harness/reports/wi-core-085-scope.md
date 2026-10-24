# WI-CORE-085 — análisis de impacto de la decisión de pilotos y evidencia (solo lectura, FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** pedido de la sesión cross (2026-10-24) tras registrar en `Tesis/AGENTS.md` los pilotos oficiales (`brick/money`, `doctrine/orm` #11600, `EscolaLMS/Vouchers`), el oráculo, la habilitación técnica previa, el gobierno de fallos, CT-08 y CT-01. Cross pide análisis de impacto y **no ordena nada a otros repos hasta la decisión del usuario**. Solo lectura: no se cambian contratos, esquemas ni código.

## Preguntas de cross

1. Esquema JSON canónico del payload Integration→Core (CT-01): qué cambia en Core, Integration y Contract Sync (versión INTEROP); si hay hoy un payload real que sirva de base.
2. Habilitación técnica (qualification/smoke) por piloto: qué soporta ya Core+Sandbox (PHP, Composer, PHPUnit, project root, perfil `PHP_LARAVEL_PHPUNIT` para Vouchers, extensiones; `doctrine/orm` es grande) y qué brechas hay.
3. Dónde viviría el oráculo congelado fuera de los inputs de ambas estrategias y cómo se identifica (`oracleId`, `caseId`, hash): si ya existe en `spec/008`.
4. Implicaciones para Console y Sandbox.
Marcar qué requiere aprobación del usuario (contrato, funcionalidad nueva).

## Entregable

`harness/reports/arch-v1.0-impacto-pilotos-core.md`: análisis por componente con orden sugerido de trabajo entre repos, brechas, qué requiere aprobación del usuario y qué decide cross. Sin ordenar nada a otros repos.
