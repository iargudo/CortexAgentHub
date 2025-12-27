#!/bin/bash
# Script para investigar conversaciones de WhatsApp en logs de Azure
# Busca mensajes de números específicos y verifica si fueron procesados correctamente
# Uso: ./scripts/investigate-whatsapp-conversations.sh

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${AZURE_APP_NAME:-app-back-cortexagenthub-stg-001}"

# Números de teléfono a investigar
PHONE_NUMBERS=(
  "593991023079"
  "8356"
  "3185"
  "7043"
)

# Palabras clave relacionadas con el problema
KEYWORDS=(
  "plan básico"
  "plan basico"
  "precio"
  "información"
  "informacion"
)

echo "🔍 Investigando conversaciones de WhatsApp en logs de Azure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 App Service: $APP_NAME"
echo "📋 Resource Group: $RESOURCE_GROUP"
echo "📋 Números a investigar: ${PHONE_NUMBERS[*]}"
echo ""
echo "⏰ Obteniendo logs de las últimas 12 horas..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Crear directorio temporal para almacenar logs
TEMP_DIR=$(mktemp -d)
TEMP_LOG_FILE="$TEMP_DIR/logs.txt"
trap "rm -rf $TEMP_DIR" EXIT

echo "📥 Descargando logs (esto puede tardar unos minutos)..."
echo "   Usando az webapp log download para obtener logs históricos..."

# Intentar descargar logs usando download (obtiene logs históricos)
if az webapp log download \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --log-file "$TEMP_DIR/logs.zip" 2>/dev/null; then
  
  echo "✅ Logs descargados como ZIP"
  
  # Extraer logs del ZIP
  if command -v unzip &> /dev/null; then
    unzip -q "$TEMP_DIR/logs.zip" -d "$TEMP_DIR" 2>/dev/null || true
    # Buscar archivos de log extraídos
    find "$TEMP_DIR" -name "*.log" -o -name "*.txt" | while read logfile; do
      cat "$logfile" >> "$TEMP_LOG_FILE" 2>/dev/null || true
    done
  else
    echo "⚠️  unzip no está disponible, intentando método alternativo..."
    # Intentar leer directamente del ZIP si es texto plano
    cat "$TEMP_DIR/logs.zip" 2>/dev/null | strings > "$TEMP_LOG_FILE" || true
  fi
