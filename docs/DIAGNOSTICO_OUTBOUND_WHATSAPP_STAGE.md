# Diagnóstico: Campañas CortexCollect no se despachan por WhatsApp en Stage

Caso: número **593995906687**. Las campañas llegan desde CortexCollect pero el mensaje no se envía por WhatsApp al cliente.

---

## 0. Cómo ver los logs de Azure (Stage)

Configuración de stage (desde `deploy-docker-stg.sh`):

- **Backend:** `app-back-cortexagenthub-stg-001`
- **Resource group:** `rg-cortexagenthub-stg-001`

**Descargar logs (recomendado):**

```bash
az webapp log download --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001 --log-file cortex-backend-logs.zip
unzip -o cortex-backend-logs.zip -d cortex-backend-logs
```

Los logs de la **aplicación Node (stdout/stderr)** están en:

- `LogFiles/2026_MM_DD_*_default_docker.log` (cambia la fecha)

Ahí aparecen los mensajes de `[IntegrationsController]`, `[QueueManager]`, `[WhatsAppSendingWorker]`, etc.

**Stream en vivo (últimos logs):**

```bash
az webapp log tail --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001
```

**Filtrar por WhatsApp/outbound/cola:**

```bash
az webapp log tail --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001 2>&1 | grep -iE 'whatsapp|webhook|queue|worker|outbound|593995906687'
```

**Configuración actual de logging:** `applicationLogs.fileSystem.level = Verbose`; los logs del contenedor Docker se capturan en los archivos `*_default_docker.log`.

---

## 1. Flujo del outbound (resumen)

1. **CortexCollect** llama `POST /api/v1/integrations/outbound/send` con `channelType: whatsapp`, `userId: "593995906687"` (o similar), `message`, `envelope: { namespace, caseId, routing? }`.
2. **IntegrationsController.sendOutbound** (`integrations.controller.ts`):
   - Normaliza `userId` a solo dígitos: `593995906687`.
   - Upsert conversación (crea/actualiza con `flow_id` si viene en `envelope.routing.flowId`).
   - Obtiene **channelConfig**: primero por `envelope.routing.channelConfigId`, luego por `metadata.channel_config_id` de la conversación, luego **cualquier canal WhatsApp activo** en BD.
   - Si no hay canal WhatsApp activo → lanza `CONFIG_NOT_FOUND` (400).
   - **Encola** el mensaje en Redis: cola `WHATSAPP_SENDING`, job `outbound-integration-message`.
   - Persiste el mensaje en `messages` (asistant, outbound) y responde 200.
3. **WhatsAppSendingWorker** (mismo proceso API en stage):
   - Consume jobs de la cola `WHATSAPP_SENDING`.
   - Construye `WhatsAppAdapter` con `channelConfig` del job (provider, instanceId, token, etc.).
   - Llama `whatsappAdapter.sendMessage(userId, message, config)`.
4. **WhatsAppAdapter** (Ultramsg):
   - Formato destino: `userId` solo dígitos → `593995906687@c.us`.
   - POST a Ultramsg con `to`, `body`, `token`.

Si el mensaje **nunca llega** al cliente, el fallo puede estar en: (A) no encolar, (B) no procesar el job, (C) fallar el envío a Ultramsg.

---

## 2. Puntos de fallo y cómo verificarlos en Stage

### 2.1 ¿La petición outbound llega y responde 200?

- **Qué revisar:** Logs del backend en Azure (App Service `app-back-cortexagenthub-stg-001`).
- **Buscar:** `Integration outbound queued (pre-enqueue)` con `userId: 593995906687` (o `normalizedUserId`).
- **Si aparece:** La API recibió el outbound, eligió canal y encoló. El problema está en Redis/Worker o en Ultramsg.
- **Si no aparece:** CortexCollect no está llamando al endpoint correcto de stage, o el request falla antes (validación, auth, 501 si channel no whatsapp).

**Verificar URL de stage** que usa CortexCollect: debe ser la base URL del backend de stage (ej. `https://app-back-cortexagenthub-stg-001.azurewebsites.net` o el que tenga el deploy) y la ruta `POST /api/v1/integrations/outbound/send`.

---

### 2.2 ¿Hay canal WhatsApp activo en la base de datos?

- **Código:** `getWhatsAppChannelConfig()` devuelve un canal con `channel_type = 'whatsapp'` y `(is_active = true OR active = true)`. Si no hay ninguno, lanza `CONFIG_NOT_FOUND` y **no se encola**.
- **Qué revisar en stage:** En la BD de stage:
  ```sql
  SELECT id, name, channel_type, is_active, active, config->>'instanceId', config->>'provider'
  FROM channel_configs
  WHERE channel_type = 'whatsapp';
  ```
- Debe haber al menos una fila con `is_active = true` (o `active = true`). Si no, las campañas fallan en el controller antes de encolar.

---

### 2.3 Redis (cola) en Stage

