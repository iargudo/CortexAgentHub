#!/bin/bash
# Script para revisar logs de Azure App Service y diagnosticar el error 500 en login

RESOURCE_GROUP="rg-cortexagenthub-prd-001"
BACKEND_APP_NAME="app-back-cortexagenthub-prd-001"

echo "🔍 Revisando logs de Azure App Service para diagnosticar error 500 en login"
echo "========================================================================"
echo ""

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

# 1. Verificar variables de entorno críticas
log "1️⃣ Verificando variables de entorno críticas..."
echo ""

JWT_SECRET=$(az webapp config appsettings list \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='JWT_SECRET'].value" -o tsv 2>/dev/null)

DATABASE_URL=$(az webapp config appsettings list \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='DATABASE_URL'].value" -o tsv 2>/dev/null)

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "null" ]; then
    error "❌ JWT_SECRET no está configurado o es null"
    warning "Esto causará error 500 al intentar generar el token JWT"
    echo ""
else
    success "✅ JWT_SECRET está configurado (${#JWT_SECRET} caracteres)"
fi

if [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL" = "null" ]; then
    error "❌ DATABASE_URL no está configurada o es null"
    warning "Esto causará error 500 al intentar autenticar usuarios"
    echo ""
else
    success "✅ DATABASE_URL está configurada"
    # Ocultar contraseña en la salida
    DATABASE_URL_MASKED=$(echo "$DATABASE_URL" | sed 's/:[^:@]*@/:***@/')
    log "   URL: $DATABASE_URL_MASKED"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 2. Obtener logs recientes del backend
log "2️⃣ Obteniendo logs recientes del backend (últimas 100 líneas)..."
echo ""

# Logs de aplicación
log "📋 Logs de aplicación (application logs):"
az webapp log tail \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --filter "error,warn,info" 2>/dev/null | head -100 || {
    warning "No se pudieron obtener logs en tiempo real"
    log "Intentando obtener logs históricos..."
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 3. Buscar errores específicos relacionados con login
log "3️⃣ Buscando errores específicos de login en los logs..."
echo ""

log "Buscando errores relacionados con:"
log "  - 'Login error'"
log "  - 'Authentication error'"
log "  - 'JWT'"
log "  - 'admin_users'"
log "  - 'DATABASE_URL'"
log "  - 'JWT_SECRET'"
echo ""

# Obtener logs y filtrar por errores de login
az webapp log download \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --log-file /tmp/azure-logs.zip 2>/dev/null || {
    warning "No se pudieron descargar logs completos"
    log "Usando método alternativo..."
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 4. Verificar estado del App Service
log "4️⃣ Verificando estado del App Service..."
echo ""

APP_STATE=$(az webapp show \
    --name "$BACKEND_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "state" -o tsv 2>/dev/null)

if [ "$APP_STATE" = "Running" ]; then
    success "✅ App Service está en estado: $APP_STATE"
else
    error "❌ App Service está en estado: $APP_STATE"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 5. Verificar conectividad a la base de datos
log "5️⃣ Verificando conectividad a la base de datos..."
echo ""

if [ -n "$DATABASE_URL" ] && [ "$DATABASE_URL" != "null" ]; then
    # Extraer host de la URL
    DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
    DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*@[^:]+:([0-9]+).*|\1|' || echo "5432")
    
    log "Intentando conectar a: $DB_HOST:$DB_PORT"
    
    # Verificar si la tabla admin_users existe (requiere psql)
    if command -v psql &> /dev/null; then
        log "Verificando si la tabla admin_users existe..."
        # Esto requeriría parsear la URL completa, por ahora solo mostramos la info
        warning "Para verificar la tabla admin_users, necesitas ejecutar manualmente:"
        warning "  psql \"$DATABASE_URL_MASKED\" -c \"SELECT COUNT(*) FROM admin_users;\""
    else
        warning "psql no está instalado. No se puede verificar la tabla admin_users directamente."
        warning "Instala psql para verificación completa:"
        warning "  macOS: brew install postgresql"
        warning "  Linux: apt-get install postgresql-client"
    fi
else
    error "No se puede verificar la base de datos: DATABASE_URL no está configurada"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 6. Comandos útiles para debugging
log "6️⃣ Comandos útiles para debugging adicional:"
echo ""
echo "📝 Ver logs en tiempo real:"
echo "   az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "📝 Ver todas las variables de entorno:"
echo "   az webapp config appsettings list --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP --output table"
echo ""
echo "📝 Ver logs de errores específicos:"
echo "   az webapp log tail --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP | grep -i 'error\|login\|jwt'"
echo ""
echo "📝 Probar endpoint de health:"
echo "   curl https://$BACKEND_APP_NAME.azurewebsites.net/health"
echo ""
echo "📝 Ver métricas del App Service:"
echo "   az monitor metrics list --resource /subscriptions/\$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$BACKEND_APP_NAME"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 7. Posibles causas del error 500
log "7️⃣ Posibles causas del error 500 en login:"
echo ""
echo "1. ❌ JWT_SECRET no configurado o inválido"
echo "   → Verificar: az webapp config appsettings list --name $BACKEND_APP_NAME --resource-group $RESOURCE_GROUP --query \"[?name=='JWT_SECRET']\""
echo ""
echo "2. ❌ DATABASE_URL incorrecta o no accesible"
echo "   → Verificar conectividad a la base de datos"
echo "   → Verificar que la tabla admin_users existe"
echo ""
echo "3. ❌ La tabla admin_users no existe"
echo "   → Ejecutar migraciones: backend/packages/database/migrations/001_initial_schema.sql"
echo ""
echo "4. ❌ Error al conectar a la base de datos"
echo "   → Verificar firewall de Azure PostgreSQL"
echo "   → Verificar que el App Service tiene acceso a la base de datos"
echo ""
echo "5. ❌ Error en el código (excepción no manejada)"
echo "   → Revisar logs de aplicación para ver el stack trace completo"
echo ""

success "✅ Análisis completado. Revisa los resultados arriba."
