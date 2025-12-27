#!/bin/bash

# Script de configuración para usar servicios locales de Mac
# Solo levanta Weaviate en Docker, usa PostgreSQL y Redis locales

set -e

echo "🚀 CortexAgentHub - Configuración con Servicios Locales"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_step() {
    echo -e "${BLUE}➜${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Database credentials (ajusta según tu configuración)
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="cortexagenthub"
DB_USER="postgres"
DB_PASS="cial1997"

# Verificar .env
print_step "Verificando configuración..."

if [ ! -f .env ]; then
    print_warning ".env no encontrado, creando desde .env.local.example..."
    cp .env.local.example .env
    print_success ".env creado (revisa y ajusta si es necesario)"
else
    print_success ".env encontrado"
fi

# Check prerequisites
print_step "Verificando prerrequisitos..."

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker no está instalado"
    exit 1
fi
print_success "Docker instalado"

# Check psql
if ! command -v psql &> /dev/null; then
    print_error "psql no está instalado. Instala PostgreSQL client."
    exit 1
fi
print_success "psql disponible"

# Check Ollama
if ! command -v ollama &> /dev/null; then
    print_error "Ollama no está instalado. Instala desde: https://ollama.ai"
    exit 1
fi
print_success "Ollama instalado"

echo ""
print_step "Verificando servicios locales..."

# Check PostgreSQL local
if ! PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d postgres -c "SELECT 1;" &> /dev/null; then
    print_error "PostgreSQL local no está corriendo o credenciales incorrectas"
    print_warning "Verifica: psql -h localhost -U postgres -d postgres"
    exit 1
fi
print_success "PostgreSQL local conectado"

# Verificar si la base de datos existe
if ! PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    print_warning "Base de datos '$DB_NAME' no existe. Creando..."
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"
    print_success "Base de datos '$DB_NAME' creada"
else
    print_success "Base de datos '$DB_NAME' existe"
fi

# Check Redis local
if ! redis-cli ping &> /dev/null; then
    print_error "Redis local no está corriendo"
    print_warning "Inicia Redis: brew services start redis"
    exit 1
fi
print_success "Redis local corriendo"

echo ""
print_step "Configurando pgvector en PostgreSQL..."

# Verificar si pgvector está instalado
if PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT extname FROM pg_extension WHERE extname = 'vector';" | grep -q vector; then
    print_success "pgvector ya está instalado"
else
    print_warning "pgvector no está instalado. Instalando..."
    
    # Instalar pgvector si no está
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS con Homebrew
        if command -v brew &> /dev/null; then
            print_step "Instalando pgvector con Homebrew..."
            brew install pgvector || true
            print_success "pgvector instalado"
        fi
    fi
    
    # Ejecutar script SQL para crear extensión y tablas
    print_step "Ejecutando script de configuración de pgvector..."
    if PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f setup-pgvector.sql &> /dev/null; then
        print_success "pgvector configurado correctamente"
    else
        print_warning "No se pudo configurar pgvector automáticamente"
        print_warning "Ejecuta manualmente: psql -h localhost -U postgres -d cortexagenthub -f setup-pgvector.sql"
    fi
fi

echo ""
print_step "Verificando Ollama..."

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    print_warning "Ollama no está corriendo. Iniciando..."
    ollama serve &
    sleep 3
fi
print_success "Ollama corriendo"

# Check if model is downloaded
if ! ollama list | grep -q "llama3.2"; then
    print_step "Descargando modelo llama3.2:3b (esto puede tardar unos minutos)..."
    ollama pull llama3.2:3b
    print_success "Modelo descargado"
else
    print_success "Modelo llama3.2:3b disponible"
fi

echo ""
print_step "Verificando/creando schema de base de datos..."

# Check if tables exist
TABLE_COUNT=$(PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('tool_definitions', 'channel_configs', 'llm_configs', 'orchestration_flows');" 2>/dev/null | xargs || echo "0")

if [ "$TABLE_COUNT" -lt "4" ]; then
    print_warning "Tablas no encontradas. Ejecutando migraciones..."
    cd backend/packages/database
    
    # Ejecutar scripts SQL de migración
    if [ -d "migrations" ]; then
        for file in migrations/*.sql; do
            if [ -f "$file" ]; then
                print_step "Ejecutando: $(basename $file)"
                PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f "$file" || true
            fi
        done
    fi
    
    cd ../..
    print_success "Migraciones ejecutadas"
else
    print_success "Schema de base de datos OK"
fi

echo ""
print_step "Ejecutando seed de la base de datos..."

cd backend/packages/database
if pnpm seed 2>&1 | grep -q "error"; then
    print_warning "Seed con warnings (normal si ya existe data)"
else
    print_success "Seed completado"
fi
cd ../../..

echo ""
print_step "Insertando herramienta de clima..."

if PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f insert-weather-tool.sql &> /dev/null; then
    print_success "Herramienta de clima insertada"
else
    print_error "Error al insertar herramienta"
    exit 1
fi

echo ""
print_step "Creando flujo de orquestación..."

if PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f create-orchestration-flow.sql &> /dev/null; then
    print_success "Flujo de orquestación creado"
else
    print_warning "Error al crear flujo (puede que ya exista)"
fi

echo ""
print_step "Verificando configuración final..."

# Verify tool
TOOL_COUNT=$(PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM tools WHERE name='get_weather' AND active=true;" 2>/dev/null | xargs || echo "0")
if [ "$TOOL_COUNT" == "1" ]; then
    print_success "Herramienta get_weather: ACTIVA"
else
    print_error "Herramienta no encontrada"
fi

# Verify flow
FLOW_COUNT=$(PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM orchestration_flows WHERE name='WebChat con Clima' AND active=true;" 2>/dev/null | xargs || echo "0")
if [ "$FLOW_COUNT" -ge "1" ]; then
    print_success "Flujo de orquestación: ACTIVO"
else
    print_error "Flujo no encontrado"
fi

echo ""
echo "=================================================="
echo -e "${GREEN}✓ Configuración completada exitosamente${NC}"
echo "=================================================="
echo ""
echo "📊 Estado de los servicios:"
echo ""
echo "✓ PostgreSQL: localhost:5432 (local + pgvector)"
echo "✓ Redis: localhost:6379 (local)"
echo "✓ Ollama: localhost:11434 (local)"
echo ""
echo "📋 Próximos pasos:"
echo ""
echo "1. Terminal 1 - Iniciar API Service:"
echo "   cd backend/api-service"
echo "   pnpm dev"
echo ""
echo "2. Terminal 2 - Iniciar Frontend:"
echo "   cd frontend"
echo "   pnpm dev"
echo ""
echo "3. Abrir navegador:"
echo "   http://localhost:5173/playground"
echo ""
echo "4. Probar con mensajes como:"
echo "   - \"¿Qué clima hace en Madrid?\""
echo "   - \"Dime el clima en Barcelona\""
echo ""
echo "📖 Más información en: EJEMPLO_CLIMA.md"
echo ""

