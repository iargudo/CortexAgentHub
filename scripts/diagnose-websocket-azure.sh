#!/bin/bash
# Script para diagnosticar problemas de WebSocket en Azure

RESOURCE_GROUP="rg-cortexagenthub-stg-001"
BACKEND_APP_NAME="app-back-cortexagenthub-stg-001"

echo "🔍 Diagnóstico de WebSocket en Azure App Service"
echo "=================================================="
echo ""

# 1. Verificar configuración de WebSockets
echo "1️⃣ Verificando configuración de WebSockets..."
WS_ENABLED=$(az webapp config show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "webSocketsEnabled" -o tsv 2>/dev/null)

if [ "$WS_ENABLED" = "true" ]; then
    echo "✅ WebSockets están habilitados"
else
    echo "❌ WebSockets NO están habilitados"
    echo "   Ejecuta: ./scripts/enable-websockets-azure.sh"
fi

# 2. Verificar Always On
echo ""
echo "2️⃣ Verificando Always On..."
ALWAYS_ON=$(az webapp config show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "alwaysOn" -o tsv 2>/dev/null)

if [ "$ALWAYS_ON" = "true" ]; then
    echo "✅ Always On está habilitado"
else
    echo "⚠️  Always On NO está habilitado (puede causar problemas con WebSockets)"
    echo "   Considera habilitarlo para mantener conexiones WebSocket activas"
fi

# 3. Verificar HTTP/2
echo ""
echo "3️⃣ Verificando HTTP/2..."
HTTP2=$(az webapp config show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "http20Enabled" -o tsv 2>/dev/null)

if [ "$HTTP2" = "true" ]; then
    echo "✅ HTTP/2 está habilitado"
else
    echo "⚠️  HTTP/2 NO está habilitado"
fi

# 4. Verificar estado del App Service
echo ""
echo "4️⃣ Verificando estado del App Service..."
STATE=$(az webapp show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "state" -o tsv 2>/dev/null)

echo "Estado: $STATE"

# 5. Verificar logs recientes
echo ""
echo "5️⃣ Buscando logs recientes relacionados con WebSocket..."
echo "   (Esto puede tardar unos segundos...)"
echo ""

# Intentar obtener logs de los últimos 5 minutos
LOG_QUERY="timestamp > ago(5m) and (message contains 'WebSocket' or message contains 'webchat' or message contains 'ws')"
az monitor app-insights query \
    --app "$BACKEND_APP_NAME" \
    --analytics-query "$LOG_QUERY" \
    --query "tables[0].rows" \
    --output table 2>/dev/null || echo "   No se pudieron obtener logs de Application Insights"

# 6. Probar conexión WebSocket
echo ""
echo "6️⃣ Información para probar la conexión WebSocket:"
echo "   URL: wss://$BACKEND_APP_NAME.azurewebsites.net/api/v1/webchat/ws"
echo ""
echo "   Puedes probar con curl:"
echo "   curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' https://$BACKEND_APP_NAME.azurewebsites.net/api/v1/webchat/ws"
echo ""

# 7. Verificar configuración de CORS
echo "7️⃣ Verificando configuración de CORS..."
CORS_ORIGINS=$(az webapp cors show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "allowedOrigins" -o tsv 2>/dev/null)

if [ -n "$CORS_ORIGINS" ]; then
    echo "Orígenes permitidos: $CORS_ORIGINS"
else
    echo "⚠️  No hay orígenes CORS configurados"
fi

echo ""
echo "✅ Diagnóstico completado"
echo ""
echo "💡 Próximos pasos si el problema persiste:"
echo "   1. Verifica que el código esté desplegado correctamente"
echo "   2. Revisa los logs en tiempo real:"
echo "      az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP"
echo "   3. Verifica que el endpoint /api/v1/webchat/ws esté registrado correctamente"
echo "   4. Considera habilitar Always On si no está habilitado"

