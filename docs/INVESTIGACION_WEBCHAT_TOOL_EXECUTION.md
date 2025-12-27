# Investigación: Tool no ejecutada para mensaje de WebChat

## Resumen del Problema

**Conversación ID:** `584874f7-3329-40d3-b8a1-def99f9ee5f3`  
**Usuario:** `user_112527766_1765559866958`  
**Canal:** `webchat`  
**Problema:** No se ejecutó ninguna tool para los mensajes de esta conversación

## Hallazgos

### ✅ Configuración Correcta

1. **Tools disponibles para webchat:**
   - `enviar_correo` ✅ (activa, permisos para webchat)
   - `send_leadbox_lead` ✅ (activa, permisos para webchat)

2. **Flow activo para webchat:**
   - **Flow:** "Agente de Ventas PuntoNet" (ID: `ef35e53e-f940-4727-a74c-d972dc8c7c44`)
   - **Tools habilitadas:** `{send_leadbox_lead, enviar_correo}`
   - **Estado:** activo
   - **Instance Identifier:** `ventas`
   - **Routing Conditions:** `{"metadata": {}, "messagePattern": ".*"}`

3. **Mensajes procesados:**
   - Se procesaron 18 mensajes en la conversación
   - Los mensajes tienen metadata: `{"messageId": "...", "websiteId": "ventas", "instanceId": "ventas"}`
   - Todos los mensajes fueron respondidos por el asistente

### ❌ Problema Identificado

**El `flow_id` en la conversación es NULL**

```sql
SELECT id, channel, channel_user_id, flow_id 
FROM conversations 
WHERE id = '584874f7-3329-40d3-b8a1-def99f9ee5f3';

-- Resultado:
-- flow_id = NULL ❌
```

**Esto significa que:**
1. El routing NO asignó el flow a la conversación
2. Aunque el flow existe y tiene tools habilitadas, no se está aplicando
3. Sin flow asignado, las tools no se envían al LLM

### 🔍 Análisis del Código

En `backend/api-service/src/server.ts` línea 790:

```typescript
// Update last activity and flow_id (if available from routing)
const flowId = routingResult?.flow?.id || null;
await this.db.query(
  `UPDATE conversations SET last_activity = NOW(), flow_id = COALESCE(flow_id, $2) WHERE id = $1`,
  [dbConversationId, flowId]
);
```

**Problema:** Si `routingResult` es `null` o no tiene `flow`, entonces `flowId` será `null` y el `flow_id` no se actualizará.

## Posibles Causas

### 1. Routing no está funcionando correctamente

El `FlowBasedMessageRouter` debería:
- Buscar flows con `channel_type = 'webchat'` y `instance_identifier = 'ventas'`
- Verificar que las condiciones de routing coincidan (`messagePattern: ".*"` debería coincidir con todo)
- Retornar el flow en `routingResult`

**Posibles problemas:**
- El `instanceIdentifier` no coincide correctamente
- Las condiciones de routing no están evaluándose correctamente
- El router no está encontrando el flow

### 2. El routing se ejecuta pero retorna null

Aunque el flow existe, el router puede estar retornando `null` si:
- Las condiciones no coinciden (aunque `messagePattern: ".*"` debería coincidir con todo)
- Hay un error en el proceso de matching
- El flow no está activo en el momento del routing

### 3. El flow_id no se actualiza correctamente

Aunque el routing funcione, si hay un error al actualizar la base de datos, el `flow_id` permanecerá NULL.

## Recomendaciones

### 1. Verificar logs de Azure para este usuario

```bash
az webapp log tail \
  --name app-back-cortexagenthub-stg-001 \
  --resource-group rg-cortexagenthub-stg-001 | \
  grep -i "user_112527766_1765559866958"
```

Buscar específicamente:
- Logs de routing: "Routing WebChat message", "FlowBasedMessageRouter", "Matched orchestration flow"
- Logs de tools: "Available tools", "Sending tools to LLM", "tool call"
- Errores relacionados con routing o tools

### 2. Verificar que el routing esté funcionando

En los logs, buscar:
```
"Routing WebChat message"
"WebChat message routed to flow"
"Available tools"
"Sending tools to LLM"
```

Si estos logs no aparecen, el routing no está funcionando.

### 3. Actualizar manualmente el flow_id para testing

Para verificar si el problema es solo el routing, puedes actualizar manualmente:

```sql
UPDATE conversations 
SET flow_id = 'ef35e53e-f940-4727-a74c-d972dc8c7c44' 
WHERE id = '584874f7-3329-40d3-b8a1-def99f9ee5f3';
```

Luego enviar un nuevo mensaje y verificar si las tools se ejecutan.

### 4. Verificar el código de routing

Revisar `backend/packages/core/src/router/FlowBasedMessageRouter.ts`:
- Verificar que el `instanceIdentifier` se esté extrayendo correctamente del metadata
- Verificar que las condiciones de routing se estén evaluando correctamente
- Agregar más logs para debugging

### 5. Verificar que enableToolExecution esté activo

Ya está configurado en `server.ts` línea 492:
```typescript
enableToolExecution: true,
```

## Próximos Pasos

1. ✅ Verificar logs de Azure para ver qué está pasando con el routing
2. ✅ Verificar si hay errores en el proceso de routing
3. ✅ Actualizar el flow_id manualmente para testing
4. ✅ Agregar más logging al proceso de routing para debugging
5. ✅ Verificar que el instanceIdentifier se esté pasando correctamente

## Script de Investigación

Se creó el script `backend/api-service/scripts/investigate-webchat-tool-execution.sh` que:
- Busca el mensaje en la base de datos
- Verifica ejecuciones de tools
- Verifica configuración del flow
- Verifica tools disponibles
- Busca en logs de Azure

Ejecutar con:
```bash
./backend/api-service/scripts/investigate-webchat-tool-execution.sh [message_id]
```
