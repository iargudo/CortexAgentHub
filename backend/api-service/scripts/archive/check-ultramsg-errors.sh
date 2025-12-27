#!/bin/bash
# Script para verificar errores 5xx relacionados con UltraMsg y Cloudflare
# Uso: ./scripts/check-ultramsg-errors.sh

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

echo "🔍 Verificando errores 5xx de UltraMsg y Cloudflare..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Descargar logs recientes
echo "📥 Descargando logs de Azure..."
az webapp log download \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --log-file azure-logs-errors.zip 2>/dev/null

if [ -f "azure-logs-errors.zip" ]; then
  echo "✅ Logs descargados"
  echo ""
  
  # Extraer logs
  TEMP_DIR="azure-logs-errors-$$"
  mkdir -p "$TEMP_DIR"
  unzip -q azure-logs-errors.zip -d "$TEMP_DIR" 2>/dev/null || true
  
  echo "📋 1. Errores HTTP 5xx relacionados con UltraMsg:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i -E "502|503|504|520|ultramsg.*5[0-9]{2}|5[0-9]{2}.*ultramsg" 2>/dev/null | head -30
  echo ""
  
  echo "📋 2. Errores relacionados con Cloudflare:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i -E "cloudflare|502.*gateway|520.*error|bad gateway" 2>/dev/null | head -30
  echo ""
  
  echo "📋 3. Errores de red/timeout relacionados con UltraMsg:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i -E "timeout.*ultramsg|ECONNRESET.*ultramsg|ETIMEDOUT.*ultramsg|network.*ultramsg" 2>/dev/null | head -30
  echo ""
  
  echo "📋 4. Errores al enviar mensajes por WhatsApp (últimas 24h):"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i -E "Failed to send.*whatsapp|WhatsApp.*failed|sendMessage.*error|WhatsAppSendingWorker.*error" 2>/dev/null | tail -30
  echo ""
  
  echo "📋 5. Errores en la cola de WhatsApp (últimas 24h):"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i -E "WhatsAppSendingWorker.*failed|whatsapp-sending.*error|queue.*whatsapp.*error" 2>/dev/null | tail -30
  echo ""
  
  echo "📋 6. Errores retryables detectados:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i -E "Retryable error|isRetryable.*true|will retry" 2>/dev/null | tail -20
  echo ""
  
  echo "📋 7. Resumen de códigos HTTP encontrados:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "502 (Bad Gateway):"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i "502" 2>/dev/null | wc -l | xargs echo "  Total:"
  echo ""
  echo "503 (Service Unavailable):"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i "503" 2>/dev/null | wc -l | xargs echo "  Total:"
  echo ""
  echo "504 (Gateway Timeout):"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i "504" 2>/dev/null | wc -l | xargs echo "  Total:"
  echo ""
  echo "520 (Cloudflare Unknown Error):"
  find "$TEMP_DIR" -type f \( -name "*.log" -o -name "*.txt" \) | xargs grep -i "520" 2>/dev/null | wc -l | xargs echo "  Total:"
  echo ""
  
  # Limpiar
  rm -rf "$TEMP_DIR"
  rm -f azure-logs-errors.zip
  
else
  echo "⚠️  No se pudieron descargar logs, usando método alternativo..."
  echo ""
  
  echo "📋 Buscando errores directamente..."
  az webapp log show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --lines 2000 2>/dev/null | \
    grep -i -E "502|503|504|520|cloudflare|ultramsg.*error|bad gateway" | \
    tail -50
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Análisis completado"
echo ""

