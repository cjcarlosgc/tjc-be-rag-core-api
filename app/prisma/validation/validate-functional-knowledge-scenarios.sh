#!/usr/bin/env bash
# WI-CORE-020 (DEC-FK-005; HU07, HU09): valida la migración 20261008150000_functional_knowledge_scenarios y su
# consulta preflight contra un PostgreSQL LOCAL y DESCARTABLE. No forma parte de `pnpm test` (requiere psql y un
# servidor local).
#
#   FK_MIGRATION_TEST_ADMIN_URL=postgresql://usuario:clave@127.0.0.1:5432/postgres \
#     bash app/prisma/validation/validate-functional-knowledge-scenarios.sh
#
# Crea bases temporales con prefijo fk_val_<pid> a partir de un DDL previo fiel, ejecuta los escenarios y borra
# todas las bases al terminar. Ignora DATABASE_URL, DIRECT_URL y app/.env. Rechaza hosts que no sean localhost.
# Cada migración se ejecuta con `psql -1` (una sola transacción), como un despliegue atómico.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
PRISMA_DIR="$(dirname "$HERE")"
MIG="$PRISMA_DIR/migrations/20261008150000_functional_knowledge_scenarios/migration.sql"
PF="$PRISMA_DIR/preflight/20261008150000_functional_knowledge_active_duplicates.sql"
PRE="$HERE/fixtures/pre_20261008150000_ddl.sql"

ADMIN="${FK_MIGRATION_TEST_ADMIN_URL:-}"
if [ -z "$ADMIN" ]; then
  echo "Definir FK_MIGRATION_TEST_ADMIN_URL (PostgreSQL local descartable)." >&2
  exit 2
fi
case "$ADMIN" in
  *@127.0.0.1:* | *@localhost:* | *@\[::1\]:*) ;;
  *)
    echo "FK_MIGRATION_TEST_ADMIN_URL debe apuntar a 127.0.0.1, localhost o [::1]." >&2
    exit 2
    ;;
esac

BASE="${ADMIN%/*}"
RUN="fk_val_$$"
TPL="${RUN}_pre"
DB_LIST=""
FAILS=0
WORK="$(mktemp -d)"