- **Código:** La cola usa `REDIS_URL`. En `deploy-docker-stg.sh` se configura `REDIS_URL=rediss://:$REDIS_PASSWORD@$REDIS_HOST:$REDIS_SSL_PORT` (Azure Redis con SSL).
- **Qué puede fallar:**
  - Si Redis no es accesible desde el contenedor, `getQueueManager()` o `addJob()` puede fallar y la API podría devolver 500 (o el error se traga y no se encola).
  - Si el worker no puede conectar a Redis, no procesa jobs: los jobs se quedan en la cola y nunca se envían.
- **Qué revisar:**
  - Logs del backend al arrancar: `BullMQ: Redis connection established` / `Queue workers started successfully`.
  - Logs de error: `BullMQ: Redis connection error`, `Failed to start queue workers`.
  - En Azure: que la App Service tenga la misma `REDIS_URL` que el script (variables de la webapp).

---

### 2.4 Worker WhatsApp Sending en ejecución

- **Código:** `WorkerManager` en `server.ts` arranca `WhatsAppSendingWorker(5)`. Si `startAll()` falla, no hay nadie consumiendo la cola.
- **Qué revisar en logs:** `Queue workers started successfully` y `Started 5 workers` (incluye WhatsAppSendingWorker). Si ves `Failed to start queue workers`, los jobs se encolan pero no se procesan.

---

### 2.5 Formato del número (593995906687)

- **Código:** `normalizePhoneUserId(userId)` deja solo dígitos → `593995906687`. Ultramsg espera `593995906687@c.us`. El adapter añade `@c.us` si no está. Para Ecuador (593) el número sin `+` y solo dígitos es correcto.
- **Posible problema:** Si CortexCollect envía el número con otro formato (ej. `+593 99 590 6687` o con espacios), se normaliza a dígitos; verificar en logs que el `userId` que se encola y el que usa el worker sea `593995906687`. Si Ultramsg rechaza por número inválido, el fallo aparecerá en el worker (ver 2.6).

---

### 2.6 Fallo al enviar (Ultramsg / token / instance)

- **Código:** El job lleva `channelConfig` desde la BD (o el primer canal activo). El worker construye `WhatsAppConfig` con `instanceId`, `apiToken` (token o apiToken), etc., e inicializa el adapter y llama `sendMessage`.
- **Qué puede fallar:**
  - **Token o instance incorrectos** en el canal de stage: el config en BD puede ser de otro entorno (dev/prod) y esa instancia no tiene el número registrado o el token es inválido.
  - **Instancia Ultramsg detenida o inactiva:** el adapter puede loguear que la instancia está stopped/inactive.
  - **Número no permitido / no opt-in:** políticas de WhatsApp/Ultramsg pueden rechazar el envío.
- **Qué revisar en logs:** Buscar por `userId` o `593995906687`:
  - `Processing WhatsApp message` (worker tomó el job).
  - `WhatsApp message sent successfully` → envío OK.
  - `WhatsApp message sending failed`, `Failed to send WhatsApp message`, `UltrMsg instance ... is stopped or inactive` → error en envío (revisar token, instance, número).

---

### 2.7 Idempotencia (no aplica si el mensaje nunca se envió)

- Si CortexCollect envía con `Idempotency-Key` y ese mensaje ya fue “enviado” (registrado en `messages` con ese idempotencyKey), la API responde 200 pero **no encola de nuevo**. Revisar en BD si existe un mensaje assistant con `metadata->>'idempotencyKey'` igual al que envía CortexCollect para esa conversación. Si por error se marcó como enviado sin que el worker hubiera enviado, ver 2.3 / 2.4.

---

## 3. Checklist rápido Stage (número 593995906687)

1. **Logs backend stage** al recibir outbound:
   - Buscar `Integration outbound queued (pre-enqueue)` con userId 593995906687.
2. **BD stage:** Al menos un `channel_config` WhatsApp activo y con `config` (instanceId, token) correcto para Ultramsg.
3. **Redis stage:** `REDIS_URL` correcta en la App; logs sin errores de conexión BullMQ/Redis.
4. **Workers:** Logs de arranque con `Queue workers started successfully` y sin `Failed to start queue workers`.
5. **Logs del worker:** Para 593995906687 buscar `Processing WhatsApp message` y luego `WhatsApp message sent successfully` o el mensaje de error (token, instance, número).
6. **CortexCollect:** URL de stage correcta, body con `channelType: whatsapp`, `userId: "593995906687"` (o formato que normalice a ese número), `message` y `envelope` con `namespace` y `caseId`.

---

## 4. Referencia de código

