#!/bin/bash
# Script para mover scripts obsoletos al directorio archive
# Estos scripts fueron creados para debugging/investigación temporal y ya no son necesarios

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Crear directorio archive si no existe
mkdir -p "$ARCHIVE_DIR"

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Limpiando scripts obsoletos"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""

# Scripts obsoletos a archivar (investigación/debugging temporal)
OBSOLETE_SCRIPTS=(
    # Scripts de análisis de errores ya corregidos
    "analyze-azure-errors.sh"
    "ANALISIS_ERRORES_AZURE.md"
    "RESUMEN_ERRORES_CORREGIDOS.md"
    
    # Scripts de investigación específica temporal
    "investigate-missing-whatsapp-responses.sh"
    "investigate-image-messages.sh"
    "investigate-webchat-tool-execution.sh"
    "investigate-whatsapp-conversations.sh"
    
    # Scripts de verificación temporal
    "check-ultramsg-errors.sh"
    
    # Scripts de visualización de logs temporal
    "view-azure-logs-rag.sh"
    "view-azure-logs-save.ts"
    "view-azure-logs.sh"
    "view-widget-cors-logs.sh"
    
    # Migración específica ya ejecutada (008)
    "run-migration-008-azure.sh"
)

moved_count=0
skipped_count=0

for script in "${OBSOLETE_SCRIPTS[@]}"; do
    script_path="$SCRIPT_DIR/$script"
    
    if [ -f "$script_path" ]; then
        log "Moviendo: $script"
        mv "$script_path" "$ARCHIVE_DIR/"
        moved_count=$((moved_count + 1))
    else
        warning "No encontrado: $script (puede que ya esté archivado)"
        skipped_count=$((skipped_count + 1))
    fi
done

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "✅ Limpieza completada"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Scripts movidos: $moved_count"
log "Scripts no encontrados: $skipped_count"
log ""
log "Los scripts fueron movidos a: $ARCHIVE_DIR"
log "Puedes recuperarlos desde ahí si los necesitas en el futuro."

