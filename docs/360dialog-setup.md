# Guía de Configuración de 360dialog para WhatsApp Business API

Esta guía te ayudará a configurar 360dialog como proveedor de WhatsApp en CortexAgentHub usando la **API oficial de WhatsApp Business Cloud API v1**.

## 📌 Versión de API

Esta implementación utiliza la **última versión de la API de 360dialog** basada en WhatsApp Business Cloud API:
- **Endpoint Base**: `https://waba-api.360dialog.io/v1`
- **Autenticación**: Header `D360-API-KEY`
- **Formato**: JSON (WhatsApp Business API estándar)

## 📋 Requisitos Previos

1. **Cuenta de 360dialog**: Regístrate en [360dialog.com](https://www.360dialog.com/es/)
2. **Cuenta de Meta Business**: Debes tener una cuenta de empresa verificada en Meta (Facebook)
3. **Número de teléfono**: Un número de teléfono que no esté asociado a otra cuenta de WhatsApp
4. **Acceso al número**: Debes poder recibir SMS o llamadas para verificación

## 🔑 Paso 1: Obtener Credenciales de 360dialog

### 1.1 Acceder al Hub de 360dialog

1. Inicia sesión en tu cuenta de [360dialog Hub](https://hub.360dialog.com/)
2. Navega a la sección de **"Numbers"** o **"Números"**

### 1.2 Obtener API Key (D360-API-KEY)

1. Selecciona tu número de WhatsApp Business
2. En la configuración del número, encontrarás la **API Key** (formato: `D360-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
3. **Copia esta clave** - la necesitarás para configurar el canal

### 1.3 Obtener Phone Number ID

1. En la misma página del número, encontrarás el **Phone Number ID**
2. Este ID identifica tu número de WhatsApp Business en la API
3. **Copia este ID** - es requerido para enviar mensajes
4. **Formato**: Generalmente es un número largo (ej: `123456789012345`)
5. **Nota**: Este ID es diferente del número de teléfono - es un identificador único de la API

### 1.4 Obtener WhatsApp Business Account ID (Opcional)

1. En el Hub, también puedes encontrar el **WABA ID** (WhatsApp Business Account ID)
2. Este campo es opcional pero útil si manejas múltiples cuentas
3. **Copia este ID** si lo necesitas

## 🔧 Paso 2: Configurar el Canal en CortexAgentHub

### 2.1 Crear Nuevo Canal

1. Accede al panel de administración de CortexAgentHub
2. Ve a **"Channels"** o **"Canales"**
3. Haz clic en **"Nuevo Canal"** o **"Create Channel"**

### 2.2 Configurar Canal WhatsApp

1. **Tipo de Canal**: Selecciona `WhatsApp`
2. **Provider**: Selecciona `360dialog`
3. **Nombre**: Asigna un nombre descriptivo (ej: "WhatsApp Business - Ventas")

### 2.3 Completar Campos de Configuración

Completa los siguientes campos:

#### Campos Requeridos:

- **API Key (D360-API-KEY)**: 
  - Pega la API Key que copiaste del Hub de 360dialog
  - Formato: `D360-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

- **Phone Number ID**: 
  - Pega el Phone Number ID de tu número de WhatsApp Business
  - Este ID identifica tu número en la API de 360dialog

- **Phone Number**: 
  - Ingresa tu número de teléfono completo con código de país
  - Formato: `+593995906687` (incluye el `+` y código de país)

#### Campos Opcionales:

- **WhatsApp Business Account ID (WABA ID)**: 
  - Solo si manejas múltiples cuentas de WhatsApp Business
  - Útil para identificar la cuenta específica

- **Webhook URL**: 
  - URL donde recibirás los mensajes entrantes
  - Formato: `https://tu-dominio.com/webhooks/whatsapp`
  - **Importante**: Esta URL debe ser accesible públicamente

- **Webhook Secret**: 
  - (Opcional) Token secreto para verificar que los webhooks vienen de 360dialog
  - Recomendado para producción

### 2.4 Guardar Configuración

1. Haz clic en **"Guardar"** o **"Save"**
2. El sistema validará la configuración
3. Si hay errores, revisa los campos y vuelve a intentar

## 🌐 Paso 3: Configurar Webhook en 360dialog

### 3.1 Acceder a Configuración de Webhook

1. En el Hub de 360dialog, ve a la configuración de tu número
2. Busca la sección **"Webhooks"** o **"Webhooks Configuration"**

### 3.2 Configurar URL del Webhook

1. **Webhook URL**: Ingresa la URL de tu servidor:
   ```
   https://tu-dominio.com/webhooks/whatsapp
   ```
   O para desarrollo local usando un túnel (ngrok, localtunnel, etc.):
   ```
   https://tu-tunel.ngrok.io/webhooks/whatsapp
   ```

2. **Verify Token** (Opcional): 
   - Si configuraste un `webhookSecret` en CortexAgentHub, úsalo aquí
   - Esto asegura que solo 360dialog pueda enviar webhooks a tu servidor

### 3.3 Eventos a Suscribir

Asegúrate de suscribirte a los siguientes eventos:

- ✅ **messages** - Mensajes entrantes
- ✅ **message_status** - Estados de mensajes (entregado, leído, etc.)

### 3.4 Verificar Webhook

1. 360dialog intentará verificar tu webhook enviando una solicitud GET
2. Tu servidor debe responder correctamente a esta verificación
3. Si la verificación falla, revisa:
   - Que la URL sea accesible públicamente
   - Que tu servidor esté corriendo
   - Que no haya problemas de firewall

## ✅ Paso 4: Verificar Configuración

### 4.1 Probar Envío de Mensaje

1. En el panel de administración, ve a **"Conversations"** o **"Conversaciones"**
2. Selecciona una conversación o crea una nueva
3. Envía un mensaje de prueba
4. Verifica que el mensaje se envíe correctamente

### 4.2 Probar Recepción de Mensajes

1. Envía un mensaje de WhatsApp a tu número de negocio
2. Verifica que el mensaje aparezca en el panel de administración
3. Verifica que el sistema responda correctamente

### 4.3 Revisar Logs

Si hay problemas, revisa los logs del servidor:

```bash
# Ver logs del API service
tail -f logs/api-service.log

# Buscar errores relacionados con 360dialog
grep -i "360dialog" logs/api-service.log
```

## 🔍 Solución de Problemas

### Error: "phoneNumberId is required for 360dialog provider"

**Solución**: Asegúrate de haber ingresado el **Phone Number ID** en la configuración del canal.

### Error: "360dialog API error: Invalid API key"

**Solución**: 
- Verifica que la API Key sea correcta
- Asegúrate de copiar la API Key completa sin espacios
- Verifica que la API Key corresponda al número correcto

### Error: "Webhook not receiving messages"

**Solución**:
1. Verifica que la URL del webhook sea accesible públicamente
2. Usa herramientas como [ngrok](https://ngrok.com/) para desarrollo local
3. Verifica que el endpoint `/webhooks/whatsapp` esté configurado correctamente
4. Revisa los logs del servidor para ver si los webhooks están llegando

### Error: "Message not sending"

**Solución**:
1. Verifica que el número de teléfono esté en formato correcto (con código de país)
2. Verifica que el Phone Number ID sea correcto
3. Revisa los logs para ver el error específico de la API
4. Verifica que tu cuenta de 360dialog esté activa y tenga créditos

### Error: "Rate limit exceeded"

**Solución**:
- 360dialog tiene límites de rate según tu plan
- Plan Regular: límites estándar
- Plan Premium: límites más altos
- Plan High Throughput: hasta 1000 mensajes/segundo
- Considera actualizar tu plan si necesitas más capacidad

## 📚 Recursos Adicionales

- **Documentación oficial de 360dialog**: [docs.360dialog.com](https://docs.360dialog.com/)
- **API Reference**: [docs.360dialog.com/partner/api-reference](https://docs.360dialog.com/partner/api-reference)
- **Soporte 24/7**: Disponible en el Hub de 360dialog

## 🔐 Seguridad

### Mejores Prácticas:

1. **Nunca compartas tu API Key públicamente**
2. **Usa webhookSecret en producción** para verificar que los webhooks vengan de 360dialog
3. **Mantén tu API Key segura** - si se compromete, regenera una nueva en el Hub
4. **Usa HTTPS** para todos los webhooks en producción
5. **Implementa rate limiting** en tu servidor para prevenir abusos

## 📊 Monitoreo

### Métricas a Monitorear:

1. **Tasa de éxito de envío**: Porcentaje de mensajes enviados exitosamente
2. **Tiempo de respuesta**: Tiempo que tarda en enviar un mensaje
3. **Errores de API**: Errores retornados por la API de 360dialog
4. **Webhooks recibidos**: Cantidad de webhooks recibidos vs esperados

### Logs Importantes:

- Mensajes enviados exitosamente
- Errores de API con detalles
- Webhooks recibidos y procesados
- Errores de validación

## 🎯 Próximos Pasos

Una vez configurado 360dialog:

1. **Configura tus flujos de orquestación** para usar este canal
2. **Prueba diferentes tipos de mensajes**: texto, imágenes, videos
3. **Configura respuestas automáticas** usando los agentes de IA
4. **Monitorea el rendimiento** y ajusta según sea necesario

## 💡 Notas Importantes

- **360dialog usa la API oficial de WhatsApp Business**: Esto garantiza cumplimiento y confiabilidad
- **Cada número tiene su propia API Key**: Si tienes múltiples números, configura un canal por cada uno
- **Los mensajes tienen costos**: Además de la suscripción mensual, cada mensaje tiene un costo según las tarifas de WhatsApp
- **Ventana de 24 horas**: Puedes responder mensajes de usuarios dentro de las 24 horas sin costo adicional (mensajes de sesión)
- **Plantillas para mensajes fuera de ventana**: Para mensajes después de 24 horas, debes usar plantillas aprobadas por Meta

---

**¿Necesitas ayuda?** Revisa los logs del servidor o contacta al soporte de 360dialog.

