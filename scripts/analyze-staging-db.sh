#!/usr/bin/env bash
# Analiza la BD de staging: system_logs (rate limit, outbound/send, tipos de error) y mensajes del día.
# Uso: DATABASE_URL='postgresql://user:pass@host:5432/db?sslmode=require' ./scripts/analyze-staging-db.sh
# Requiere: psql instalado.

set -e
if [ -z "$DATABASE_URL" ]; then
  echo "Falta DATABASE_URL. Ejemplo:"
  echo "  export DATABASE_URL='postgresql://postgres:PASS@host:5432/cortexagenthub?sslmode=require'"
  exit 1
fi
if ! command -v psql &>/dev/null; then
  echo "Necesitas psql instalado."
  exit 1
fi

echo "=== Fecha/hora servidor (BD) ==="
psql "$DATABASE_URL" -t -c "SELECT NOW() AT TIME ZONE 'America/Guayaquil';"
echo ""

echo "=== system_logs: rate limit y outbound/send (últimas 24h) ==="
psql "$DATABASE_URL" -c "
SELECT 'Rate limit errors (24h)' AS metric, COUNT(*)::text AS value
FROM system_logs
WHERE created_at > NOW() - INTERVAL '24 hours' AND level = 'error'
  AND (message ILIKE '%rate limit%' OR (metadata->>'error')::text ILIKE '%rate limit%')
UNION ALL
SELECT 'Outbound/send path errors (24h)', COUNT(*)::text
FROM system_logs
WHERE created_at > NOW() - INTERVAL '24 hours' AND level = 'error'
  AND (metadata->>'path')::text LIKE '%outbound/send%'
UNION ALL
SELECT 'Total errors (24h)', COUNT(*)::text
FROM system_logs
WHERE created_at > NOW() - INTERVAL '24 hours' AND level = 'error';
"

echo "=== system_logs: tipos de error (24h, agrupado) ==="
psql "$DATABASE_URL" -c "
SELECT COALESCE(metadata->>'error', LEFT(message, 70)) AS error_type, COUNT(*) AS cnt
FROM system_logs
WHERE created_at > NOW() - INTERVAL '24 hours' AND level = 'error'
GROUP BY 1 ORDER BY cnt DESC LIMIT 15;
"

echo "=== Mensajes hoy (America/Guayaquil) ==="
psql "$DATABASE_URL" -c "
SELECT 'Total mensajes hoy' AS metric, COUNT(*)::text AS value
FROM messages
WHERE (timestamp AT TIME ZONE 'America/Guayaquil')::date = (NOW() AT TIME ZONE 'America/Guayaquil')::date
UNION ALL
SELECT 'Outbound hoy', COUNT(*)::text
FROM messages
WHERE (timestamp AT TIME ZONE 'America/Guayaquil')::date = (NOW() AT TIME ZONE 'America/Guayaquil')::date
  AND role = 'assistant'
  AND (metadata ? 'outbound') AND (metadata->'outbound')::text IN ('true', 't');
"

echo "=== Mensajes hoy por canal ==="
psql "$DATABASE_URL" -c "
SELECT c.channel, COUNT(m.id) AS mensajes
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE (m.timestamp AT TIME ZONE 'America/Guayaquil')::date = (NOW() AT TIME ZONE 'America/Guayaquil')::date
GROUP BY c.channel ORDER BY mensajes DESC;
"

echo "Listo."