cleanup() {
  for d in $DB_LIST; do
    psql -X -q -d "$ADMIN" -c "DROP DATABASE IF EXISTS \"$d\";" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

url_of() { printf '%s/%s' "$BASE" "$1"; }

mkdb() { # crea una base desde la plantilla previa
  DB_LIST="$DB_LIST $1"
  psql -X -q -d "$ADMIN" -c "CREATE DATABASE \"$1\" TEMPLATE \"$TPL\";" >/dev/null
}

sql() { # $1 base, $2 consulta de un valor
  psql -X -q -A -t -d "$(url_of "$1")" -c "$2"
}

file_sql() { # $1 base, $2 archivo SQL; salida sin cabeceras
  psql -X -q -A -t -d "$(url_of "$1")" -v ON_ERROR_STOP=1 -f "$2"
}

migrate() { # $1 base, $2 salida; exit code distinto de 0 si aborta
  psql -X -d "$(url_of "$1")" -v ON_ERROR_STOP=1 -1 -f "$MIG" >"$2" 2>&1
}

statuses() { # estado por fila: id, status y supersedesId; no depende de las columnas nuevas
  sql "$1" "SELECT string_agg(id || '=' || status::text || '/' || COALESCE(\"supersedesId\", '-'), ',' ORDER BY id) FROM functional_knowledge"
}

expect_eq() { # descripcion, obtenido, esperado
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1"
    echo "      esperado: $3"
    echo "      obtenido: $2"
    FAILS=$((FAILS + 1))
  fi
}

expect_ok() { # descripcion, exit code
  if [ "$2" -eq 0 ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (exit=$2)"
    FAILS=$((FAILS + 1))
  fi
}

expect_fail() { # descripcion, exit code (esperado distinto de 0)
  if [ "$2" -ne 0 ]; then
    echo "PASS  $1 (exit=$2)"
  else
    echo "FAIL  $1 (la migracion no abortó)"
    FAILS=$((FAILS + 1))
  fi
}

cat >"$WORK/snapshot.sql" <<'EOF'
SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS columnas FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'functional_knowledge';
SELECT COALESCE(string_agg(indexname, ',' ORDER BY indexname), '(sin indices)') AS indices FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'functional_knowledge';
SELECT count(*) AS filas, count(*) FILTER (WHERE status = 'ACTIVE') AS active, md5(string_agg(id || '|' || status::text || '|' || COALESCE("supersedesId", '-'), ';' ORDER BY id)) AS md5_status FROM functional_knowledge;
EOF

cat >"$WORK/seed_b.sql" <<'EOF'
INSERT INTO projects (id) VALUES ('p1'), ('p2');
INSERT INTO functional_knowledge (id, "projectId", scope, "targetRef", "originalQuestion", "originalAnswer", "normalizedRule", status, "supersedesId", "createdAt") VALUES
('k-b1', 'p1', 'PROJECT', NULL, 'q', 'a', 'regla general', 'ACTIVE', NULL, '2026-09-01 10:00:00'),
('k-b2', 'p1', 'METHOD', 'src/a.ts::A.m', 'q', 'a', 'regla vieja', 'SUPERSEDED', NULL, '2026-09-02 10:00:00'),
('k-b3', 'p1', 'METHOD', 'src/a.ts::A.m', 'q', 'a', 'regla nueva', 'ACTIVE', 'k-b2', '2026-09-03 10:00:00'),
('k-b4', 'p2', 'METHOD', 'src/a.ts::A.m', 'q', 'a', 'otro proyecto', 'ACTIVE', NULL, '2026-09-04 10:00:00');
EOF

# Columnas ya presentes (el codigo nuevo escribio una regla con clave); la historica queda NULL y el backfill la marca LEGACY.
cat >"$WORK/seed_c.sql" <<'EOF'
ALTER TABLE functional_knowledge ADD COLUMN "scenarioKind" "ScenarioKind", ADD COLUMN "scenarioKey" TEXT;
INSERT INTO projects (id) VALUES ('p1');
INSERT INTO functional_knowledge (id, "projectId", scope, "targetRef", "originalQuestion", "originalAnswer", "normalizedRule", status, "supersedesId", "createdAt", "scenarioKind", "scenarioKey") VALUES
('k-c1', 'p1', 'METHOD', 'src/c.ts::C.m', 'q', 'a', 'regla historica', 'ACTIVE', NULL, '2026-09-01 10:00:00', NULL, NULL),
('k-c2', 'p1', 'METHOD', 'src/c.ts::C.m', 'q', 'a', 'regla de limite', 'ACTIVE', NULL, '2026-09-02 10:00:00', 'BOUNDARY', 'BOUNDARY:0123456789abcdef');
EOF

# Duplicados ACTIVE equivalentes (mismo normalizedRule).
cat >"$WORK/seed_d.sql" <<'EOF'
INSERT INTO projects (id) VALUES ('p1');
INSERT INTO functional_knowledge (id, "projectId", scope, "targetRef", "originalQuestion", "originalAnswer", "normalizedRule", status, "supersedesId", "createdAt") VALUES
('k-d1', 'p1', 'METHOD', 'src/d.ts::D.m', 'q', 'a', 'Lanza si x<0', 'ACTIVE', NULL, '2026-09-01 10:00:00'),
('k-d2', 'p1', 'METHOD', 'src/d.ts::D.m', 'q', 'a', 'Lanza si x<0', 'ACTIVE', NULL, '2026-09-02 10:00:00'),
('k-d3', 'p1', 'PROJECT', NULL, 'q', 'a', 'regla unica', 'ACTIVE', NULL, '2026-09-03 10:00:00');
EOF

# Tres casos: PROJECT con target NULL (3 reglas, orden por createdAt), METHOD con dos reglas distintas, y
# NULL/'' colapsados en la misma identidad.
cat >"$WORK/seed_e.sql" <<'EOF'
INSERT INTO projects (id) VALUES ('p1'), ('p2');
INSERT INTO functional_knowledge (id, "projectId", scope, "targetRef", "originalQuestion", "originalAnswer", "normalizedRule", status, "supersedesId", "createdAt") VALUES
('e1', 'p1', 'METHOD', 'src/e.ts::E.m', 'q', 'a', 'regla X', 'ACTIVE', NULL, '2026-09-01 10:00:00'),
('e2', 'p1', 'METHOD', 'src/e.ts::E.m', 'q', 'a', 'regla Y distinta', 'ACTIVE', NULL, '2026-09-02 10:00:00'),
('e3', 'p1', 'PROJECT', NULL, 'q', 'a', 'pr1', 'ACTIVE', NULL, '2026-09-05 10:00:00'),
('e4', 'p1', 'PROJECT', NULL, 'q', 'a', 'pr2', 'ACTIVE', NULL, '2026-09-04 10:00:00'),
('e5', 'p1', 'PROJECT', NULL, 'q', 'a', 'pr3', 'ACTIVE', NULL, '2026-09-06 10:00:00'),
('e6', 'p2', 'METHOD', NULL, 'q', 'a', 'nula', 'ACTIVE', NULL, '2026-09-07 10:00:00'),
('e7', 'p2', 'METHOD', '', 'q', 'a', 'vacia', 'ACTIVE', NULL, '2026-09-08 10:00:00'),
('e8', 'p2', 'METHOD', 'src/x.ts::X.m', 'q', 'a', 'sin dup', 'ACTIVE', NULL, '2026-09-09 10:00:00');
EOF

# Resolucion explicita en el estado previo a la migracion: KEEP_EXISTING conserva e4 y e6 (e3, e5 y e7 pasan a
# SUPERSEDED sin sustituta); SUPERSEDE: e1 pasa a SUPERSEDED y e2 queda ACTIVE apuntando a e1.
cat >"$WORK/resolve_e.sql" <<'EOF'
UPDATE functional_knowledge SET status = 'SUPERSEDED' WHERE id IN ('e3', 'e5', 'e7');
UPDATE functional_knowledge SET status = 'SUPERSEDED' WHERE id = 'e1';
UPDATE functional_knowledge SET "supersedesId" = 'e1' WHERE id = 'e2';
EOF

cat >"$WORK/distinct_key.sql" <<'EOF'
BEGIN;
INSERT INTO functional_knowledge (id, "projectId", scope, "targetRef", "originalQuestion", "originalAnswer", "normalizedRule", status, "createdAt", "scenarioKind", "scenarioKey")
VALUES ('e10', 'p1', 'METHOD', 'src/e.ts::E.m', 'q', 'a', 'limite', 'ACTIVE', '2026-09-10', 'BOUNDARY', 'BOUNDARY:aaaaaaaaaaaaaaaa');
ROLLBACK;
EOF

cat >"$WORK/dup_key.sql" <<'EOF'
INSERT INTO functional_knowledge (id, "projectId", scope, "targetRef", "originalQuestion", "originalAnswer", "normalizedRule", status, "createdAt", "scenarioKind", "scenarioKey")
VALUES ('e9', 'p1', 'METHOD', 'src/e.ts::E.m', 'q', 'a', 'otra', 'ACTIVE', '2026-09-10', 'EXPECTED_RESULT', 'LEGACY');
EOF

echo "== Plantilla previa (DDL tras 20261008140000)"
DB_LIST="$TPL"
psql -X -q -d "$ADMIN" -c "CREATE DATABASE \"$TPL\";" >/dev/null
psql -X -q -d "$(url_of "$TPL")" -v ON_ERROR_STOP=1 -f "$PRE" >/dev/null

echo "== Escenario a: sin datos"
mkdb "${RUN}_a"
if migrate "${RUN}_a" "$WORK/a.out"; then rc=0; else rc=$?; fi
expect_ok "a: la migracion se aplica sin datos" "$rc"
expect_eq "a: scenarioKind y scenarioKey quedan NOT NULL" \
  "$(sql "${RUN}_a" "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'functional_knowledge' AND column_name IN ('scenarioKind', 'scenarioKey') AND is_nullable = 'NO'")" "2"
expect_eq "a: indice unico parcial creado" \
  "$(sql "${RUN}_a" "SELECT count(*) FROM pg_indexes WHERE tablename = 'functional_knowledge' AND indexname = 'functional_knowledge_active_scenario_key'")" "1"

echo "== Escenario b: sin duplicados"
mkdb "${RUN}_b"
psql -X -q -d "$(url_of "${RUN}_b")" -v ON_ERROR_STOP=1 -f "$WORK/seed_b.sql" >/dev/null
expect_eq "b: preflight sin filas" "$(file_sql "${RUN}_b" "$PF")" ""
B_BEFORE="$(statuses "${RUN}_b")"
if migrate "${RUN}_b" "$WORK/b.out"; then rc=0; else rc=$?; fi
expect_ok "b: la migracion se aplica sin duplicados" "$rc"
expect_eq "b: status intactos tras la migracion" "$(statuses "${RUN}_b")" "$B_BEFORE"
expect_eq "b: backfill EXPECTED_RESULT/LEGACY en las 4 reglas historicas" \
  "$(sql "${RUN}_b" "SELECT count(*) FROM functional_knowledge WHERE \"scenarioKind\" = 'EXPECTED_RESULT' AND \"scenarioKey\" = 'LEGACY'")" "4"

echo "== Escenario c: mismo target con scenarioKey distintos (no es duplicado)"
mkdb "${RUN}_c"
psql -X -q -d "$(url_of "${RUN}_c")" -v ON_ERROR_STOP=1 -f "$WORK/seed_c.sql" >/dev/null
if migrate "${RUN}_c" "$WORK/c.out"; then rc=0; else rc=$?; fi
expect_ok "c: la migracion permite claves distintas en el mismo target" "$rc"
expect_eq "c: ambas reglas siguen ACTIVE" \
  "$(sql "${RUN}_c" "SELECT count(*) FROM functional_knowledge WHERE \"targetRef\" = 'src/c.ts::C.m' AND status = 'ACTIVE'")" "2"
