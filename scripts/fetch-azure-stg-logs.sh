#!/usr/bin/env bash
# Descarga logs del backend en Azure staging y filtra por outbound / 360dialog / WhatsApp.
# Requiere: az CLI instalado y sesión iniciada (az login).
# Uso: ./scripts/fetch-azure-stg-logs.sh [líneas a mostrar tras filtrar, default 300]

set -e
RESOURCE_GROUP="rg-cortexagenthub-stg-001"
BACKEND_APP_NAME="app-back-cortexagenthub-stg-001"
LINES="${1:-300}"
LOG_FILE="${LOG_FILE:-/tmp/stg-backend-logs.zip}"
LOG_DIR="/tmp/stg-backend-logs-$$"

echo "Downloading logs from $BACKEND_APP_NAME (resource group: $RESOURCE_GROUP)..."
az webapp log download --name "$BACKEND_APP_NAME" --resource-group "$RESOURCE_GROUP" --log-file "$LOG_FILE" 2>/dev/null || true

if [ ! -f "$LOG_FILE" ]; then
  echo "Could not download log file. Check: az login and access to $RESOURCE_GROUP / $BACKEND_APP_NAME"
  exit 1
fi

mkdir -p "$LOG_DIR"
unzip -o -q "$LOG_FILE" -d "$LOG_DIR" 2>/dev/null || true

echo ""
echo "=== Outbound / 360dialog / WhatsApp sending (last $LINES lines) ==="
echo ""

# LogFiles/.../default_docker*.log or similar
(find "$LOG_DIR" -name "*.log" 2>/dev/null | head -20) | while read -r f; do
  [ -f "$f" ] && cat "$f"
done 2>/dev/null | grep -iE 'Integration outbound queued|channelConfigSelected|provider|360dialog|Processing WhatsApp message|WhatsApp message sent successfully|360dialog API|Message sent successfully via 360dialog|Invalid api token|phoneNumberId is required|permanently failed|Job failed in whatsapp-sending' | tail -n "$LINES"

echo ""
echo "=== Recent errors (last 80 lines) ==="
(find "$LOG_DIR" -name "*.log" 2>/dev/null | head -20) | while read -r f; do
  [ -f "$f" ] && cat "$f"
done 2>/dev/null | grep -iE 'error|failed|401|403|404|429' | tail -n 80

rm -rf "$LOG_DIR"
echo ""
echo "Done. Full zip left at: $LOG_FILE"
