# 🚀 Inicio Rápido: Configurar 360dialog en 5 Minutos

## Paso 1: Obtener Credenciales (2 minutos)

1. **Accede al Hub de 360dialog**: [hub.360dialog.com](https://hub.360dialog.com/)
2. **Selecciona tu número de WhatsApp Business**
3. **Copia estos 3 valores**:
   - ✅ **API Key** (D360-API-KEY): `D360-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - ✅ **Phone Number ID**: `123456789012345` (número largo)
   - ✅ **Phone Number**: `+593995906687` (tu número con código de país)

## Paso 2: Configurar en CortexAgentHub (2 minutos)

1. **Panel Admin** → **Channels** → **Nuevo Canal**
2. **Tipo**: `WhatsApp`
3. **Provider**: `360dialog`
4. **Completa los campos**:
   ```
   API Key (D360-API-KEY): [Pega tu API Key]
   Phone Number ID: [Pega tu Phone Number ID]
   Phone Number: [Pega tu número con +]
   Webhook URL: https://tu-dominio.com/webhooks/whatsapp
   Webhook Secret: [Opcional - token secreto]
   ```
5. **Guarda**

## Paso 3: Configurar Webhook en 360dialog (1 minuto)

1. **Hub de 360dialog** → Tu número → **Webhooks**
2. **Webhook URL**: `https://tu-dominio.com/webhooks/whatsapp`
3. **Verify Token**: (Opcional) El mismo que configuraste como `webhookSecret`
4. **Suscribir eventos**: ✅ messages, ✅ message_status
5. **Guardar** - 360dialog verificará automáticamente tu webhook

## ✅ Verificación

1. **Envía un mensaje de prueba** desde WhatsApp a tu número de negocio
2. **Verifica que llegue** en el panel de administración
3. **Revisa los logs** si hay problemas

## 🔧 Variables de Entorno (Opcional)

Si prefieres configurar por variables de entorno:

```bash
WHATSAPP_PROVIDER=360dialog
WHATSAPP_360DIALOG_API_KEY=D360-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_PHONE_NUMBER=+593995906687
WHATSAPP_WEBHOOK_URL=https://tu-dominio.com/webhooks/whatsapp
WHATSAPP_WEBHOOK_SECRET=tu-secret-opcional
```

## 📖 Documentación Completa

Para más detalles, consulta: [360dialog-setup.md](./360dialog-setup.md)

---

**¿Problemas?** Revisa los logs del servidor o consulta la documentación completa.

