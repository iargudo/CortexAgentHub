# ¿Por qué funcionaba en WhatsApp pero no en WebChat?

## Diferencia Clave: Cuándo se establece el `flow_id`

### WhatsApp (webhooks.controller.ts)

**Líneas 427-446:** Cuando se crea una conversación NUEVA, el `flow_id` se incluye directamente en el INSERT:

```typescript
const flowId = routingResult?.flow?.id || null;

// Si es una conversación nueva
INSERT INTO conversations (..., flow_id) VALUES (..., $5)
// Donde $5 es flowId
```

**Resultado:** Si el routing funciona en el **primer mensaje**, el `flow_id` se establece desde el principio y queda guardado.

**Líneas 468-474:** Si la conversación ya existe:
```typescript
if (flowId) {
  UPDATE conversations SET flow_id = COALESCE(flow_id, $1) WHERE id = $2
}
```

### WebChat (server.ts - ANTES del fix)

**Líneas 773-780:** Cuando se crea una conversación nueva, también incluye `flow_id`:
```typescript
const flowIdForInsert = routingResult?.flow?.id || null;
INSERT INTO conversations (..., flow_id) VALUES (..., $3)
```

**PERO líneas 787-792 (ANTES del fix):** Si la conversación ya existe:
```typescript
const flowId = routingResult?.flow?.id || null;
UPDATE conversations SET last_activity = NOW(), flow_id = COALESCE(flow_id, $2) WHERE id = $1
```

**Problema:** Si el routing falla la primera vez (por el bug del RoutingMatcher), el `flow_id` queda NULL. En mensajes posteriores, aunque el routing funcione, `COALESCE(flow_id, $2)` no actualiza si `flow_id` ya es NULL y `$2` también es NULL (porque el routing falló).

## El Bug del RoutingMatcher

El bug afectaba cuando:
- `routing_conditions = {"metadata": {}, "messagePattern": ".*"}`
- El código ANTES verificaba `if (!message.metadata)` → retornaba false si no había metadata

**Pero:** Si el mensaje SÍ tenía metadata (como en WebChat: `{"instanceId": "ventas", "websiteId": "ventas"}`), el bug no se activaba porque `!message.metadata` era false.

## ¿Por qué funcionaba en WhatsApp entonces?

**Teoría 1: Conversaciones nuevas**
- En WhatsApp, si el routing funcionaba en el primer mensaje, el `flow_id` se establecía desde el principio
- En WebChat, la conversación ya existía (fue creada antes de que el routing funcionara), así que el `flow_id` quedó NULL

**Teoría 2: Timing diferente**
- WhatsApp puede haber tenido conversaciones creadas cuando el routing ya funcionaba
- WebChat puede haber creado la conversación cuando el routing fallaba

**Teoría 3: Diferencia en metadata**
- WhatsApp puede incluir metadata diferente que hace que el routing funcione de otra manera
- O el instanceIdentifier de WhatsApp (`instance148415`) puede coincidir mejor que el de WebChat (`ventas`)

## Solución Aplicada

1. **Fix del RoutingMatcher:** Ahora maneja correctamente `metadata: {}` como "sin restricciones"
2. **Fix de actualización de flow_id:** Ahora siempre actualiza el `flow_id` cuando hay un routingResult válido, no solo cuando es NULL

Esto asegura que:
- El routing funcione correctamente para ambos canales
- El `flow_id` se actualice incluso si la conversación ya existe
- Las tools se envíen al LLM cuando el flow tiene tools habilitadas