| Paso | Archivo | Función / detalle |
|-----|---------|-------------------|
| Entrada outbound | `backend/api-service/src/controllers/integrations.controller.ts` | `sendOutbound()` |
| Normalización teléfono | `integrations.controller.ts` | `normalizePhoneUserId()` → solo dígitos |
| Canal WhatsApp | `integrations.controller.ts` | `getWhatsAppChannelConfig()` |
| Encolar | `integrations.controller.ts` | `enqueueWhatsAppOutbound()` → `QueueName.WHATSAPP_SENDING` |
| Procesar job | `backend/packages/queue-service/src/workers/WhatsAppSendingWorker.ts` | `process()` → adapter.sendMessage |
| Envío Ultramsg | `backend/packages/channel-adapters/src/whatsapp/WhatsAppAdapter.ts` | `sendViaUltramsg()` → formato `userId@c.us` |
| Redis/Cola | `backend/packages/queue-service/src/connection.ts`, `queues/QueueManager.ts` | `REDIS_URL`, BullMQ |
| Arranque workers | `backend/api-service/src/server.ts` | `WorkerManager.startAll()` |

Con esto se puede seguir el flujo en stage y localizar en qué paso se corta para el 593995906687.

---

## 5. Resultado del análisis de logs (2026-02-03)

Se descargaron los logs de Azure (`az webapp log download`) y se revisó `LogFiles/2026_02_03_*_default_docker.log`.

**Para el número 593995906687** en ese día aparece **un envío que el backend considera exitoso**:

- `20:21:51` – `[IntegrationsController] Integration outbound queued (pre-enqueue)` con `userId: "593995906687"`, `conversationId: 3d8b5525-96fb-4262-a812-8c01bc60ab57`, `caseId: b6037152-185d-4ad7-9c20-8b08ea5f2c8c`, `provider: ultramsg`, `mediaType: image`.
- `20:21:51` – `[QueueManager] Job added to whatsapp-sending` → `outbound-integration-message-1770150111905`.
- `20:21:51` – `[BaseWorker] Processing job` y `[WhatsAppSendingWorker] Processing WhatsApp message` para `593995906687`.
- `20:21:51` – `[WhatsAppSendingWorker] Sending WhatsApp media message` (image + caption).
- `20:21:53` – `[WhatsAppSendingWorker] WhatsApp message sent successfully` y `[BaseWorker] Job completed`.

**Conclusión:** En estos logs, la campaña para **593995906687** fue encolada, procesada por el worker y registrada como **enviada correctamente** por nuestra API. Si el cliente no recibió el mensaje en WhatsApp, las causas probables están **fuera del backend** (p. ej. entrega en Ultramsg/WhatsApp, número incorrecto en destino, restricciones de WhatsApp, o dispositivo/cliente). Para otras campañas o otros números, repetir el mismo flujo de descarga de logs y búsqueda por `userId` / `caseId` en el archivo `*_default_docker.log`.

---

## 6. Si en ningún caso llegan los mensajes al cliente

**Hallazgo:** Las campañas CortexCollect envían **imagen + caption** (media). El método `sendMedia()` del adapter WhatsApp **no validaba la respuesta de Ultramsg**: se hacía el POST y se asumía éxito. Ultramsg puede devolver HTTP 200 con `{ "error": "..." }` en el body (ej. número no registrado en WhatsApp, instancia inactiva, etc.) y nosotros registrábamos "sent successfully" sin comprobar.

**Cambio aplicado:** En `WhatsAppAdapter.ts` (sendMedia para Ultramsg) se añadió validación de la respuesta:
- Si `response.data.error` → se registra el error y se lanza excepción (el job falla y puede reintentar).
- Si `response.data.sent === true` o `response.data.id` → se registra "Message sent successfully via UltrMsg" con `messageId`.
- Si la respuesta no trae ni error ni sent/id → se registra **warn** "UltrMsg media response unclear (delivery may have failed)" con `responseData` para diagnóstico.

**Después del próximo deploy en stage:**
1. Revisar logs: si aparece **"UltrMsg API returned error for media send"** con el mensaje de Ultramsg, ese es el motivo (número inválido, instancia parada, etc.).
2. Si aparece **"UltrMsg media response unclear"**, revisar el `responseData` en log; puede que Ultramsg use otro formato y haya que ajustar la validación.
3. En el **dashboard de Ultramsg** comprobar el estado de la instancia y si el número 593995906687 está permitido / tiene historial de envíos/entregas.

---

## 7. Causa raíz confirmada: URL de imagen inválida desde Collect

**Hallazgo:** La URL de la imagen que enviaba **CortexCollect** **no existía** (inválida, 404 o inaccesible). Ultramsg recibe la petición con esa URL, pero al no poder descargar la imagen el mensaje no se entrega al usuario en WhatsApp; nuestro backend igual registraba "sent successfully" porque no validábamos la respuesta.

**Comprobación:** Sin desplegar la solución del punto 6, al enviar desde Collect con una **URL que sí servía la imagen**, los mensajes **empezaron a llegar** a los usuarios en WhatsApp.

**Conclusión:** La causa raíz fue **URL de media inválida en el payload de Collect**, no fallo de canal ni de instancia Ultramsg. Conviene que Collect valide o compruebe que `mediaUrl` sea accesible antes de llamar al outbound. La validación de respuesta de Ultramsg en `sendMedia()` (punto 6) sigue siendo útil: si en el futuro Ultramsg devuelve un error explícito por URL inválida, lo veremos en logs y el job fallará en lugar de marcarse como exitoso.