else
  echo "⚠️  No se pudieron descargar logs históricos, usando log tail con timeout..."
  echo "   Capturando logs en tiempo real por 30 segundos..."
  
  # Usar timeout para capturar logs por un tiempo limitado
  # En macOS, timeout puede no estar disponible, usar gtimeout o un enfoque diferente
  if command -v timeout &> /dev/null; then
    timeout 30 az webapp log tail \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" > "$TEMP_LOG_FILE" 2>&1 || true
  elif command -v gtimeout &> /dev/null; then
    gtimeout 30 az webapp log tail \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" > "$TEMP_LOG_FILE" 2>&1 || true
  else
    # En macOS sin timeout, usar un enfoque con background process
    echo "   Ejecutando log tail en background por 30 segundos..."
    (az webapp log tail --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" > "$TEMP_LOG_FILE" 2>&1 &)
    TAIL_PID=$!
    sleep 30
    kill $TAIL_PID 2>/dev/null || true
    wait $TAIL_PID 2>/dev/null || true
  fi
fi

echo "✅ Logs descargados ($(wc -l < "$TEMP_LOG_FILE") líneas)"
echo ""

# Función para buscar por número de teléfono
search_by_phone() {
  local phone=$1
  local phone_pattern
  
  # Crear patrón de búsqueda flexible
  # Buscar el número completo o solo los últimos dígitos
  if [[ ${#phone} -eq 4 ]]; then
    # Si son solo 4 dígitos, buscar al final del número (puede tener @c.us o espacios)
    # Buscar patrones como: 593991023079, 593991023079@c.us, +593991023079, etc.
    phone_pattern="[0-9+]*${phone}[^0-9]*"
  else
    # Número completo - buscar en diferentes formatos
    # Formato WhatsApp: 593991023079@c.us
    # Formato estándar: 593991023079
    # Con espacios: 593 99 102 3079
    phone_pattern="${phone}"
  fi
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📞 Buscando conversaciones del número: $phone"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  # Buscar todas las líneas que contengan este número
  # Buscar tanto el número completo como variaciones
  local phone_matches=$(grep -iE "${phone_pattern}|${phone}@c\.us|${phone}" "$TEMP_LOG_FILE" || true)
  
  if [ -z "$phone_matches" ]; then
    echo "⚠️  No se encontraron logs para el número $phone"
    echo ""
    return
  fi
  
  echo "✅ Se encontraron $(echo "$phone_matches" | wc -l | tr -d ' ') líneas relacionadas"
  echo ""
  
  # 1. Buscar webhooks recibidos
  echo "1️⃣ Webhooks recibidos de UltraMsg:"
  echo "─────────────────────────────────────────────────────"
  local webhook_matches=$(echo "$phone_matches" | grep -iE "whatsapp.*webhook|webhook.*whatsapp|ultramsg" || true)
  if [ -z "$webhook_matches" ]; then
    echo "❌ NO se encontraron webhooks recibidos para este número"
    echo "   Esto indica que UltraMsg NO envió el mensaje al webhook"
  else
    echo "$webhook_matches" | head -20
    echo ""
    echo "   Total: $(echo "$webhook_matches" | wc -l | tr -d ' ') webhooks encontrados"
  fi
  echo ""
  
  # 2. Buscar mensajes procesados por el agente
  echo "2️⃣ Mensajes procesados por el agente:"
  echo "─────────────────────────────────────────────────────"
  local processed_matches=$(echo "$phone_matches" | grep -iE "route|routing|flow|message.*process|sendMessage|handleWebhook" || true)
  if [ -z "$processed_matches" ]; then
    echo "❌ NO se encontraron logs de procesamiento para este número"
    echo "   Esto indica que el mensaje NO fue procesado por el agente"
  else
    echo "$processed_matches" | head -20
    echo ""
    echo "   Total: $(echo "$processed_matches" | wc -l | tr -d ' ') eventos de procesamiento encontrados"
  fi
  echo ""
  
  # 3. Buscar errores relacionados
  echo "3️⃣ Errores relacionados:"
  echo "─────────────────────────────────────────────────────"
  local error_matches=$(echo "$phone_matches" | grep -iE "error|ERROR|failed|FAILED|exception|Exception" || true)
  if [ -z "$error_matches" ]; then
    echo "✅ No se encontraron errores explícitos"
  else
    echo "$error_matches" | head -20
    echo ""
    echo "   Total: $(echo "$error_matches" | wc -l | tr -d ' ') errores encontrados"
  fi
  echo ""
  
  # 4. Buscar mensajes relacionados con "plan básico"
  echo "4️⃣ Mensajes relacionados con 'plan básico':"
  echo "─────────────────────────────────────────────────────"
  local plan_matches=$(echo "$phone_matches" | grep -iE "plan.*básico|plan.*basico|precio|informaci[oó]n" || true)
  if [ -z "$plan_matches" ]; then
    echo "⚠️  No se encontraron mensajes relacionados con 'plan básico'"
  else
    echo "$plan_matches" | head -20
    echo ""
    echo "   Total: $(echo "$plan_matches" | wc -l | tr -d ' ') mensajes encontrados"
  fi
  echo ""
  
  # 5. Buscar respuestas enviadas
  echo "5️⃣ Respuestas enviadas al cliente:"
  echo "─────────────────────────────────────────────────────"
  local response_matches=$(echo "$phone_matches" | grep -iE "send.*message|response|reply|outgoing" || true)
  if [ -z "$response_matches" ]; then
    echo "❌ NO se encontraron logs de respuestas enviadas"
    echo "   Esto confirma que el agente NO respondió"
  else
    echo "$response_matches" | head -20
    echo ""
    echo "   Total: $(echo "$response_matches" | wc -l | tr -d ' ') respuestas encontradas"
  fi
  echo ""
  
  # 6. Timeline completo de eventos para este número
  echo "6️⃣ Timeline completo de eventos (últimos 30):"
  echo "─────────────────────────────────────────────────────"
  echo "$phone_matches" | tail -30
  echo ""
  
  echo ""
}

# Buscar por cada número de teléfono
for phone in "${PHONE_NUMBERS[@]}"; do
  search_by_phone "$phone"
  echo ""
done

# Análisis general
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ANÁLISIS GENERAL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Buscar todos los webhooks de WhatsApp recientes
echo "🔍 Todos los webhooks de WhatsApp recibidos (últimas 50 líneas):"
echo "─────────────────────────────────────────────────────"
grep -iE "whatsapp.*webhook.*received|webhook.*whatsapp.*received" "$TEMP_LOG_FILE" | tail -50 || echo "No se encontraron webhooks"
echo ""

# Buscar errores generales de webhooks
echo "❌ Errores en webhooks de WhatsApp:"
echo "─────────────────────────────────────────────────────"
grep -iE "webhook.*error|error.*webhook|webhook.*failed|failed.*webhook" "$TEMP_LOG_FILE" | tail -30 || echo "No se encontraron errores de webhooks"
echo ""

# Buscar problemas de routing
echo "🔄 Problemas de routing o flow:"
echo "─────────────────────────────────────────────────────"
grep -iE "no.*flow.*found|routing.*failed|flow.*not.*found|no.*routing.*result" "$TEMP_LOG_FILE" | tail -30 || echo "No se encontraron problemas de routing"
echo ""

# Buscar problemas con UltraMsg específicamente
echo "📱 Problemas con UltraMsg:"
echo "─────────────────────────────────────────────────────"
grep -iE "ultramsg.*error|ultramsg.*failed|error.*ultramsg|failed.*ultramsg" "$TEMP_LOG_FILE" | tail -30 || echo "No se encontraron problemas con UltraMsg"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 RECOMENDACIONES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Si NO se encontraron webhooks para un número:"
echo "  1. Verifica la configuración de UltraMsg"
echo "  2. Verifica que el webhook URL esté correctamente configurado"
echo "  3. Revisa los logs de UltraMsg directamente"
echo ""
echo "Si se encontraron webhooks pero NO procesamiento:"
echo "  1. Revisa los errores en la sección 3 de cada número"
echo "  2. Verifica que el routing esté funcionando correctamente"
echo "  3. Verifica que haya un flow activo para el número/instancia"
echo ""
echo "Si se encontró procesamiento pero NO respuesta:"
echo "  1. Revisa los errores al enviar mensajes"
echo "  2. Verifica la configuración de UltraMsg (instance ID, token)"
echo "  3. Revisa los logs de errores de envío"
echo ""
echo "Para ver logs en tiempo real:"
echo "  az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""

# Limpiar archivo temporal
rm -f "$TEMP_LOG_FILE"

