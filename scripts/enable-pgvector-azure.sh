#!/bin/bash
# Script para habilitar pgvector en Azure PostgreSQL
# Uso: ./scripts/enable-pgvector-azure.sh

# Configuración - Ajusta estos valores según tu entorno
RESOURCE_GROUP="rg-cortexagenthub-stg-001"
POSTGRES_SERVER="stg-cortexstorage-stg-001"
DATABASE_NAME="cortexagenthub"

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

echo "🔧 Habilitando pgvector en Azure PostgreSQL"
echo "=========================================="
echo ""

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

log "Paso 1: Agregando 'vector' a la lista de extensiones permitidas..."

# Obtener el valor actual de azure.extensions
CURRENT_EXTENSIONS=$(az postgres flexible-server parameter show \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$POSTGRES_SERVER" \
    --name "azure.extensions" \
    --query "value" -o tsv 2>/dev/null)

if [ -z "$CURRENT_EXTENSIONS" ]; then
    # Si no existe, intentar con postgres server (no flexible)
    CURRENT_EXTENSIONS=$(az postgres server configuration show \
        --resource-group "$RESOURCE_GROUP" \
        --server-name "$POSTGRES_SERVER" \
        --name "azure.extensions" \
        --query "value" -o tsv 2>/dev/null)
fi

if [ -z "$CURRENT_EXTENSIONS" ]; then
    warning "No se pudo obtener la configuración actual. Intentando establecer directamente..."
    EXTENSIONS_VALUE="vector"
else
    # Verificar si vector ya está en la lista
    if echo "$CURRENT_EXTENSIONS" | grep -q "vector"; then
        success "✅ 'vector' ya está en la lista de extensiones permitidas"
    else
        # Agregar vector a la lista existente
        EXTENSIONS_VALUE="$CURRENT_EXTENSIONS,vector"
        log "Extensiones actuales: $CURRENT_EXTENSIONS"
        log "Agregando 'vector' a la lista..."
    fi
fi

# Intentar actualizar con Flexible Server primero
if az postgres flexible-server parameter set \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$POSTGRES_SERVER" \
    --name "azure.extensions" \
    --value "${EXTENSIONS_VALUE:-vector}" \
    &> /dev/null; then
    success "✅ Extensión 'vector' agregada a la lista de extensiones permitidas (Flexible Server)"
else
    # Intentar con PostgreSQL Server (no flexible)
    if az postgres server configuration set \
        --resource-group "$RESOURCE_GROUP" \
        --server-name "$POSTGRES_SERVER" \
        --name "azure.extensions" \
        --value "${EXTENSIONS_VALUE:-vector}" \
        &> /dev/null; then
        success "✅ Extensión 'vector' agregada a la lista de extensiones permitidas (PostgreSQL Server)"
    else
        error "❌ No se pudo actualizar la configuración. Verifica:"
        error "   1. Que el servidor PostgreSQL existe: $POSTGRES_SERVER"
        error "   2. Que tienes permisos para modificar la configuración"
        error "   3. Que el Resource Group es correcto: $RESOURCE_GROUP"
        echo ""
        log "Puedes hacerlo manualmente desde Azure Portal:"
        log "   1. Ve a Azure Portal > PostgreSQL Server > Server parameters"
        log "   2. Busca 'azure.extensions'"
        log "   3. Agrega 'vector' a la lista"
        exit 1
    fi
fi

echo ""
log "Paso 2: Esperando que la configuración se propague..."
sleep 5

echo ""
log "Paso 3: Habilitando la extensión en la base de datos..."

# Obtener información de conexión
log "Obteniendo información de conexión..."
DB_HOST="${POSTGRES_SERVER}.postgres.database.azure.com"
DB_USER="postgres"
log "Host: $DB_HOST"
log "Database: $DATABASE_NAME"
log "User: $DB_USER"
echo ""

# Verificar si psql está disponible
if ! command -v psql &> /dev/null; then
    warning "⚠️  psql no está disponible localmente"
    echo ""
    log "Para habilitar la extensión, ejecuta este comando SQL:"
    echo ""
    echo "   CREATE EXTENSION IF NOT EXISTS vector;"
    echo ""
    log "Puedes hacerlo desde:"
    log "   1. Azure Portal > PostgreSQL Server > Query editor"
    log "   2. O usando cualquier cliente PostgreSQL (psql, pgAdmin, etc.)"
    echo ""
    log "Comando completo para psql:"
    echo "   psql -h $DB_HOST -U $DB_USER -d $DATABASE_NAME -c \"CREATE EXTENSION IF NOT EXISTS vector;\""
    exit 0
fi

# Solicitar contraseña
log "Se necesitará la contraseña de PostgreSQL para ejecutar el comando SQL"
read -sp "Contraseña de PostgreSQL: " DB_PASSWORD
echo ""

# Ejecutar comando SQL
export PGPASSWORD="$DB_PASSWORD"
if psql -h "$DB_HOST" -U "$DB_USER" -d "$DATABASE_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>&1; then
    success "✅ Extensión pgvector habilitada exitosamente"
else
    error "❌ Error al habilitar la extensión"
    error "Verifica que:"
    error "   1. La contraseña es correcta"
    error "   2. El servidor permite conexiones desde tu IP"
    error "   3. La extensión 'vector' está en la lista de extensiones permitidas"
    unset PGPASSWORD
    exit 1
fi

unset PGPASSWORD

echo ""
success "🎉 pgvector está habilitado y listo para usar"
echo ""
log "Puedes verificar que funciona con:"
echo "   SELECT * FROM pg_extension WHERE extname = 'vector';"

