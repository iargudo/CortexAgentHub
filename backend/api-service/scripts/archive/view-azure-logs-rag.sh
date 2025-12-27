#!/bin/bash
# Script para ver específicamente los logs de RAG de Azure
# Uso: ./scripts/view-azure-logs-rag.sh

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

echo "🔍 Buscando logs de RAG en Azure..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Obtener logs y filtrar por RAG
echo "📊 Últimos logs relacionados con RAG:"
echo ""

az webapp log show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --lines 1000 2>/dev/null | \
  grep -i -E "RAG|rag|knowledge|embedding|chunks|similarity" | \
  tail -50

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Para ver logs en tiempo real, ejecuta:"
echo "   az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "💡 Para ver todos los logs recientes:"
echo "   az webapp log show --name $APP_NAME --resource-group $RESOURCE_GROUP --lines 200"
echo ""

