#!/usr/bin/env bash
# Extractor de solo lectura (WI-CORE-063). Lee experimentos de la base y escribe casos EXP-<prefijo> FUERA del repo.
# Uso: harness/calibration/extract-experiments.sh --out <dir-externo> <prefijo> [<prefijo> ...]
# - DATABASE_URL se lee de app/.env sin imprimirla; la query de la URL se descarta.
# - Sesion de solo lectura (default_transaction_read_only=on) y statement_timeout de 60 s. Nunca escribe en la base.
# - Escribe en --out: EXP-<p>.meta.json, EXP-<p>.chunks.json, EXP-<p>.cands.json, EXP-<p>.trials.json y deps.json (fusionado).
# - Aborta si --out (resuelto) esta dentro del repositorio; esa validacion ocurre antes de conectar.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

usage() { echo "uso: $0 --out <dir-externo> <prefijo> [<prefijo> ...]" >&2; exit 64; }

OUT=""
PREFIXES=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) [ "$#" -ge 2 ] || usage; OUT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) PREFIXES+=("$1"); shift ;;
  esac
done
[ -n "$OUT" ] || usage
[ "${#PREFIXES[@]}" -gt 0 ] || usage

for p in "${PREFIXES[@]}"; do
  if ! [[ "$p" =~ ^[0-9a-f]{6,36}$ ]]; then echo "prefijo invalido: $p (esperado hex de 6 a 36 caracteres)" >&2; exit 64; fi
done

# Resolucion de --out sin crear nada dentro del repo.
OUT_PARENT="$(dirname "$OUT")"
if [ ! -d "$OUT_PARENT" ]; then echo "el directorio padre de --out no existe" >&2; exit 64; fi
OUT_ABS="$(cd "$OUT_PARENT" && pwd -P)/$(basename "$OUT")"
case "$OUT_ABS/" in
  "$REPO_ROOT"/*)
    echo "aborta: --out resuelve dentro del repositorio ($REPO_ROOT). Usa un directorio externo." >&2
    exit 65 ;;
esac

command -v psql >/dev/null 2>&1 || { echo "falta psql en el PATH" >&2; exit 69; }
command -v node >/dev/null 2>&1 || { echo "falta node en el PATH" >&2; exit 69; }

ENV_FILE="$REPO_ROOT/app/.env"
[ -f "$ENV_FILE" ] || { echo "no existe app/.env" >&2; exit 66; }

# Lee la URL sin imprimirla: solo grep/sed dentro de este script.
RAW_URL="$(grep -E '^DATABASE_URL' "$ENV_FILE" | head -n 1 | sed -E 's/^DATABASE_URL[[:space:]]*=[[:space:]]*//; s/^"//; s/"[[:space:]]*$//; s/^'\''//; s/'\''[[:space:]]*$//' || true)"
[ -n "$RAW_URL" ] || { echo "DATABASE_URL vacia o ausente en app/.env" >&2; exit 66; }
DB_URL="${RAW_URL%%\?*}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000'

mkdir -p "$OUT_ABS"

run_sql() { # $1 = prefijo, $2 = sql (con :'p' y :'x' como variables psql)
  psql -X -q -t -A -v ON_ERROR_STOP=1 -v p="$1" -d "$DB_URL" -f - <<<"$2"
}

for p in "${PREFIXES[@]}"; do
  echo "extrayendo EXP-$p (solo lectura)"
  n="$(run_sql "$p" "select count(*) from experiment_runs where id::text like :'p' || '%';")"
  if [ "$n" != "1" ]; then echo "EXP-$p: el prefijo no identifica un experimento unico (filas: $n)" >&2; exit 1; fi

  # meta: experimento -> proyecto version y objetivo
  run_sql "$p" "select json_build_object('id', 'EXP-' || :'p', 'pv', r.\"projectVersionId\", 'filePath', t.\"filePath\", 'symbolName', t.\"symbolName\", 'methodName', t.\"methodName\", 'targetId', r.\"targetId\")
    from experiment_runs r join test_targets t on t.id = r.\"targetId\" where r.id::text like :'p' || '%';" > "$OUT_ABS/EXP-$p.meta.json"

  PV="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.pv)' "$OUT_ABS/EXP-$p.meta.json")"
  PVQ="$(printf "%s" "$PV" | tr -cd '0-9a-f-')"
  [ "$PVQ" = "$PV" ] && [ -n "$PV" ] || { echo "EXP-$p: projectVersionId invalido" >&2; exit 1; }

  # chunks de la version del experimento
  psql -X -q -t -A -v ON_ERROR_STOP=1 -v pv="$PVQ" -d "$DB_URL" -f - > "$OUT_ABS/EXP-$p.chunks.json" <<'SQL'
