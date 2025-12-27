#!/bin/bash
# Script para analizar errores específicos en los logs de Azure
# Basado en los errores reportados: instance_identifier, UUID vacío, etc.

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

echo "🔍 Análisis de Errores en Azure Logs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 App Service: $APP_NAME"
echo "📋 Resource Group: $RESOURCE_GROUP"
echo ""

# Función para obtener logs y buscar patrones
get_logs() {
    local pattern=$1
    local description=$2
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔍 $description"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Intentar obtener logs usando diferentes métodos
    # Método 1: Log stream (últimos logs)
    az webapp log download --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --log-file /tmp/azure-logs.zip 2>/dev/null
    
    if [ -f /tmp/azure-logs.zip ]; then
        unzip -q -o /tmp/azure-logs.zip -d /tmp/azure-logs 2>/dev/null
        if [ -d /tmp/azure-logs ]; then
            find /tmp/azure-logs -type f -name "*.log" -o -name "*.txt" | while read file; do
                grep -i "$pattern" "$file" 2>/dev/null | tail -20
            done
            rm -rf /tmp/azure-logs /tmp/azure-logs.zip 2>/dev/null
        fi
    else
        echo "⚠️  No se pudieron descargar logs. Usando método alternativo..."
        echo "💡 Ejecuta manualmente: az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
    fi
    echo ""
}

echo "📊 Buscando errores específicos reportados..."
echo ""

# 1. Errores de instance_identifier (ya corregido, pero verificamos si aún aparecen)
get_logs "instance_identifier" "1️⃣ Errores de instance_identifier (deberían estar resueltos)"

# 2. Errores de UUID vacío
get_logs "invalid input syntax for type uuid.*\"\"" "2️⃣ Errores de UUID vacío (deberían estar resueltos)"

# 3. Errores de webhook de WhatsApp
get_logs "WhatsApp webhook.*failed\|webhook.*whatsapp.*error" "3️⃣ Errores de webhook de WhatsApp"

# 4. Errores de routing
get_logs "routing.*error\|route.*failed\|FlowBasedMessageRouter" "4️⃣ Errores de routing de mensajes"

# 5. Errores de base de datos
get_logs "database.*error\|postgres.*error\|connection.*failed" "5️⃣ Errores de conexión a base de datos"

# 6. Errores de identificación de canal
get_logs "identify.*channel\|channel.*not.*found\|Could not identify" "6️⃣ Errores de identificación de canal"

# 7. Errores de conversación
get_logs "conversation.*error\|saveConversation.*failed\|Failed to save conversation" "7️⃣ Errores al guardar conversaciones"

# 8. Errores de RAG
get_logs "RAG.*error\|rag.*failed\|knowledge.*base.*error" "8️⃣ Errores de RAG"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Resumen de Problemas Encontrados"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Problemas ya corregidos:"
echo "   - instance_identifier: Se eliminó del código"
echo "   - UUID vacío: Se cambió de '' a null"
echo ""
echo "🔍 Problemas a verificar en producción:"
echo "   - Identificación de canal WhatsApp"
echo "   - Routing de mensajes"
echo "   - Guardado de conversaciones"
echo ""
echo "💡 Para ver logs en tiempo real:"
echo "   az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "💡 Para ver logs en Azure Portal:"
echo "   https://portal.azure.com → Resource Groups → $RESOURCE_GROUP → $APP_NAME → Log stream"
echo ""

