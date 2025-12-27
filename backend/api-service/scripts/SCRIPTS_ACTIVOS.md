# 📋 Scripts Activos - Guía de Referencia

Este documento lista todos los scripts activos y su propósito.

## 🔧 Scripts de Utilidad General

### `compare-db-schemas.ts`
**Propósito:** Compara la estructura de dos bases de datos (local vs Azure)
**Uso:** `pnpm tsx scripts/compare-db-schemas.ts`
**Cuándo usar:** Cuando necesites verificar diferencias entre bases de datos

### `sync-local-from-azure.sh`
**Propósito:** Sincroniza la base de datos local con Azure (estructura + datos)
**Uso:** `./scripts/sync-local-from-azure.sh`
**Cuándo usar:** Cuando necesites copiar la estructura y datos de producción a local

### `create-admin-user.ts`
**Propósito:** Crea un usuario administrador en la base de datos
**Uso:** `pnpm tsx scripts/create-admin-user.ts`
**Cuándo usar:** Para crear usuarios admin cuando sea necesario

## 📊 Scripts de Análisis y Verificación

### `analyze-table-usage.ts`
**Propósito:** Analiza qué tablas están siendo usadas en el código
**Uso:** `pnpm tsx scripts/analyze-table-usage.ts`
**Cuándo usar:** Para identificar tablas no utilizadas

### `check-document-status.ts`
**Propósito:** Verifica el estado de documentos en knowledge bases
**Uso:** `pnpm tsx scripts/check-document-status.ts [documentId]`
**Cuándo usar:** Para debugging de documentos en KB

### `check-kb-tables.ts`
**Propósito:** Verifica que las tablas de knowledge bases existan y tengan la estructura correcta
**Uso:** `pnpm tsx scripts/check-kb-tables.ts`
**Cuándo usar:** Para verificar integridad de tablas de KB

## 🗄️ Scripts de Migración

### `run-migration-azure.sh`
**Propósito:** Ejecuta migraciones SQL en Azure PostgreSQL (genérico)
**Uso:** `./scripts/run-migration-azure.sh [migration-file]`
**Cuándo usar:** Para ejecutar migraciones específicas en Azure

### `run-migration-017-azure.sh`
**Propósito:** Ejecuta la migración 017 (eliminación de tablas *_count) en Azure
**Uso:** `./scripts/run-migration-017-azure.sh`
**Cuándo usar:** Ya ejecutada, mantener por referencia

## 📚 Documentación

### `README-LOGS.md`
**Propósito:** Guía completa sobre cómo acceder y usar los logs de Azure
**Cuándo usar:** Referencia para debugging y monitoreo

### `table-usage-analysis-report.md`
**Propósito:** Reporte del análisis de uso de tablas
**Cuándo usar:** Referencia histórica del análisis realizado

## 🧹 Scripts de Mantenimiento

### `cleanup-obsolete-scripts.sh`
**Propósito:** Mueve scripts obsoletos al directorio archive
**Uso:** `./scripts/cleanup-obsolete-scripts.sh`
**Cuándo usar:** Para limpiar scripts temporales después de debugging

---

## 📁 Scripts en Otros Directorios

### `backend/packages/database/scripts/`
- `clear-conversations.sh` - Limpia conversaciones y datos relacionados
- `clear-conversations.sql` - SQL para limpiar conversaciones
- `delete-conversation.sql` - Elimina una conversación específica
- `delete-webchat-user.sh` - Elimina un usuario de webchat
- `delete-webchat-user.sql` - SQL para eliminar usuario de webchat

### `scripts/` (raíz)
- `diagnose-websocket-azure.sh` - Diagnóstico de WebSocket en Azure
- `enable-pgvector-azure.sh` - Habilita extensión pgvector en Azure
- `enable-websockets-azure.sh` - Habilita WebSockets en Azure App Service

---

## 📦 Scripts Archivados

Los scripts obsoletos o temporales están en `archive/`. Ver `archive/README.md` para más detalles.

