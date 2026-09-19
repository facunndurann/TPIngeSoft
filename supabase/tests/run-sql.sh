#!/usr/bin/env bash
# Corre las aserciones SQL contra la base del stack local (`pnpm supabase start`).
# Cada archivo trabaja dentro de BEGIN … ROLLBACK, así que no deja datos.
set -euo pipefail

cd "$(dirname "$0")/../.."
project_id=$(sed -n 's/^project_id = "\(.*\)"$/\1/p' supabase/config.toml)

for file in supabase/tests/*.sql; do
  echo "▶ $file"
  docker exec -i "supabase_db_${project_id}" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < "$file"
done
