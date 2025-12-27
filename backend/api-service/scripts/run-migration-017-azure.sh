#!/bin/bash
# Script para ejecutar la migración 017_remove_unused_count_tables.sql en Azure PostgreSQL

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Verificar que Azure CLI está instalado
if ! command -v az &> /dev/null; then
    error "Azure CLI no está instalado. Por favor instálalo primero."
    exit 1
fi

# Verificar autenticación
if ! az account show &> /dev/null; then
    error "No estás autenticado en Azure CLI. Ejecuta 'az login' primero."
    exit 1
fi

# Verificar que psql está disponible
if ! command -v psql &> /dev/null; then
    error "psql no está instalado. Por favor instálalo primero."
    error "En macOS: brew install postgresql"
    error "En Ubuntu: sudo apt-get install postgresql-client"
    exit 1
fi

# Obtener configuración
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Leer configuración del deploy script o usar valores por defecto
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-cortexagenthub-stg-001}"
APP_NAME="${APP_NAME:-app-back-cortexagenthub-stg-001}"

log "Obteniendo DATABASE_URL de Azure App Service: $APP_NAME"

# Obtener DATABASE_URL de Azure
db_url=$(az webapp config appsettings list \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='DATABASE_URL'].value" -o tsv 2>/dev/null)

if [ -z "$db_url" ]; then
    error "No se pudo obtener DATABASE_URL de Azure App Service"
    error "Verifica que el App Service existe y tiene DATABASE_URL configurada"
    exit 1
fi

log "DATABASE_URL obtenida (ocultando contraseña)"

# Extraer componentes de la URL
db_host=$(echo "$db_url" | sed -E 's|.*@([^:/]+).*|\1|')
db_port=$(echo "$db_url" | grep -oE ':[0-9]+' | sed 's/://' || echo "5432")
db_name=$(echo "$db_url" | sed -E 's|.*/([^?]+).*|\1|' | sed -E 's|.*/||')
db_user=$(echo "$db_url" | sed -E 's|.*://([^:]+):.*|\1|')
db_pass=$(echo "$db_url" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')

# Si el parsing falla, intentar método alternativo
if [ -z "$db_host" ] || [ -z "$db_name" ] || [ -z "$db_user" ] || [ -z "$db_pass" ]; then
    log "Intentando método alternativo de parsing..."
    db_host=$(echo "$db_url" | awk -F'@' '{print $2}' | awk -F':' '{print $1}')
    db_port=$(echo "$db_url" | awk -F':' '{print $4}' | awk -F'/' '{print $1}' || echo "5432")
    db_name=$(echo "$db_url" | awk -F'/' '{print $NF}' | awk -F'?' '{print $1}')
    db_user=$(echo "$db_url" | awk -F'://' '{print $2}' | awk -F':' '{print $1}')
    db_pass=$(echo "$db_url" | awk -F'://' '{print $2}' | awk -F':' '{print $2}' | awk -F'@' '{print $1}')
fi

if [ -z "$db_host" ] || [ -z "$db_name" ] || [ -z "$db_user" ] || [ -z "$db_pass" ]; then
    error "No se pudieron extraer los componentes de DATABASE_URL"
    error "URL (oculta): $(echo "$db_url" | sed 's/:[^:@]*@/:***@/')"
    exit 1
fi

log "Conectando a: $db_user@$db_host:$db_port/$db_name"

# Verificar conexión
export PGPASSWORD="$db_pass"
if ! psql -h "$db_host" -p "${db_port:-5432}" -U "$db_user" -d "$db_name" -c "SELECT 1;" &> /dev/null; then
    error "No se pudo conectar a la base de datos"
    error "Verifica las credenciales y que el firewall de Azure PostgreSQL permita tu IP"
    unset PGPASSWORD
    exit 1
fi

log "✅ Conexión exitosa"

# Verificar que las tablas existen antes de eliminarlas
log "Verificando tablas *_count en Azure..."
COUNT_TABLES=$(psql -h "$db_host" -p "${db_port:-5432}" -U "$db_user" -d "$db_name" -t -c "
    SELECT COUNT(*) 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('analytics_count', 'context_count', 'conv_count', 'log_count', 'msg_count', 'tool_exec_count');
" | tr -d ' ')

if [ "$COUNT_TABLES" = "0" ]; then
    warning "Las tablas *_count ya no existen en Azure. Puede que ya hayan sido eliminadas."
    log "Continuando con la migración para asegurar que estén eliminadas..."
else
    log "Encontradas $COUNT_TABLES tablas *_count en Azure"
fi

# Ejecutar migración
migration_file="$PROJECT_ROOT/backend/packages/database/migrations/017_remove_unused_count_tables.sql"

if [ ! -f "$migration_file" ]; then
    error "Archivo de migración no encontrado: $migration_file"
    unset PGPASSWORD
    exit 1
fi

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Ejecutando migración: 017_remove_unused_count_tables.sql"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Esta migración eliminará las siguientes tablas no usadas:"
log "  - analytics_count"
log "  - context_count"
log "  - conv_count"
log "  - log_count"
log "  - msg_count"
log "  - tool_exec_count"
log ""
log "⚠️  Estas tablas no tienen dependencias y son seguras de eliminar"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""

# Ejecutar la migración
if psql -h "$db_host" -p "${db_port:-5432}" -U "$db_user" -d "$db_name" -f "$migration_file" 2>&1; then
    log ""
    log "✅ Migración ejecutada exitosamente"
    
    # Verificar que las tablas fueron eliminadas
    REMAINING=$(psql -h "$db_host" -p "${db_port:-5432}" -U "$db_user" -d "$db_name" -t -c "
        SELECT COUNT(*) 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('analytics_count', 'context_count', 'conv_count', 'log_count', 'msg_count', 'tool_exec_count');
    " | tr -d ' ')
    
    if [ "$REMAINING" = "0" ]; then
        log "✅ Todas las tablas *_count fueron eliminadas exitosamente"
    else
        warning "⚠️  Aún quedan $REMAINING tablas *_count. Revisa manualmente."
    fi
else
    error "❌ Error al ejecutar la migración"
    unset PGPASSWORD
    exit 1
fi

unset PGPASSWORD
log ""
log "✅ Proceso completado"

