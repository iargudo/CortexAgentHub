# Configuración de CORS para CortexAgentHub

Este documento explica cómo configurar CORS (Cross-Origin Resource Sharing) para el sistema CortexAgentHub, tanto en el código como en Azure App Service.

## Resumen

CORS se configura en **dos niveles**:

1. **Nivel de aplicación (Fastify)**: Configurado en `backend/api-service/src/server.ts`
2. **Nivel de widget (AdminController)**: Configurado en la base de datos para cada widget individual

## 1. Configuración a Nivel de Aplicación (Fastify)

### Variable de Entorno: `CORS_ORIGIN`

**Ubicación**: Variables de entorno de Azure App Service (backend)

**Valores posibles**:
- `*` - Permite todos los orígenes (desarrollo)
- `https://app-front-cortexagenthub-stg-001.azurewebsites.net` - Un solo origen
- `https://app-front-cortexagenthub-stg-001.azurewebsites.net,https://otro-dominio.com` - Múltiples orígenes separados por coma

**Ejemplo para producción**:
```
CORS_ORIGIN=https://app-front-cortexagenthub-stg-001.azurewebsites.net
```

**Ejemplo para desarrollo local**:
```
CORS_ORIGIN=*
```

### Cómo Funciona

El código en `backend/api-service/src/server.ts` procesa esta variable:

```typescript
const corsOrigin = process.env.CORS_ORIGIN || '*';
```

- Si es `*`, permite todos los orígenes
- Si es un string, permite ese origen específico
- Si contiene comas, permite todos los orígenes listados

**Importante**: Esta configuración afecta a **todas las rutas HTTP** de la API, pero **NO afecta directamente a WebSockets**.

## 2. Configuración a Nivel de Widget

### Campo: `allowed_origins` en la tabla `widgets`

**Ubicación**: Base de datos → Tabla `widgets` → Columna `allowed_origins`

**Valores posibles**:
- `NULL` o `[]` (vacío) - Permite todos los orígenes (widget público)
- `["*"]` - Permite todos los orígenes (equivalente a vacío)
- `["https://dominio1.com", "https://dominio2.com"]` - Lista de orígenes permitidos

### Cómo Funciona

El código en `backend/api-service/src/controllers/admin.controller.ts` valida el origen cuando se solicita la configuración del widget:

```typescript
// Si allowed_origins está vacío o es null, permite todos los orígenes
if (allowedOrigins.length > 0 && origin) {
  // Valida el origen contra la lista permitida
}
```

**Importante**: Esta validación solo aplica a la **solicitud de configuración del widget** (`GET /api/widgets/{key}/config`), no al WebSocket directamente.

## 3. WebSockets y CORS

### Importante sobre WebSockets

Los WebSockets **NO usan CORS** de la misma manera que las peticiones HTTP. En su lugar:

1. **Handshake HTTP**: El upgrade request inicial puede ser validado por CORS
2. **Conexión WebSocket**: Una vez establecida, no hay validación CORS adicional

### Validación de Origen en WebSocket

Actualmente, el handler de WebSocket en `backend/api-service/src/routes/index.ts` **NO valida el origen**. Esto significa que:

- Cualquier origen puede conectarse al WebSocket
- La validación de seguridad se hace mediante **autenticación JWT** después de la conexión

### Recomendación

Si necesitas restringir los orígenes que pueden conectarse al WebSocket, deberías:

1. Validar el origen en el handler de WebSocket (similar a como se hace en `WebChatAdapter`)
2. O confiar en la autenticación JWT y validar el origen en el endpoint de autenticación

## 4. Configuración en Azure App Service

### Variables de Entorno

1. Ve a Azure Portal → App Service (backend) → Configuration → Application settings
2. Agrega o edita:
   - `CORS_ORIGIN`: `https://app-front-cortexagenthub-stg-001.azurewebsites.net`
   - `JWT_SECRET`: Tu secreto JWT
   - `NODE_ENV`: `production`

### Configuración de CORS en Azure (Opcional)

Azure App Service también tiene una configuración de CORS en:
- App Service → API → CORS

**Recomendación**: Deja esta configuración vacía y usa la configuración en el código (más flexible).

### WebSockets en Azure

Asegúrate de que WebSockets estén habilitados:
- App Service → Configuration → General settings
- `Web sockets`: `On`
- `Always On`: `On` (recomendado)

## 5. Configuración Recomendada para Producción

### Backend (Azure App Service)

**Variables de entorno**:
```
CORS_ORIGIN=https://app-front-cortexagenthub-stg-001.azurewebsites.net
NODE_ENV=production
JWT_SECRET=<tu-secreto-seguro>
```

**Configuración de App Service**:
- Web sockets: `On`
- Always On: `On`

### Base de Datos (Widgets)

Para widgets públicos (cualquier origen puede usar el widget):
```sql
UPDATE widgets SET allowed_origins = NULL WHERE widget_key = 'tu-widget-key';
-- O
UPDATE widgets SET allowed_origins = '[]' WHERE widget_key = 'tu-widget-key';
```

Para widgets restringidos (solo ciertos orígenes):
```sql
UPDATE widgets 
SET allowed_origins = '["https://dominio-permitido.com"]'::jsonb 
WHERE widget_key = 'tu-widget-key';
```

## 6. Solución de Problemas

### Error: "Origin not allowed"

**Causa**: El origen de la solicitud no está en la lista de orígenes permitidos del widget.

**Solución**:
1. Verifica el valor de `allowed_origins` en la base de datos
2. Si está vacío o es `NULL`, debería permitir todos los orígenes
3. Si contiene `["*"]`, debería permitir todos los orígenes (pero el código actual no maneja esto - ver issue)

### Error: WebSocket se cierra con código 1006

**Causa**: Cierre anormal de la conexión. Puede ser:
- Error en el servidor
- Timeout de Azure
- Problema con la autenticación

**Solución**:
1. Revisa los logs de Azure para ver errores del servidor
2. Verifica que WebSockets estén habilitados en Azure
3. Verifica que `Always On` esté habilitado

### El widget no se carga

**Causa**: CORS bloqueando la solicitud de configuración del widget.

**Solución**:
1. Verifica `CORS_ORIGIN` en las variables de entorno
2. Verifica `allowed_origins` en la base de datos
3. Revisa la consola del navegador para ver el error específico

## 7. Flujo de Validación

```
1. Cliente solicita widget config
   GET /api/widgets/{key}/config
   Headers: Origin: https://cliente.com
   
2. AdminController valida:
   - Si allowed_origins está vacío → PERMITE
   - Si allowed_origins tiene valores → VALIDA contra la lista
   
3. Cliente se conecta al WebSocket
   wss://backend/api/v1/webchat/ws
   Headers: Origin: https://cliente.com
   
4. Fastify CORS valida el upgrade request
   - Usa CORS_ORIGIN para validar
   
5. WebSocket se establece
   - NO hay validación adicional de origen
   
6. Cliente envía token JWT
   - Servidor valida el token
   - Si es válido, autentica la conexión
```

## 8. Mejoras Futuras

1. **Manejar `["*"]` en allowed_origins**: Actualmente no se maneja correctamente
2. **Validación de origen en WebSocket**: Agregar validación opcional de origen en el handler de WebSocket
3. **Logging mejorado**: Agregar más logging para diagnosticar problemas de CORS

