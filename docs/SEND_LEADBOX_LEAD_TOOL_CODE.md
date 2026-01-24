# Código Actualizado - Tool: send_leadbox_lead

## Código JavaScript para la Tool

```javascript
async function handler(parameters, context) {
  // ============================================
  // CAPTURA TEMPRANA DE LEADS (NUEVA FUNCIONALIDAD)
  // ============================================
  // Si no se proporcionan nombre o telefono, extraer del contexto
  // Esto permite la captura temprana cuando el usuario muestra interés
  
  let nombre = parameters.nombre;
  let telefono = parameters.telefono;
  
  // Si nombre no está presente o está vacío, usar conversationId del contexto
  if (!nombre || nombre.trim().length < 2) {
    if (context && context.conversationId) {
      nombre = context.conversationId;
      logger.info('Using conversationId as nombre (early capture)', {
        conversationId: context.conversationId,
        channelType: context.channelType,
      });
    } else {
      throw new Error('Parameter "nombre" is required and must be at least 2 characters. Context.conversationId not available.');
    }
  }
  
  // Si telefono no está presente o tiene menos de 7 dígitos, usar userId del contexto
  // userId en WhatsApp es el número de teléfono que inició la conversación
  if (!telefono || telefono.trim().length < 7) {
    if (context && context.userId) {
      telefono = context.userId;
      logger.info('Using context.userId as telefono (early capture)', {
        userId: context.userId,
        channelType: context.channelType,
      });
    } else {
      throw new Error('Parameter "telefono" is required and must be at least 7 digits. Context.userId not available.');
    }
  }
  
  // Limpiar y formatear el teléfono (remover espacios, guiones, etc.)
  telefono = telefono.replace(/[\s\-\(\)]/g, '');
  
  // Validar formato de email (solo si se proporciona)
  if (parameters.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(parameters.email)) {
      throw new Error('Invalid email format');
    }
  }
  
  // Validar que el teléfono tenga al menos 7 dígitos después de limpiar
  if (telefono.length < 7) {
    throw new Error('Parameter "telefono" must be at least 7 digits after cleaning');
  }
  
  // Verificar que el token esté configurado
  if (!process.env.LEADBOX_API_TOKEN) {
    throw new Error('LEADBOX_API_TOKEN not configured in environment variables');
  }
  
  // Determinar el tipo de captura para logging
  const isEarlyCapture = (parameters.nombre === undefined || parameters.nombre.trim().length < 2) || 
                         (parameters.telefono === undefined || parameters.telefono.trim().length < 7);
  
  logger.info('Sending lead to Leadbox', {
    nombre: nombre,
    email: parameters.email || 'not provided',
    telefono: telefono,
    isEarlyCapture: isEarlyCapture,
    hasConversationId: !!(context && context.conversationId),
    hasUserId: !!(context && context.userId),
    channelType: context?.channelType || 'unknown',
  });

  try {
    // Construir el body dinámicamente
    const requestBody = {
      nombre: nombre,
      telefono: telefono
    };

    // Solo agregar email si existe
    if (parameters.email) {
      requestBody.email = parameters.email;
    }

    // Realizar llamada a API de Leadbox
    const response = await fetch('https://leadbox.ec/api/callback/landing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': process.env.LEADBOX_API_TOKEN
      },
      body: JSON.stringify(requestBody)
    });

    // Leer respuesta
    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText;
    }

    // Validar respuesta HTTP
    if (!response.ok) {
      logger.error('Leadbox API error', {
        status: response.status,
        statusText: response.statusText,
        response: responseData,
        isEarlyCapture: isEarlyCapture,
      });
      throw new Error(`Leadbox API error: ${response.status} - ${JSON.stringify(responseData)}`);
    }

    logger.info('Lead sent successfully to Leadbox', {
      nombre: nombre,
      email: parameters.email || 'not provided',
      responseStatus: response.status,
      isEarlyCapture: isEarlyCapture,
      captureType: isEarlyCapture ? 'early_interest' : 'complete_data',
    });

    return {
      success: true,
      lead: {
        nombre: nombre,
        telefono: telefono,
        ...(parameters.email && { email: parameters.email })
      },
      leadboxResponse: responseData,
      timestamp: new Date().toISOString(),
      captureType: isEarlyCapture ? 'early_interest' : 'complete_data',
    };

  } catch (error) {
    logger.error('Failed to send lead to Leadbox', {
      error: error.message,
      nombre: nombre,
      email: parameters.email || 'not provided',
      isEarlyCapture: isEarlyCapture,
      hasContext: !!context,
      hasConversationId: !!(context && context.conversationId),
      hasUserId: !!(context && context.userId),
    });
    throw error;
  }
}
```

## Cambios Realizados

### 1. Extracción automática del contexto (NUEVO)

**Líneas 7-37:** Ahora la tool extrae automáticamente `nombre` y `telefono` del contexto si no se proporcionan:

- **`nombre`**: Si no está presente o tiene menos de 2 caracteres, usa `context.conversationId`
- **`telefono`**: Si no está presente o tiene menos de 7 dígitos, usa `context.userId` (que en WhatsApp es el número de teléfono que inició la conversación)

### 2. Limpieza de teléfono

**Línea 39:** Se limpia el teléfono removiendo espacios, guiones y paréntesis para asegurar formato consistente.

### 3. Logging mejorado

- Se registra si es una captura temprana o completa (`isEarlyCapture`)
- Se incluye información del contexto disponible
- Se diferencia el tipo de captura en los logs

### 4. Validación mejorada

- Validación después de limpiar el teléfono
- Validación del contexto disponible antes de usar valores por defecto
- Mensajes de error más descriptivos

## Compatibilidad

✅ **Compatible con uso anterior:** Si se proporcionan `nombre` y `telefono` explícitamente, se usan esos valores (comportamiento anterior)

✅ **Nueva funcionalidad:** Si no se proporcionan o están vacíos, se extraen automáticamente del contexto

✅ **Sin cambios en la API:** La API de Leadbox recibe los mismos datos en el mismo formato

## Flujo de Ejecución

### Captura Temprana (Nueva):
```javascript
// LLM ejecuta:
{
  "tool": "send_leadbox_lead",
  "parameters": {}
}

// La tool extrae:
nombre = context.conversationId
telefono = context.userId
```

### Captura Completa (Existente):
```javascript
// LLM ejecuta:
{
  "tool": "send_leadbox_lead",
  "parameters": {
    "nombre": "Juan Pérez",
    "telefono": "0991234567",
    "email": "juan@example.com" // opcional
  }
}

// La tool usa los valores proporcionados directamente
```

## Notas Importantes

1. **El contexto debe estar disponible:** La tool requiere que `context` se pase correctamente desde el sistema MCP
2. **Validación doble:** Se valida que el contexto tenga los valores necesarios antes de usarlos
3. **Logging detallado:** Todos los casos se registran para debugging y monitoreo
4. **Sin cambios en respuesta:** El formato de respuesta es el mismo, solo se agrega `captureType` para identificar el tipo de captura
