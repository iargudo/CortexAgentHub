#!/bin/bash

# ================================================================
# Script para limpiar todas las conversaciones
# ================================================================
# Uso: ./clear-conversations.sh [local|azure]
# ================================================================

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Determinar qué base de datos usar
DB_TYPE="${1:-local}"

if [ "$DB_TYPE" = "azure" ]; then
    echo -e "${YELLOW}🌐 Usando base de datos AZURE${NC}"
    
    # Obtener DATABASE_URL de Azure
    if [ -z "$DATABASE_URL" ]; then
        echo -e "${RED}❌ Error: DATABASE_URL no está configurado${NC}"
        echo "Por favor, configura DATABASE_URL con la URL de Azure PostgreSQL"
        exit 1
    fi
    
    DB_URL="$DATABASE_URL"
else
    echo -e "${YELLOW}💻 Usando base de datos LOCAL${NC}"
    
    # Configuración local por defecto
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-cortex_agent_hub}"
    DB_USER="${DB_USER:-postgres}"
    DB_PASSWORD="${DB_PASSWORD:-postgres}"
    
    DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

# Obtener el directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/clear-conversations.sql"

if [ ! -f "$SQL_FILE" ]; then
    echo -e "${RED}❌ Error: No se encontró el archivo SQL: $SQL_FILE${NC}"
    exit 1
fi

# Confirmación
echo -e "${RED}⚠️  ADVERTENCIA: Este script eliminará TODAS las conversaciones y datos relacionados.${NC}"
echo -e "${YELLOW}📊 Tablas que se limpiarán:${NC}"
echo "   - conversations (conversaciones)"
echo "   - messages (mensajes)"
echo "   - tool_executions (ejecuciones de herramientas)"
echo "   - context_store (contextos de sesión)"
echo "   - analytics_events (eventos de analytics)"
echo "   - system_logs (se limpiarán referencias a conversaciones)"
echo ""
echo -e "${YELLOW}📋 Tablas que NO se tocarán:${NC}"
echo "   - channel_configs"
echo "   - llm_configs"
echo "   - orchestration_flows"
echo "   - tool_definitions"
echo "   - knowledge_bases y documentos relacionados"
echo ""
read -p "¿Estás seguro de que quieres continuar? (escribe 'SI' para confirmar): " confirmation

if [ "$confirmation" != "SI" ]; then
    echo -e "${YELLOW}❌ Operación cancelada${NC}"
    exit 0
fi

# Test de conexión
echo -e "${YELLOW}🔌 Probando conexión a la base de datos...${NC}"
if psql "$DB_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Conexión exitosa${NC}"
else
    echo -e "${RED}❌ Error: No se pudo conectar a la base de datos${NC}"
    exit 1
fi

# Ejecutar el script SQL
echo -e "${YELLOW}🧹 Ejecutando limpieza...${NC}"
echo ""

if psql "$DB_URL" -f "$SQL_FILE"; then
    echo ""
    echo -e "${GREEN}✅ ¡Limpieza completada exitosamente!${NC}"
else
    echo ""
    echo -e "${RED}❌ Error durante la limpieza${NC}"
    exit 1
fi

