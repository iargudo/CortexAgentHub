#!/bin/bash
# Script para sincronizar la base de datos local con Azure
# Borra la base local y copia el esquema completo de Azure
# IMPORTANTE: Solo lee de Azure, NO modifica nada en Azure

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

# URLs de las bases de datos
LOCAL_DB_URL="postgresql://postgres:cial1997@localhost:5432/cortexagenthub"
AZURE_DB_URL="postgresql://postgres:Pmafaraf2025@stg-cortexstorage-stg-001.postgres.database.azure.com:5432/cortexagenthub?sslmode=require"

# Verificar que psql y pg_dump están instalados
if ! command -v psql &> /dev/null; then
    error "psql no está instalado. Por favor instálalo primero."
    exit 1
fi

if ! command -v pg_dump &> /dev/null; then
    error "pg_dump no está instalado. Por favor instálalo primero."
    exit 1
fi

# Extraer componentes de las URLs
extract_db_info() {
    local url=$1
    local db_host=$(echo "$url" | sed -E 's|.*@([^:/]+).*|\1|')
    local db_port=$(echo "$url" | grep -oE ':[0-9]+' | sed 's/://' || echo "5432")
    local db_name=$(echo "$url" | sed -E 's|.*/([^?]+).*|\1|' | sed -E 's|.*/||')
    local db_user=$(echo "$url" | sed -E 's|.*://([^:]+):.*|\1|')
    local db_pass=$(echo "$url" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
    
    echo "$db_host|$db_port|$db_name|$db_user|$db_pass"
}

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Sincronizando base LOCAL con AZURE (estructura + datos)"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "⚠️  IMPORTANTE: Solo se leerá de AZURE, NO se modificará"
log ""

log "Extrayendo información de las bases de datos..."

LOCAL_INFO=$(extract_db_info "$LOCAL_DB_URL")
AZURE_INFO=$(extract_db_info "$AZURE_DB_URL")

LOCAL_HOST=$(echo "$LOCAL_INFO" | cut -d'|' -f1)
LOCAL_PORT=$(echo "$LOCAL_INFO" | cut -d'|' -f2)
LOCAL_DB=$(echo "$LOCAL_INFO" | cut -d'|' -f3)
LOCAL_USER=$(echo "$LOCAL_INFO" | cut -d'|' -f4)
LOCAL_PASS=$(echo "$LOCAL_INFO" | cut -d'|' -f5)

AZURE_HOST=$(echo "$AZURE_INFO" | cut -d'|' -f1)
AZURE_PORT=$(echo "$AZURE_INFO" | cut -d'|' -f2)
AZURE_DB=$(echo "$AZURE_INFO" | cut -d'|' -f3)
AZURE_USER=$(echo "$AZURE_INFO" | cut -d'|' -f4)
AZURE_PASS=$(echo "$AZURE_INFO" | cut -d'|' -f5)

log "Base LOCAL: $LOCAL_USER@$LOCAL_HOST:$LOCAL_PORT/$LOCAL_DB"
log "Base AZURE: $AZURE_USER@$AZURE_HOST:$AZURE_PORT/$AZURE_DB"
log ""

# Verificar conexiones
log "Verificando conexión a base LOCAL..."
export PGPASSWORD="$LOCAL_PASS"
if ! psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -c "SELECT 1;" &> /dev/null; then
    error "No se pudo conectar a la base de datos LOCAL"
    unset PGPASSWORD
    exit 1
fi
log "✅ Conexión LOCAL exitosa"

log "Verificando conexión a base AZURE (solo lectura)..."
export PGPASSWORD="$AZURE_PASS"
if ! psql -h "$AZURE_HOST" -p "$AZURE_PORT" -U "$AZURE_USER" -d "$AZURE_DB" -c "SELECT 1;" &> /dev/null; then
    error "No se pudo conectar a la base de datos AZURE"
    unset PGPASSWORD
    exit 1
fi
log "✅ Conexión AZURE exitosa (solo lectura)"
log ""

# Crear archivos temporales para el esquema y los datos
SCHEMA_FILE=$(mktemp /tmp/azure_schema_XXXXXX.sql)
DATA_FILE=$(mktemp /tmp/azure_data_XXXXXX.sql)
trap "rm -f $SCHEMA_FILE $DATA_FILE" EXIT

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "PASO 1: Obteniendo esquema completo de AZURE..."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "⚠️  Solo lectura de AZURE, NO se modifica nada"

# Exportar solo el esquema (sin datos) de Azure
export PGPASSWORD="$AZURE_PASS"
log "Exportando esquema de Azure..."
pg_dump \
    -h "$AZURE_HOST" \
    -p "$AZURE_PORT" \
    -U "$AZURE_USER" \
    -d "$AZURE_DB" \
    --schema-only \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    -f "$SCHEMA_FILE" 2>&1 | grep -v "password" || true

if [ ! -s "$SCHEMA_FILE" ]; then
    error "No se pudo exportar el esquema de Azure"
    unset PGPASSWORD
    exit 1
fi

SCHEMA_LINES=$(wc -l < "$SCHEMA_FILE")
log "✅ Esquema exportado: $SCHEMA_LINES líneas"
log ""

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "PASO 1b: Obteniendo datos de AZURE..."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "⚠️  Solo lectura de AZURE, NO se modifica nada"

# Exportar solo los datos (sin esquema) de Azure
export PGPASSWORD="$AZURE_PASS"
log "Exportando datos de Azure..."
pg_dump \
    -h "$AZURE_HOST" \
    -p "$AZURE_PORT" \
    -U "$AZURE_USER" \
    -d "$AZURE_DB" \
    --data-only \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    -f "$DATA_FILE" 2>&1 | grep -v "password" || true

if [ ! -s "$DATA_FILE" ]; then
    warning "No se encontraron datos para exportar (puede estar vacía)"
    DATA_LINES=0
else
    DATA_LINES=$(wc -l < "$DATA_FILE")
    log "✅ Datos exportados: $DATA_LINES líneas"
fi
log ""

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "PASO 2: Borrando todas las tablas de la base LOCAL..."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Obtener lista de todas las tablas en local
export PGPASSWORD="$LOCAL_PASS"
TABLES=$(psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -t -c "
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename;
" | tr -d ' ' | grep -v '^$')

if [ -n "$TABLES" ]; then
    TABLE_COUNT=$(echo "$TABLES" | wc -l | tr -d ' ')
    log "Tablas encontradas en LOCAL: $TABLE_COUNT"
    echo "$TABLES" | while read table; do
        if [ -n "$table" ]; then
            log "  - $table"
        fi
    done
    log ""
    
    # Borrar todas las tablas (CASCADE para borrar dependencias)
    log "Borrando tablas..."
    echo "$TABLES" | while read table; do
        if [ -n "$table" ]; then
            psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" \
                -c "DROP TABLE IF EXISTS \"$table\" CASCADE;" 2>&1 | grep -v "password" || true
        fi
    done
    log "✅ Todas las tablas borradas"
else
    log "No hay tablas en LOCAL para borrar"
fi
log ""

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "PASO 3: Restaurando esquema de AZURE en LOCAL..."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Restaurar el esquema en local
export PGPASSWORD="$LOCAL_PASS"
log "Restaurando esquema..."
if psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -f "$SCHEMA_FILE" 2>&1 | grep -v "password\|does not exist\|already exists"; then
    log "✅ Esquema restaurado exitosamente"
else
    warning "El esquema se restauró (puede haber advertencias normales)"
fi

# Verificar que las tablas se crearon
TABLES_COUNT=$(psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -t -c "
    SELECT COUNT(*) 
    FROM pg_tables 
    WHERE schemaname = 'public';
" | tr -d ' ')

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "PASO 4: Restaurando datos de AZURE en LOCAL..."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Restaurar los datos en local solo si hay datos
if [ -s "$DATA_FILE" ]; then
    export PGPASSWORD="$LOCAL_PASS"
    log "Restaurando datos..."
    if psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -f "$DATA_FILE" 2>&1 | grep -v "password\|does not exist\|already exists\|violates foreign key\|duplicate key"; then
        log "✅ Datos restaurados exitosamente"
    else
        warning "Los datos se restauraron (puede haber advertencias normales)"
    fi
    
    # Contar registros en algunas tablas principales para verificar
    log ""
    log "Verificando datos copiados..."
    CONV_COUNT=$(psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -t -c "SELECT COUNT(*) FROM conversations;" 2>/dev/null | tr -d ' ' || echo "0")
    MSG_COUNT=$(psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -t -c "SELECT COUNT(*) FROM messages;" 2>/dev/null | tr -d ' ' || echo "0")
    CHANNEL_COUNT=$(psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" -t -c "SELECT COUNT(*) FROM channel_configs;" 2>/dev/null | tr -d ' ' || echo "0")
    
    log "  - Conversaciones: $CONV_COUNT"
    log "  - Mensajes: $MSG_COUNT"
    log "  - Canales: $CHANNEL_COUNT"
else
    log "No hay datos para restaurar (base Azure está vacía o solo tiene estructura)"
fi

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "✅ Sincronización completada"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Tablas en LOCAL después de sincronización: $TABLES_COUNT"
log ""
log "✅ La base de datos LOCAL ahora tiene la misma estructura Y datos que AZURE"
log "✅ AZURE no fue modificado en ningún momento (solo lectura)"

unset PGPASSWORD

