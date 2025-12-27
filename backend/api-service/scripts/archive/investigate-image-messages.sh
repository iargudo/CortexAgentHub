#!/bin/bash
# Script para investigar problemas con mensajes de imagen en WhatsApp
# Uso: ./scripts/investigate-image-messages.sh

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

echo "🔍 Investigando mensajes de imagen en Azure..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Descargar logs recientes
echo "📥 Descargando logs de Azure..."
az webapp log download \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --log-file azure-logs-images.zip 2>/dev/null

if [ -f "azure-logs-images.zip" ]; then
  echo "✅ Logs descargados"
  echo ""
  
  # Extraer logs
  TEMP_DIR="azure-logs-images-$$"
  mkdir -p "$TEMP_DIR"
  unzip -q azure-logs-images.zip -d "$TEMP_DIR" 2>/dev/null || true
  
  echo "📋 1. Mensajes de imagen recibidos:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "messageType.*image\|message_type.*image\|type.*image" 2>/dev/null | head -20
  echo ""
  
  echo "📋 2. Router evaluando mensajes de imagen:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "FlowBasedMessageRouter.*image\|ROUTING.*image\|messageContent.*''\|messageContent.*\"\"" 2>/dev/null | head -20
  echo ""
  
  echo "📋 3. Condiciones de routing NO cumplidas para imágenes:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "Flow conditions NOT matched\|No flow matched" 2>/dev/null | head -20
  echo ""
  
  echo "📋 4. Fallback usado para imágenes:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "FALLBACK\|using highest priority flow" 2>/dev/null | head -20
  echo ""
  
  echo "📋 5. Errores relacionados con imágenes:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "error.*image\|ERROR.*image\|failed.*image\|FAILED.*image" 2>/dev/null | head -20
  echo ""
  
  echo "📋 6. WhatsApp webhook recibiendo imágenes:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "WhatsApp webhook.*image\|webhook.*image\|Received media message" 2>/dev/null | head -20
  echo ""
  
  echo "📋 7. Normalización de contenido de imágenes:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "Normalizing WhatsApp.*content\|messageContent.*length.*0\|finalContent.*\"\"" 2>/dev/null | head -20
  echo ""
  
  echo "📋 8. Agente procesando mensajes (últimos 30 minutos):"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  find "$TEMP_DIR" -type f -name "*.log" -o -name "*.txt" | xargs grep -i "Processing message\|processMessage" 2>/dev/null | tail -20
  echo ""
  
  # Limpiar
  rm -rf "$TEMP_DIR"
  rm -f azure-logs-images.zip
  
else
  echo "⚠️  No se pudieron descargar logs, usando método alternativo..."
  echo ""
  
  echo "📋 Buscando logs directamente..."
  az webapp log show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --lines 1000 2>/dev/null | \
    grep -i -E "image|messageType|message_type|messageContent.*''|Flow conditions NOT matched|FALLBACK" | \
    tail -50
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Análisis completado"
echo ""

