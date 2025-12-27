#!/bin/bash
# Script para investigar por qué no se respondieron mensajes de WhatsApp
# Busca en logs de Azure y base de datos por números específicos
# Uso: ./scripts/investigate-missing-whatsapp-responses.sh

# Configuración desde deploy-docker.sh
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
BACKEND_APP_NAME="${AZURE_BACKEND_APP_NAME:-app-back-cortexagenthub-stg-001}"

# Números de teléfono a investigar (últimos dígitos)
PHONE_SUFFIXES=(
  "9406637"
  "0276013"
)

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "🔍 Investigando mensajes de WhatsApp no respondidos"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "App Service: $BACKEND_APP_NAME"
log "Resource Group: $RESOURCE_GROUP"
log "Números a investigar: ${PHONE_SUFFIXES[*]}"
echo ""

# Verificar que Azure CLI esté disponible y autenticado
if ! command -v az &> /dev/null; then
  error "Azure CLI no está instalado"
  exit 1
fi

if ! az account show &> /dev/null; then
  error "No estás autenticado en Azure CLI. Ejecuta 'az login' primero."
  exit 1
fi

# Crear directorio temporal para almacenar logs
TEMP_DIR=$(mktemp -d)
TEMP_LOG_FILE="$TEMP_DIR/logs.txt"
trap "rm -rf $TEMP_DIR" EXIT

log "Obteniendo logs de las últimas 24 horas..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Intentar descargar logs históricos
log "Descargando logs históricos de Azure..."
if az webapp log download \
  --name "$BACKEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --log-file "$TEMP_DIR/logs.zip" 2>/dev/null; then
  
  success "Logs descargados como ZIP"
  
  # Extraer logs del ZIP
  if command -v unzip &> /dev/null; then
    unzip -q "$TEMP_DIR/logs.zip" -d "$TEMP_DIR" 2>/dev/null || true
    # Buscar archivos de log extraídos
    find "$TEMP_DIR" -name "*.log" -o -name "*.txt" | while read logfile; do
      cat "$logfile" >> "$TEMP_LOG_FILE" 2>/dev/null || true
    done
  else
    warning "unzip no está disponible, intentando método alternativo..."
    cat "$TEMP_DIR/logs.zip" 2>/dev/null | strings > "$TEMP_LOG_FILE" || true
  fi
else
  warning "No se pudieron descargar logs históricos, usando log show..."
  
  # Intentar obtener logs recientes usando log show
  log "Obteniendo últimos 1000 logs..."
  az webapp log show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --lines 1000 > "$TEMP_LOG_FILE" 2>&1 || true
  
  # Si no hay suficientes logs, intentar con tail por un tiempo limitado
  if [ ! -s "$TEMP_LOG_FILE" ] || [ $(wc -l < "$TEMP_LOG_FILE") -lt 10 ]; then
    warning "Pocos logs obtenidos, capturando logs en tiempo real por 30 segundos..."
    
    if command -v timeout &> /dev/null; then
      timeout 30 az webapp log tail \
        --name "$BACKEND_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" >> "$TEMP_LOG_FILE" 2>&1 || true
    elif command -v gtimeout &> /dev/null; then
      gtimeout 30 az webapp log tail \
        --name "$BACKEND_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" >> "$TEMP_LOG_FILE" 2>&1 || true
    else
      (az webapp log tail --name "$BACKEND_APP_NAME" --resource-group "$RESOURCE_GROUP" >> "$TEMP_LOG_FILE" 2>&1 &)
      TAIL_PID=$!
      sleep 30
      kill $TAIL_PID 2>/dev/null || true
      wait $TAIL_PID 2>/dev/null || true
    fi
  fi
fi

LOG_LINES=$(wc -l < "$TEMP_LOG_FILE" 2>/dev/null || echo "0")
if [ "$LOG_LINES" -gt 0 ]; then
  success "Logs obtenidos ($LOG_LINES líneas)"
else
  error "No se pudieron obtener logs"
  exit 1
fi
echo ""

