#!/bin/bash
# Script para habilitar WebSockets en Azure App Service

RESOURCE_GROUP="rg-cortexagenthub-stg-001"
BACKEND_APP_NAME="app-back-cortexagenthub-stg-001"

echo "🔌 Habilitando WebSockets en Azure App Service..."
echo ""

# Verificar si el App Service existe
if az webapp show --name "$BACKEND_APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
    echo "✅ App Service encontrado: $BACKEND_APP_NAME"
    
    # Verificar estado actual
    echo "📊 Verificando estado actual de WebSockets..."
    CURRENT_STATE=$(az webapp config show \
        --name "$BACKEND_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "webSocketsEnabled" -o tsv 2>/dev/null)
    
    echo "Estado actual: ${CURRENT_STATE:-'no configurado'}"
    
    if [ "$CURRENT_STATE" = "true" ]; then
        echo "✅ WebSockets ya están habilitados"
    else
        echo "🔧 Habilitando WebSockets..."
        if az webapp config set \
            --name "$BACKEND_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --web-sockets-enabled true; then
            echo "✅ WebSockets habilitados exitosamente"
            
            # Verificar
            sleep 2
            VERIFIED=$(az webapp config show \
                --name "$BACKEND_APP_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --query "webSocketsEnabled" -o tsv 2>/dev/null)
            
            if [ "$VERIFIED" = "true" ]; then
                echo "✅ Verificación exitosa: WebSockets están habilitados"
            else
                echo "⚠️  No se pudo verificar la configuración"
            fi
        else
            echo "❌ Error al habilitar WebSockets"
            exit 1
        fi
    fi
    
    echo ""
    echo "🔄 Reiniciando App Service para aplicar cambios..."
    az webapp restart --name "$BACKEND_APP_NAME" --resource-group "$RESOURCE_GROUP"
    echo "✅ App Service reiniciado"
    
    echo ""
    echo "📋 Información del App Service:"
    az webapp config show \
        --name "$BACKEND_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "{webSocketsEnabled: webSocketsEnabled, alwaysOn: alwaysOn, http20Enabled: http20Enabled}" -o table
    
else
    echo "❌ App Service no encontrado: $BACKEND_APP_NAME"
    exit 1
fi

echo ""
echo "✅ Proceso completado"
echo ""
echo "💡 Próximos pasos:"
echo "   1. Espera 1-2 minutos para que los cambios se propaguen"
echo "   2. Prueba el widget nuevamente"
echo "   3. Revisa los logs del backend si sigue fallando:"
echo "      az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP"

