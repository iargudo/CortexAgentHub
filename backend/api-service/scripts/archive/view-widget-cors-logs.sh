#!/bin/bash
# Script para monitorear logs de CORS del widget en tiempo real
# Uso: ./scripts/view-widget-cors-logs.sh

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

echo "🔍 Monitoreando logs de CORS del widget para: $APP_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Este script mostrará logs relacionados con:"
echo "   - Widget CORS hook"
echo "   - Peticiones a /api/widgets/"
echo "   - Peticiones a /widget.js"
echo "   - Headers CORS"
echo ""
echo "💡 Abre el widget en otra ventana para generar logs"
echo "   Presiona Ctrl+C para salir"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Monitorear logs en tiempo real y filtrar por widget/CORS
az webapp log tail \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" 2>&1 | \
  grep --line-buffered -i -E "widget|cors|onResponse|Access-Control|OPTIONS|GET.*widgets|api/widgets|localhost:8080|origin" || \
  echo "Esperando logs... (haz una petición al widget para generar logs)"

