# 📊 Análisis de Errores en Azure - Logs

## 🔍 Errores Reportados y Estado

### ✅ **ERROR 1: `column c.instance_identifier does not exist`**

**Estado:** ✅ **RESUELTO**

**Descripción:**
- El código compilado en `dist` tenía referencias a `c.instance_identifier` que ya no existe en la base de datos
- La migración 016 eliminó esta columna

**Solución aplicada:**
- Se recompiló el paquete `core` eliminando referencias a `instance_identifier`
- Se recompiló el `api-service` con el código actualizado

**Qué buscar en logs:**
```bash
grep -i "instance_identifier" logs
```
Si aparece este error después del despliegue, significa que el código antiguo aún está en producción.

---

### ✅ **ERROR 2: `invalid input syntax for type uuid: ""`**

**Estado:** ✅ **RESUELTO**

**Descripción:**
- Cuando `requestedChannelId` era `undefined`, se pasaba una cadena vacía `''` a PostgreSQL
- PostgreSQL no puede convertir `''` a UUID, solo acepta UUID válido o `NULL`

**Causa raíz:**
- En producción, `identifyWhatsAppChannelFromWebhook()` puede retornar `undefined` si no identifica el canal
- El código original hacía: `requestedChannelId || ''` → convertía `undefined` en `''`
- PostgreSQL rechazaba `''` con error: `invalid input syntax for type uuid: ""`

**Solución aplicada:**
```typescript
// ANTES (incorrecto):
const result = await this.db.query(query, [message.channelType, requestedChannelId || '']);

// DESPUÉS (correcto):
const result = await this.db.query(query, [message.channelType, requestedChannelId || null]);
```

Y se actualizó la consulta SQL:
```sql
CASE 
  WHEN $2 IS NOT NULL AND c.id = $2 THEN 1  -- Solo compara si no es NULL
  ELSE 2
END as channel_match_priority
```

**Qué buscar en logs:**
```bash
grep -i "invalid input syntax for type uuid" logs
```
Si aparece después del despliegue, el código antiguo aún está en producción.

---

## 🔍 Problemas Potenciales a Verificar

### 1. **Identificación de Canal WhatsApp**

**Qué buscar:**
```bash
grep -i "Could not identify.*WhatsApp channel\|identifyWhatsAppChannelFromWebhook" logs
```

**Posibles causas:**
- El `instanceId` del webhook no coincide con el configurado en la base de datos
- El formato del webhook cambió
- Múltiples canales configurados y no se puede determinar cuál usar

**Logs esperados:**
```
[WARN] Could not identify specific WhatsApp channel from webhook, will use routing by type
```

---

### 2. **Routing de Mensajes**

**Qué buscar:**
```bash
grep -i "No active flows found\|routing.*error\|FlowBasedMessageRouter" logs
```

**Posibles causas:**
- No hay flows activos para el tipo de canal
- El flow no tiene canales asignados en `flow_channels`
- El routing falla por condiciones no cumplidas

**Logs esperados:**
```
[WARN] ❌ No active flows found for channel
[INFO] ✅ Found potential flows
```

---

### 3. **Guardado de Conversaciones**

**Qué buscar:**
```bash
grep -i "Failed to save conversation\|saveConversation.*error\|conversation.*error" logs
```

**Posibles causas:**
- Error de conexión a base de datos
- Violación de constraints
- Timeout en la consulta

**Logs esperados:**
```
[ERROR] Failed to save conversation and messages to database
```

---

### 4. **Errores de Base de Datos**

**Qué buscar:**
```bash
grep -i "database.*error\|postgres.*error\|connection.*failed\|Database pool error" logs
```

**Posibles causas:**
- Conexión perdida a PostgreSQL
- Pool de conexiones agotado
- Timeout de consultas

---

## 📋 Comandos para Analizar Logs

### Ver logs en tiempo real:
```bash
az webapp log tail \
  --name app-back-cortexagenthub-stg-001 \
  --resource-group rg-cortexagenthub-stg-001
```

### Buscar errores específicos:
```bash
# Errores de UUID
az webapp log tail --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001 | grep -i "uuid"

# Errores de webhook
az webapp log tail --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001 | grep -i "webhook.*error"

# Errores de routing
az webapp log tail --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001 | grep -i "routing\|flow"
```

### Usar el script de análisis:
```bash
cd backend/api-service
./scripts/analyze-azure-errors.sh
```

---

## 🎯 Checklist Post-Despliegue

Después de desplegar el código corregido, verifica:

- [ ] No aparecen errores de `instance_identifier`
- [ ] No aparecen errores de `invalid input syntax for type uuid: ""`
- [ ] Los webhooks de WhatsApp se procesan correctamente
- [ ] Las conversaciones se guardan en la base de datos
- [ ] El routing encuentra flows activos
- [ ] No hay errores de conexión a base de datos

---

## 📝 Notas Importantes

1. **Los errores corregidos requieren un nuevo despliegue** para que el código actualizado esté en producción

2. **Si los errores persisten después del despliegue:**
   - Verifica que el código compilado en `dist` esté actualizado
   - Verifica que el despliegue incluyó los cambios
   - Revisa los logs para confirmar que el código nuevo está corriendo

3. **Para debugging en producción:**
   - Los logs incluyen información detallada sobre `channelId`, `instanceId`, `flowId`
   - Busca los logs con `[INFO]` para ver el flujo normal
   - Busca los logs con `[ERROR]` para ver qué está fallando

---

## 🔗 Referencias

- Scripts de logs: `backend/api-service/scripts/view-azure-logs.sh`
- Documentación de logs: `backend/api-service/scripts/README-LOGS.md`
- Azure Portal: https://portal.azure.com

