#!/bin/bash
# Script para investigar por qué no se llamó a la tool para un mensaje de webchat específico
# Uso: ./scripts/investigate-webchat-tool-execution.sh [message_id]

# Configuración desde deploy-docker.sh
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
BACKEND_APP_NAME="${AZURE_BACKEND_APP_NAME:-app-back-cortexagenthub-stg-001}"

# ID del mensaje a investigar (puede pasarse como argumento)
MESSAGE_ID="${1:-584874f7-3329-40d3-b8a1-def99f9ee5f3}"

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

echo "🔍 Investigando ejecución de tools para mensaje de WebChat"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "App Service: $BACKEND_APP_NAME"
log "Resource Group: $RESOURCE_GROUP"
log "Message ID: $MESSAGE_ID"
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

# Obtener DATABASE_URL de las variables de entorno del backend
log "Obteniendo configuración de base de datos..."
DB_URL=$(az webapp config appsettings list \
  --name "$BACKEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?name=='DATABASE_URL'].value" -o tsv 2>/dev/null)

if [ -z "$DB_URL" ]; then
  error "No se pudo obtener DATABASE_URL de las variables de entorno"
  exit 1
fi

success "DATABASE_URL obtenida"
echo ""

# Extraer componentes de la URL PostgreSQL
DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$DB_URL" | sed -E 's|.*@[^:]+:([0-9]+).*|\1|' || echo "5432")
DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|' | sed -E 's|.*/||')
DB_USER=$(echo "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_PASS=$(echo "$DB_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')

if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASS" ]; then
  error "No se pudieron extraer los componentes de DATABASE_URL"
  exit 1
fi

# Verificar si psql está disponible
if ! command -v psql &> /dev/null; then
  error "psql no está instalado"
  echo "Para instalar psql:"
  echo "  macOS: brew install postgresql"
  echo "  Linux: apt-get install postgresql-client"
  exit 1
fi

export PGPASSWORD="$DB_PASS"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 INFORMACIÓN DEL MENSAJE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Buscar el mensaje en la base de datos (por ID, metadata, o messageId)
log "Buscando mensaje en la base de datos..."
MESSAGE_INFO=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c \
  "SELECT 
     m.id,
     m.conversation_id,
     m.role,
     LEFT(m.content, 200) as content_preview,
     m.timestamp,
     m.llm_provider,
     m.llm_model,
     m.metadata::text,
     c.channel,
     c.channel_user_id,
     c.flow_id
   FROM messages m
   LEFT JOIN conversations c ON m.conversation_id = c.id
   WHERE m.id::text = '$MESSAGE_ID' 
      OR m.metadata::text LIKE '%$MESSAGE_ID%'
      OR (m.metadata::jsonb->>'messageId')::text = '$MESSAGE_ID'
   LIMIT 1;" 2>/dev/null)

if [ -z "$MESSAGE_INFO" ]; then
  error "❌ NO se encontró el mensaje en la base de datos"
  echo ""
  echo "Posibles causas:"
  echo "  1. El mensaje no se guardó en la base de datos"
  echo "  2. El ID del mensaje es incorrecto"
  echo "  3. El mensaje está en una base de datos diferente"
  echo ""
  echo "Intentando buscar por contenido o timestamp..."
  
  # Buscar mensajes recientes de webchat
  log "Buscando mensajes recientes de webchat..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
    "SELECT 
       m.id,
       m.timestamp,
       LEFT(m.content, 100) as content,
       c.channel_user_id
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE c.channel = 'webchat'
     ORDER BY m.timestamp DESC
     LIMIT 10;" 2>/dev/null
  
  unset PGPASSWORD
  exit 1
fi

# Parsear información del mensaje
IFS='|' read -r msg_id conv_id role content_preview timestamp llm_provider llm_model metadata channel channel_user_id flow_id <<< "$MESSAGE_INFO"

success "✅ Mensaje encontrado"
echo ""
echo "  ID: $msg_id"
echo "  Conversación: $conv_id"
echo "  Rol: $role"
echo "  Canal: $channel"
echo "  Usuario: $channel_user_id"
echo "  Flow ID: $flow_id"
echo "  Timestamp: $timestamp"
echo "  LLM Provider: ${llm_provider:-N/A}"
echo "  LLM Model: ${llm_model:-N/A}"
echo "  Contenido: $content_preview"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 EJECUCIONES DE TOOLS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Buscar ejecuciones de tools para este mensaje
log "Buscando ejecuciones de tools para este mensaje..."
TOOL_EXECUTIONS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT 
     te.id,
     te.tool_name,
     te.status,
     te.execution_time_ms,
     te.error,
     te.executed_at,
     LEFT(te.parameters::text, 100) as parameters_preview,
     LEFT(te.result::text, 100) as result_preview
   FROM tool_executions te
   WHERE te.message_id = '$msg_id'
   ORDER BY te.executed_at ASC;" 2>/dev/null)

if echo "$TOOL_EXECUTIONS" | grep -q "0 rows"; then
  error "❌ NO se encontraron ejecuciones de tools para este mensaje"
  echo ""
  echo "Esto indica que:"
  echo "  1. El LLM no llamó a ninguna tool"
  echo "  2. Las tools no estaban disponibles"
  echo "  3. Las tools estaban deshabilitadas en el flow"
  echo "  4. Hubo un error antes de ejecutar las tools"
else
  success "✅ Se encontraron ejecuciones de tools:"
  echo "$TOOL_EXECUTIONS"
fi
echo ""

# Buscar tool calls en el metadata del mensaje
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 METADATA DEL MENSAJE (Tool Calls)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log "Buscando tool calls en el metadata..."
METADATA_FULL=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT metadata::text
   FROM messages
   WHERE id = '$msg_id';" 2>/dev/null)

if [ -n "$METADATA_FULL" ] && [ "$METADATA_FULL" != "null" ] && [ "$METADATA_FULL" != "" ]; then
  echo "Metadata completo:"
  echo "$METADATA_FULL" | jq . 2>/dev/null || echo "$METADATA_FULL"
  
  # Buscar tool calls en el metadata
  if echo "$METADATA_FULL" | grep -qi "tool.*call\|toolCall"; then
    success "✅ Se encontraron tool calls en el metadata"
  else
    warning "⚠️  NO se encontraron tool calls en el metadata"
  fi
else
  warning "⚠️  El mensaje no tiene metadata o está vacío"
fi
echo ""

# Verificar configuración del flow
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚙️  CONFIGURACIÓN DEL FLOW"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -n "$flow_id" ] && [ "$flow_id" != "null" ] && [ "$flow_id" != "" ]; then
  log "Buscando configuración del flow: $flow_id"
  FLOW_CONFIG=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c \
    "SELECT 
       id,
       name,
       flow_config::text,
       enabled_tools::text
     FROM flows
     WHERE id = '$flow_id'
     LIMIT 1;" 2>/dev/null)
  
  if [ -n "$FLOW_CONFIG" ]; then
    IFS='|' read -r flow_db_id flow_name flow_config_json enabled_tools_json <<< "$FLOW_CONFIG"
    success "✅ Flow encontrado: $flow_name"
    echo ""
    echo "  Flow ID: $flow_db_id"
    echo "  Flow Name: $flow_name"
    echo ""
    
    # Verificar enabled_tools
    if [ -n "$enabled_tools_json" ] && [ "$enabled_tools_json" != "null" ] && [ "$enabled_tools_json" != "[]" ]; then
      echo "  Tools habilitadas en el flow:"
      echo "$enabled_tools_json" | jq . 2>/dev/null || echo "$enabled_tools_json"
    else
      warning "⚠️  NO hay tools habilitadas en el flow (enabled_tools está vacío o null)"
      echo "   Esto significa que NO se enviarán tools al LLM"
    fi
    echo ""
    
    # Verificar flow_config para systemPrompt y otras configuraciones
    if [ -n "$flow_config_json" ] && [ "$flow_config_json" != "null" ]; then
      echo "  Configuración del flow:"
      echo "$flow_config_json" | jq . 2>/dev/null || echo "$flow_config_json"
    fi
  else
    warning "⚠️  Flow no encontrado en la base de datos"
  fi
else
  warning "⚠️  El mensaje no tiene flow_id asociado"
  echo "   Esto puede indicar que el routing no funcionó correctamente"
fi
echo ""

# Verificar tools disponibles para webchat
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛠️  TOOLS DISPONIBLES PARA WEBCHAT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log "Buscando tools activas con permisos para webchat..."
WEBCHAT_TOOLS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT 
     name,
     description,
     tool_type,
     active,
     permissions::text
   FROM tool_definitions
   WHERE active = true
     AND (permissions::text LIKE '%webchat%' OR permissions::text LIKE '%all%' OR permissions::text = '{}')
   ORDER BY name;" 2>/dev/null)

if echo "$WEBCHAT_TOOLS" | grep -q "0 rows"; then
  error "❌ NO se encontraron tools activas para webchat"
  echo ""
  echo "Esto significa que:"
  echo "  1. No hay tools configuradas"
  echo "  2. Las tools no tienen permisos para webchat"
  echo "  3. Las tools están desactivadas"
else
  success "✅ Tools disponibles para webchat:"
  echo "$WEBCHAT_TOOLS"
fi
echo ""

# Buscar en logs de Azure
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 LOGS DE AZURE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log "Buscando logs relacionados con este mensaje..."
echo "Esto puede tardar unos minutos..."
echo ""

# Crear directorio temporal para almacenar logs
TEMP_DIR=$(mktemp -d)
TEMP_LOG_FILE="$TEMP_DIR/logs.txt"
trap "rm -rf $TEMP_DIR" EXIT

# Intentar descargar logs históricos
if az webapp log download \
  --name "$BACKEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --log-file "$TEMP_DIR/logs.zip" 2>/dev/null; then
  
  success "Logs descargados como ZIP"
  
  # Extraer logs del ZIP
  if command -v unzip &> /dev/null; then
    unzip -q "$TEMP_DIR/logs.zip" -d "$TEMP_DIR" 2>/dev/null || true
    find "$TEMP_DIR" -name "*.log" -o -name "*.txt" | while read logfile; do
      cat "$logfile" >> "$TEMP_LOG_FILE" 2>/dev/null || true
    done
  else
    cat "$TEMP_DIR/logs.zip" 2>/dev/null | strings > "$TEMP_LOG_FILE" || true
  fi
else
  warning "No se pudieron descargar logs históricos, usando log show..."
  az webapp log show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --lines 1000 > "$TEMP_LOG_FILE" 2>&1 || true
fi

LOG_LINES=$(wc -l < "$TEMP_LOG_FILE" 2>/dev/null || echo "0")
if [ "$LOG_LINES" -gt 0 ]; then
  success "Logs obtenidos ($LOG_LINES líneas)"
  echo ""
  
  # Buscar el message ID en los logs
  echo "1️⃣ Buscando el message ID en los logs:"
  echo "─────────────────────────────────────────────────────"
  MESSAGE_LOGS=$(grep -i "$MESSAGE_ID" "$TEMP_LOG_FILE" || true)
  if [ -z "$MESSAGE_LOGS" ]; then
    warning "⚠️  NO se encontró el message ID en los logs"
  else
    echo "$MESSAGE_LOGS" | head -20
    echo ""
    echo "   Total: $(echo "$MESSAGE_LOGS" | wc -l | tr -d ' ') líneas encontradas"
  fi
  echo ""
  
  # Buscar logs relacionados con webchat y tools
  echo "2️⃣ Logs relacionados con WebChat y tools:"
  echo "─────────────────────────────────────────────────────"
  WEBCHAT_TOOL_LOGS=$(grep -iE "webchat.*tool|tool.*webchat|Available tools|Sending tools|tool.*call|toolCall" "$TEMP_LOG_FILE" | grep -i "$channel_user_id" | head -30 || true)
  if [ -z "$WEBCHAT_TOOL_LOGS" ]; then
    warning "⚠️  NO se encontraron logs de tools para este usuario"
  else
    echo "$WEBCHAT_TOOL_LOGS"
  fi
  echo ""
  
  # Buscar logs de routing
  echo "3️⃣ Logs de routing para este mensaje:"
  echo "─────────────────────────────────────────────────────"
  ROUTING_LOGS=$(grep -iE "routing|flow.*match|FlowBasedMessageRouter" "$TEMP_LOG_FILE" | grep -i "$channel_user_id" | head -20 || true)
  if [ -z "$ROUTING_LOGS" ]; then
    warning "⚠️  NO se encontraron logs de routing para este usuario"
  else
    echo "$ROUTING_LOGS"
  fi
  echo ""
  
  # Buscar errores relacionados
  echo "4️⃣ Errores relacionados:"
  echo "─────────────────────────────────────────────────────"
  ERROR_LOGS=$(grep -iE "error|ERROR|failed|FAILED|exception" "$TEMP_LOG_FILE" | grep -i "$channel_user_id" | head -20 || true)
  if [ -z "$ERROR_LOGS" ]; then
    success "✅ No se encontraron errores explícitos"
  else
    error "Se encontraron errores:"
    echo "$ERROR_LOGS"
  fi
  echo ""
else
  warning "⚠️  No se pudieron obtener logs"
fi

unset PGPASSWORD

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 RESUMEN Y RECOMENDACIONES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Posibles causas por las que NO se llamó a la tool:"
echo ""
echo "1. Flow sin tools habilitadas:"
echo "   - Verifica que el flow tenga tools en 'enabled_tools'"
echo "   - Si enabled_tools está vacío, NO se enviarán tools al LLM"
echo ""
echo "2. Tools sin permisos para webchat:"
echo "   - Verifica que las tools tengan 'webchat' en permissions.channels"
echo "   - Las tools deben estar activas (active = true)"
echo ""
echo "3. LLM no decidió usar tools:"
echo "   - El LLM puede haber decidido responder sin usar tools"
echo "   - Revisa el contenido del mensaje para ver si requería una tool"
echo ""
echo "4. Error en el procesamiento:"
echo "   - Revisa los logs de errores en la sección 4"
echo "   - Verifica que enableToolExecution esté en true"
echo ""
echo "5. Tool execution deshabilitado:"
echo "   - Verifica la variable de entorno MCP_MAX_TOOL_EXECUTIONS"
echo "   - Verifica que enableToolExecution esté configurado en el orchestrator"
echo ""
echo "Para ver logs en tiempo real:"
echo "  az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