select coalesce(json_agg(json_build_object(
  'id', c.id, 'filePath', c."filePath", 'symbolKind', c."symbolKind", 'symbolName', c."symbolName",
  'parentSymbolName', c."parentSymbolName", 'importsUsed', c."importsUsed", 'content', c.content,
  'tokenCount', c."tokenCount") order by c."filePath", c."startLine"), '[]'::json)
from code_chunks c where c."projectVersionId" = :'pv';
SQL

  # candidatos y traza RAG repeticion 1 vigente
  psql -X -q -t -A -v ON_ERROR_STOP=1 -v p="$p" -d "$DB_URL" -f - > "$OUT_ABS/EXP-$p.cands.json" <<'SQL'
select coalesce(json_agg(json_build_object(
  'chunkId', k->>'chunkId', 'sem', (k->>'semanticScore')::float, 'struct', k->>'structuralMatch',
  'combined', (k->>'combinedScore')::float, 'decision', k->>'decision', 'rank', (k->>'rank')::int)), '[]'::json)
from context_traces t
join experiment_runs r on r.id = t."experimentId"
cross join lateral jsonb_array_elements(coalesce(t.detail->'candidates', '[]'::jsonb)) k
where r.id::text like :'p' || '%' and t.kind = 'RAG' and t.repetition = 1 and t.current = true;
SQL

  # trials: repeticiones con su artefacto
  psql -X -q -t -A -v ON_ERROR_STOP=1 -v p="$p" -d "$DB_URL" -f - > "$OUT_ABS/EXP-$p.trials.json" <<'SQL'
select coalesce(json_agg(json_build_object(
  'strategy', rep.strategy, 'repetition', rep.repetition, 'valid', rep.valid, 'failureType', rep."failureType",
  'errorSummary', rep."errorSummary", 'testContent', a."testContent", 'testContentSha256', a."testContentSha256",
  'promptSha256', rep."promptSha256") order by rep.strategy, rep.repetition, rep.attempt), '[]'::json)
from experiment_repetitions rep
join experiment_runs r on r.id = rep."experimentId"
left join experiment_repetition_artifacts a on a."repetitionId" = rep.id
where r.id::text like :'p' || '%';
SQL

  # dependencias: detail->dependencyContext de la misma traza RAG vigente (entries, tokenCount como sectionTokens)
  DEPS_TMP="$OUT_ABS/.deps-EXP-$p.tmp.json"
  psql -X -q -t -A -v ON_ERROR_STOP=1 -v p="$p" -d "$DB_URL" -f - > "$DEPS_TMP" <<'SQL'
select coalesce(json_agg(json_build_object(
  'caso', 'EXP-' || :'p', 'target', null, 'entries', coalesce(t.detail->'dependencyContext'->'entries', '[]'::jsonb),
  'sectionTokens', (t.detail->'dependencyContext'->>'tokenCount')::int,
  'baselineContextTokens', rep."contextTokens")), '[]'::json)
from context_traces t
join experiment_runs r on r.id = t."experimentId"
join experiment_repetitions rep on rep.id = t."experimentRepetitionId"
where r.id::text like :'p' || '%' and t.kind = 'RAG' and t.repetition = 1 and t.current = true;
SQL

  node -e '
    const fs=require("fs"); const [dir, tmp, caso]=process.argv.slice(1);
    const incoming=JSON.parse(fs.readFileSync(tmp,"utf8"));
    const file=dir+"/deps.json"; const current=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):[];
    const merged=current.filter(d=>d.caso!==caso).concat(incoming);
    fs.writeFileSync(file, JSON.stringify(merged,null,2)+"\n");
    fs.unlinkSync(tmp);
  ' "$OUT_ABS" "$DEPS_TMP" "EXP-$p"

  for f in meta chunks cands trials; do
    [ -s "$OUT_ABS/EXP-$p.$f.json" ] || { echo "EXP-$p.$f.json vacio" >&2; exit 1; }
  done
  echo "EXP-$p escrito en $OUT_ABS (meta, chunks, cands, trials; deps.json fusionado)"
done

echo "listo: extraccion de solo lectura completada"