# Función para buscar por sufijo de número de teléfono
search_by_phone_suffix() {
  local suffix=$1
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📞 Buscando número terminado en: $suffix"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  # Buscar patrones de números que terminan en este sufijo
  # Formatos posibles: 593999406637, 593999406637@c.us, +593999406637, etc.
  local phone_pattern="[0-9+]*${suffix}(@c\.us)?"
  
  # Buscar todas las líneas que contengan este patrón
  local phone_matches=$(grep -iE "${phone_pattern}" "$TEMP_LOG_FILE" || true)
  
  if [ -z "$phone_matches" ]; then
    error "❌ NO se encontraron logs para números terminados en $suffix"
    echo ""
    echo "Posibles causas:"
    echo "  1. El webhook de UltraMsg nunca recibió el mensaje"
    echo "  2. El número está en un formato diferente"
    echo "  3. Los logs son más antiguos de lo que estamos buscando"
    echo ""
    return
  fi
  
  local match_count=$(echo "$phone_matches" | wc -l | tr -d ' ')
  success "✅ Se encontraron $match_count líneas relacionadas"
  echo ""
  
  # Extraer el número completo más común para análisis detallado
  local full_number=$(echo "$phone_matches" | grep -oE "[0-9]{10,15}" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  
  if [ -n "$full_number" ]; then
    log "Número completo detectado: $full_number"
    echo ""
  fi
  
  # 1. Buscar webhooks recibidos
  echo "1️⃣ Webhooks recibidos de UltraMsg:"
  echo "─────────────────────────────────────────────────────"
  local webhook_matches=$(echo "$phone_matches" | grep -iE "whatsapp.*webhook.*received|webhook.*whatsapp.*received|WhatsApp webhook received" || true)
  if [ -z "$webhook_matches" ]; then
    error "❌ NO se encontraron webhooks recibidos para este número"
    echo "   Esto indica que UltraMsg NO envió el mensaje al webhook"
    echo "   Verifica:"
    echo "   - Configuración del webhook en UltraMsg"
    echo "   - URL del webhook: https://$BACKEND_APP_NAME.azurewebsites.net/webhooks/whatsapp"
    echo "   - Estado de la instancia de UltraMsg"
  else
    echo "$webhook_matches" | head -30
    echo ""
    echo "   Total: $(echo "$webhook_matches" | wc -l | tr -d ' ') webhooks encontrados"
  fi
  echo ""
  
  # 2. Buscar mensajes normalizados/procesados
  echo "2️⃣ Mensajes normalizados y procesados:"
  echo "─────────────────────────────────────────────────────"
  local normalized_matches=$(echo "$phone_matches" | grep -iE "normalized|receiveMessage|handleWebhook|message.*normalized" || true)
  if [ -z "$normalized_matches" ]; then
    warning "⚠️  NO se encontraron logs de normalización de mensajes"
    echo "   Esto puede indicar que el webhook se recibió pero no se procesó"
  else
    echo "$normalized_matches" | head -30
    echo ""
    echo "   Total: $(echo "$normalized_matches" | wc -l | tr -d ' ') eventos de normalización encontrados"
  fi
  echo ""
  
  # 3. Buscar routing/flow matching
  echo "3️⃣ Routing y Flow Matching:"
  echo "─────────────────────────────────────────────────────"
  local routing_matches=$(echo "$phone_matches" | grep -iE "route|routing|flow.*match|FlowBasedMessageRouter|routing.*result" || true)
  if [ -z "$routing_matches" ]; then
    error "❌ NO se encontraron logs de routing para este número"
    echo "   Esto indica que el mensaje NO fue enrutado a ningún flow"
    echo "   Verifica:"
    echo "   - Que exista un flow activo para WhatsApp"
    echo "   - Que el número esté en las condiciones de routing"
    echo "   - Que el flow tenga un LLM configurado"
  else
    echo "$routing_matches" | head -30
    echo ""
    echo "   Total: $(echo "$routing_matches" | wc -l | tr -d ' ') eventos de routing encontrados"
  fi
  echo ""
  
  # 4. Buscar procesamiento por el orchestrator
  echo "4️⃣ Procesamiento por AI Orchestrator:"
  echo "─────────────────────────────────────────────────────"
  local orchestrator_matches=$(echo "$phone_matches" | grep -iE "orchestrator|AIOrchestrator|processMessage|generateResponse" || true)
  if [ -z "$orchestrator_matches" ]; then
    error "❌ NO se encontraron logs de procesamiento por el orchestrator"
    echo "   Esto indica que el mensaje NO fue procesado por el LLM"
  else
    echo "$orchestrator_matches" | head -30
    echo ""
    echo "   Total: $(echo "$orchestrator_matches" | wc -l | tr -d ' ') eventos de orchestrator encontrados"
  fi
  echo ""
  
  # 5. Buscar respuestas enviadas
  echo "5️⃣ Respuestas enviadas al cliente:"
  echo "─────────────────────────────────────────────────────"
  local response_matches=$(echo "$phone_matches" | grep -iE "sendMessage|send.*message|response.*sent|outgoing.*message|WhatsApp.*message.*sent" || true)
  if [ -z "$response_matches" ]; then
    error "❌ NO se encontraron logs de respuestas enviadas"
    echo "   Esto confirma que el agente NO respondió al mensaje"
  else
    echo "$response_matches" | head -30
    echo ""
    echo "   Total: $(echo "$response_matches" | wc -l | tr -d ' ') respuestas encontradas"
  fi
  echo ""
  
  # 6. Buscar errores específicos
  echo "6️⃣ Errores relacionados:"
  echo "─────────────────────────────────────────────────────"
  local error_matches=$(echo "$phone_matches" | grep -iE "error|ERROR|failed|FAILED|exception|Exception|Error" || true)
  if [ -z "$error_matches" ]; then
    success "✅ No se encontraron errores explícitos en los logs"
  else
    error "Se encontraron errores:"
    echo "$error_matches" | head -50
    echo ""
    echo "   Total: $(echo "$error_matches" | wc -l | tr -d ' ') errores encontrados"
  fi
  echo ""
  
  # 7. Timeline completo de eventos
  echo "7️⃣ Timeline completo de eventos (últimos 50):"
  echo "─────────────────────────────────────────────────────"
  echo "$phone_matches" | tail -50
  echo ""
  echo ""
}

# Buscar por cada sufijo de número
for suffix in "${PHONE_SUFFIXES[@]}"; do
  search_by_phone_suffix "$suffix"
done

# Análisis general del sistema
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ANÁLISIS GENERAL DEL SISTEMA"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Buscar todos los webhooks de WhatsApp recientes
log "Todos los webhooks de WhatsApp recibidos (últimas 50 líneas):"
echo "─────────────────────────────────────────────────────"
grep -iE "whatsapp.*webhook.*received|webhook.*whatsapp.*received|WhatsApp webhook received" "$TEMP_LOG_FILE" | tail -50 || echo "No se encontraron webhooks"
echo ""

# Buscar errores generales de webhooks
error "Errores en webhooks de WhatsApp:"
echo "─────────────────────────────────────────────────────"
grep -iE "webhook.*error|error.*webhook|webhook.*failed|failed.*webhook" "$TEMP_LOG_FILE" | tail -50 || echo "No se encontraron errores de webhooks"
echo ""

# Buscar problemas de routing
warning "Problemas de routing o flow:"
echo "─────────────────────────────────────────────────────"
grep -iE "no.*flow.*found|routing.*failed|flow.*not.*found|no.*routing.*result|No flow matched" "$TEMP_LOG_FILE" | tail -50 || echo "No se encontraron problemas de routing"
echo ""

# Buscar problemas con UltraMsg específicamente
warning "Problemas con UltraMsg:"
echo "─────────────────────────────────────────────────────"
grep -iE "ultramsg.*error|ultramsg.*failed|error.*ultramsg|failed.*ultramsg|UltraMsg.*error" "$TEMP_LOG_FILE" | tail -50 || echo "No se encontraron problemas con UltraMsg"
echo ""

# Buscar problemas de envío de mensajes
error "Problemas al enviar mensajes de WhatsApp:"
echo "─────────────────────────────────────────────────────"
grep -iE "send.*message.*failed|failed.*send|WhatsAppSendingWorker.*error|sendMessage.*error" "$TEMP_LOG_FILE" | tail -50 || echo "No se encontraron problemas de envío"
echo ""

# Buscar en la base de datos si es posible
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️  BÚSQUEDA EN BASE DE DATOS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Obtener DATABASE_URL de las variables de entorno del backend
log "Obteniendo configuración de base de datos..."
DB_URL=$(az webapp config appsettings list \
  --name "$BACKEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?name=='DATABASE_URL'].value" -o tsv 2>/dev/null)

if [ -n "$DB_URL" ] && command -v psql &> /dev/null; then
  log "Conectando a la base de datos..."
  
  # Extraer componentes de la URL PostgreSQL
  DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DB_URL" | sed -E 's|.*@[^:]+:([0-9]+).*|\1|' || echo "5432")
  DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|' | sed -E 's|.*/||')
  DB_USER=$(echo "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
  DB_PASS=$(echo "$DB_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
  
  if [ -n "$DB_HOST" ] && [ -n "$DB_NAME" ] && [ -n "$DB_USER" ] && [ -n "$DB_PASS" ]; then
    export PGPASSWORD="$DB_PASS"
    
    for suffix in "${PHONE_SUFFIXES[@]}"; do
      echo "Buscando conversaciones con números terminados en $suffix..."
      echo "─────────────────────────────────────────────────────"
      
      # Buscar conversaciones que contengan este sufijo
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT channel_user_id, started_at, last_activity, status, metadata 
         FROM conversations 
         WHERE channel = 'whatsapp' 
           AND (channel_user_id LIKE '%$suffix%' OR channel_user_id LIKE '%$suffix@c.us%')
         ORDER BY last_activity DESC 
         LIMIT 10;" 2>/dev/null | while read line; do
        if [ -n "$line" ]; then
          echo "$line"
        fi
      done
      
      echo ""
      echo "Buscando mensajes relacionados..."
      echo "─────────────────────────────────────────────────────"
      
      # Buscar mensajes de estas conversaciones
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT m.role, LEFT(m.content, 100) as content_preview, m.timestamp, c.channel_user_id
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.channel = 'whatsapp'
           AND (c.channel_user_id LIKE '%$suffix%' OR c.channel_user_id LIKE '%$suffix@c.us%')
         ORDER BY m.timestamp DESC
         LIMIT 20;" 2>/dev/null | while read line; do
        if [ -n "$line" ]; then
          echo "$line"
        fi
      done
      
      echo ""
    done
    
    unset PGPASSWORD
  else
    warning "No se pudieron extraer los componentes de DATABASE_URL"
  fi
else
  warning "psql no está disponible o DATABASE_URL no está configurada"
  echo "Para instalar psql:"
  echo "  macOS: brew install postgresql"
  echo "  Linux: apt-get install postgresql-client"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 RECOMENDACIONES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Si NO se encontraron webhooks para un número:"
echo "  1. Verifica la configuración del webhook en UltraMsg"
echo "  2. Verifica que el webhook URL esté correctamente configurado:"
echo "     https://$BACKEND_APP_NAME.azurewebsites.net/webhooks/whatsapp"
echo "  3. Verifica que la instancia de UltraMsg esté activa"
echo "  4. Revisa los logs de UltraMsg directamente en su dashboard"
echo ""
echo "Si se encontraron webhooks pero NO procesamiento:"
echo "  1. Revisa los errores en la sección 6 de cada número"
echo "  2. Verifica que el routing esté funcionando correctamente"
echo "  3. Verifica que haya un flow activo para WhatsApp"
echo "  4. Verifica que el flow tenga condiciones de routing que incluyan estos números"
echo ""
echo "Si se encontró procesamiento pero NO respuesta:"
echo "  1. Revisa los errores al enviar mensajes (sección 6)"
echo "  2. Verifica la configuración de UltraMsg (instance ID, token)"
echo "  3. Verifica que el WhatsAppSendingWorker esté funcionando"
echo "  4. Revisa los logs de la cola de trabajos"
echo ""
echo "Para ver logs en tiempo real:"
echo "  az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "Para ver logs específicos de WhatsApp:"
echo "  az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP | grep -i whatsapp"
echo ""