expect_eq "c: la regla historica recibe LEGACY" \
  "$(sql "${RUN}_c" "SELECT \"scenarioKey\" FROM functional_knowledge WHERE id = 'k-c1'")" "LEGACY"

echo "== Escenario d: duplicados ACTIVE equivalentes -> aborta sin cambios"
mkdb "${RUN}_d"
psql -X -q -d "$(url_of "${RUN}_d")" -v ON_ERROR_STOP=1 -f "$WORK/seed_d.sql" >/dev/null
D_STATUS_BEFORE="$(statuses "${RUN}_d")"
file_sql "${RUN}_d" "$PF" >"$WORK/d_pf.txt"
D_SNAP_BEFORE="$(psql -X -q -A -t -d "$(url_of "${RUN}_d")" -f "$WORK/snapshot.sql")"
if migrate "${RUN}_d" "$WORK/d.out"; then rc=0; else rc=$?; fi
expect_fail "d: la migracion aborta con duplicados" "$rc"
grep '^projectId=' "$WORK/d.out" >"$WORK/d_abort.txt" || true
expect_eq "d: listado del abort identico al del preflight" "$(cat "$WORK/d_abort.txt")" "$(cat "$WORK/d_pf.txt")"
expect_eq "d: status sin cambio tras el abort" "$(statuses "${RUN}_d")" "$D_STATUS_BEFORE"
D_SNAP_AFTER="$(psql -X -q -A -t -d "$(url_of "${RUN}_d")" -f "$WORK/snapshot.sql")"
expect_eq "d: esquema, indices y status identicos tras el abort" "$D_SNAP_AFTER" "$D_SNAP_BEFORE"

