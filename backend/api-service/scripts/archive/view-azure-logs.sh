#!/bin/bash
# Script para ver los logs de Azure en tiempo real
# Uso: ./scripts/view-azure-logs.sh

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

echo "🔍 Obteniendo logs de Azure para: $APP_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 OPCIONES:"
echo "   1. Ver logs en tiempo real (stream)"
echo "   2. Ver últimos 100 logs"
echo "   3. Buscar logs de RAG específicamente"
echo "   4. Ver logs de errores"
echo ""
read -p "Selecciona una opción (1-4): " option

case $option in
  1)
    echo "📡 Mostrando logs en tiempo real (Ctrl+C para salir)..."
    az webapp log tail --name "$APP_NAME" --resource-group "$RESOURCE_GROUP"
    ;;
  2)
    echo "📄 Últimos 100 logs:"
    az webapp log show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --lines 100
    ;;
  3)
    echo "🔍 Buscando logs de RAG..."
    az webapp log show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --lines 500 | grep -i "RAG\|rag\|knowledge\|embedding" || echo "No se encontraron logs de RAG"
    ;;
  4)
    echo "❌ Buscando logs de errores..."
    az webapp log show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --lines 500 | grep -i "error\|ERROR\|failed\|FAILED" || echo "No se encontraron errores"
    ;;
  *)
    echo "❌ Opción inválida"
    exit 1
    ;;
esac

