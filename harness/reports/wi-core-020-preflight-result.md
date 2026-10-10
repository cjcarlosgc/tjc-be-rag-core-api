# WI-CORE-020 — resultado del preflight de DEC-FK-005 (2026-10-08)

Modelo: leader (sesión Core, ejecutado por el agente principal) · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Autoriza:** usuario, en chat: «Autorizo que la ejecute el agente» (solo lectura, con la conexión de `app/.env`).

## Qué se ejecutó
`app/prisma/preflight/20261008150000_functional_knowledge_active_duplicates.sql` contra el entorno configurado en `app/.env`, con la sesión forzada a solo lectura (`SET SESSION ... READ ONLY` y `default_transaction_read_only=on`). Más tres consultas de verificación, también de solo lectura. No se escribió nada; no se imprimieron credenciales.

## Resultado
- Preflight: **0 filas** (exit 0). No hay duplicados ACTIVE por `project + scope + targetRef` (identidad previa; `scenarioKey` sería LEGACY).
- `functional_knowledge`: **0 filas** (0 ACTIVE). La tabla existe y está vacía.
- Columnas `scenario*`: ninguna. Migraciones `2026100*` aplicadas: ninguna. Es decir, la migración de WI-CORE-020 y las de WI-CORE-019 aún no se han aplicado en ese entorno.

## Consecuencia
Según la decisión del usuario sobre el punto A: sin duplicados, **no se realiza ninguna acción**; no hace falta script de remediación. Con la tabla vacía el backfill y la creación del índice único no tienen datos que tocar. Siguen siendo condiciones de despliegue B (transaccionalidad y P3009 de `prisma migrate deploy` en Prisma 7.10.0) y C (validación en pg16/pgvector).
No sustituye el veredicto humano sobre WI-CORE-020.