echo "== Escenario e: tres casos distintos -> aborta con listado ordenado"
mkdb "${RUN}_e"
psql -X -q -d "$(url_of "${RUN}_e")" -v ON_ERROR_STOP=1 -f "$WORK/seed_e.sql" >/dev/null
E_STATUS_BEFORE="$(statuses "${RUN}_e")"
file_sql "${RUN}_e" "$PF" >"$WORK/e_pf.txt"
expect_eq "e: preflight reporta 3 casos" "$(wc -l <"$WORK/e_pf.txt" | tr -d ' ')" "3"
if migrate "${RUN}_e" "$WORK/e.out"; then rc=0; else rc=$?; fi
expect_fail "e: la migracion aborta con duplicados distintos" "$rc"
grep '^projectId=' "$WORK/e.out" >"$WORK/e_abort.txt" || true
expect_eq "e: listado del abort identico al del preflight (orden incluido)" "$(cat "$WORK/e_abort.txt")" "$(cat "$WORK/e_pf.txt")"
expect_eq "e: status sin cambio tras el abort" "$(statuses "${RUN}_e")" "$E_STATUS_BEFORE"

echo "== Escenario f: resolucion explicita y reejecucion"
mkdb "${RUN}_f"
psql -X -q -d "$(url_of "${RUN}_f")" -v ON_ERROR_STOP=1 -f "$WORK/seed_e.sql" >/dev/null
psql -X -q -d "$(url_of "${RUN}_f")" -v ON_ERROR_STOP=1 -1 -f "$WORK/resolve_e.sql" >/dev/null
expect_eq "f: preflight sin filas tras resolver" "$(file_sql "${RUN}_f" "$PF")" ""
F_STATUS_BEFORE="$(statuses "${RUN}_f")"
if migrate "${RUN}_f" "$WORK/f.out"; then rc=0; else rc=$?; fi
expect_ok "f: la migracion se aplica tras resolver" "$rc"
expect_eq "f: status intactos por la migracion" "$(statuses "${RUN}_f")" "$F_STATUS_BEFORE"
if psql -X -q -d "$(url_of "${RUN}_f")" -v ON_ERROR_STOP=1 -f "$WORK/dup_key.sql" >/dev/null 2>&1; then rc=0; else rc=$?; fi
expect_fail "f: el indice rechaza una segunda ACTIVE con la misma identidad" "$rc"
if psql -X -q -d "$(url_of "${RUN}_f")" -v ON_ERROR_STOP=1 -f "$WORK/distinct_key.sql" >/dev/null 2>&1; then rc=0; else rc=$?; fi
expect_ok "f: una clave distinta sobre el mismo target si se admite" "$rc"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "RESULTADO: todas las comprobaciones pasaron."
else
  echo "RESULTADO: $FAILS comprobacion(es) fallaron."
  exit 1
fi
