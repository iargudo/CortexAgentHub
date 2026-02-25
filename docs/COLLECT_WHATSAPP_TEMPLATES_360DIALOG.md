# Guía de implementación: Cortex Collect ↔ AgentHub (WhatsApp)

Documento para el **desarrollador de Cortex Collect** que implementa el envío de mensajes por WhatsApp vía AgentHub. Incluye texto, imágenes/documentos y **plantillas aprobadas de Meta/360dialog** (para mensajes fuera de la ventana de 24h).

---

## 1. Endpoint y autenticación

- **URL:** `POST /api/v1/integrations/outbound/send`
- **Headers obligatorios:**
  - `x-api-key`: API key de la integración AgentHub.
- **Headers recomendados:**
  - `idempotency-key`: valor estable y único por “intento lógico” de envío (evita duplicados si se reintenta la petición).

Siempre se envía un **body JSON** con `channelType`, `userId`, `envelope` y, según el tipo de envío, **o** `message` (y opcionalmente media) **o** `template`. No se mezclan en la misma petición.

---

## 2. Dos modos de envío

| Modo | Cuándo usarlo | Qué enviar en el body |
|------|----------------|------------------------|
| **Texto o media** | Usuario te escribió en las últimas 24h. Quieres enviar texto y/o imagen/video/documento. | `message` (obligatorio si no hay media), y opcionalmente `mediaUrl` + `mediaType`. |
| **Plantilla WhatsApp (template)** | Usuario no ha escrito en 24h o quieres garantizar entrega con plantilla aprobada (fuera de 24h). | `template` con `name`, `language` y, si aplica, `body_params` y/o `header_image_url`. **No** enviar `message` ni `mediaUrl`. |

- **Texto/media:** puede salir por **UltraMsg o 360dialog** (AgentHub elige según flujo y balanceo).
- **Plantilla:** solo se envía por **360dialog**. Si el flujo tiene varios canales, AgentHub usa solo canales 360dialog para esa petición. Si no hay canal 360dialog, la petición falla con error claro.

---

## 3. Ventana de 24 horas (por qué a veces no llega el mensaje)

Con WhatsApp Business API (360dialog):

- **Dentro de 24h** (el usuario te escribió recientemente): se puede enviar **texto libre** e **imagen/video/documento** normal; WhatsApp los entrega.
- **Fuera de 24h:** el texto libre y la media normal son **aceptados** (200 OK) pero **no se entregan**. Solo se entregan mensajes que usan una **plantilla aprobada por Meta**.

Por tanto: para que un mensaje llegue cuando no hay conversación reciente, Collect debe usar el modo **template** con una plantilla aprobada en Meta/360dialog.

---

## 4. Contrato del API (campos del body)

### 4.1 Campos comunes (siempre)

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `channelType` | string | Sí | `"whatsapp"` |
| `userId` | string | Sí | Número del destinatario (ej. `"593995906687"`). AgentHub normaliza a solo dígitos. |
| `envelope` | object | Sí | Contexto de integración. Debe incluir `namespace`, `caseId` y, para usar flujo y balanceo, `routing.flowId`. Opcional: `routing.channelConfigId` para fijar canal. |

Estructura mínima de `envelope`:

```json
{
  "namespace": "cortexcollect",
  "caseId": "case-001",
  "routing": { "flowId": "ef35e53e-f940-4727-a74c-d972dc8c7c44" }
}
```

### 4.2 Modo texto o media

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `message` | string | Sí* | Texto del mensaje o caption si hay media. *Obligatorio si no se envía `mediaUrl`. |
| `mediaUrl` | string | No | URL pública del archivo (imagen, video o documento). |
| `mediaType` | string | Si hay `mediaUrl` | Uno de: `"image"`, `"video"`, `"document"`. |
| `conversationMetadata` | object | No | Metadatos adicionales de la conversación. |

Reglas:

- Si no hay `mediaUrl`: `message` es obligatorio.
- Si hay `mediaUrl`: `mediaType` es obligatorio; `message` es opcional (caption).

No enviar `template` en este modo.

### 4.3 Modo plantilla (template)

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `template` | object | Sí | Ver tabla siguiente. |
| `template.name` | string | Sí | Nombre **exacto** de la plantilla en Meta/360dialog (ej. `"notificacion_caso"`). |
| `template.language` | string | Sí | Código de idioma (ej. `"es"`, `"en"`). |
| `template.body_params` | array of string | No | Valores para {{1}}, {{2}}, … en el **mismo orden** que en la plantilla. Si la plantilla no tiene variables en el body, omitir o `[]`. |
| `template.header_image_url` | string | No | URL pública de la imagen del **header**. Solo si la plantilla aprobada tiene header de tipo IMAGE. |

No enviar `message`, `mediaUrl` ni `mediaType` en este modo.

Importante sobre plantillas:

- La API de Meta **no** acepta el “texto ya armado”. Exige **nombre** de plantilla + **idioma** + **parámetros** (valores para {{1}}, {{2}}, …). Collect debe enviar esos valores en orden en `body_params`.
- Para plantillas con **imagen en el header** (Media Message Template), usar `header_image_url`. La URL debe ser accesible por 360dialog/Meta.

---

## 5. Canales: UltraMsg vs 360dialog

Un flujo en AgentHub puede tener **varios canales WhatsApp** (por ejemplo UltraMsg y 360dialog). AgentHub aplica stickiness por conversación y round-robin.

- **Envío texto/media:** el canal puede ser UltraMsg o 360dialog (el que corresponda). **Ambos** pueden enviar texto e imagen/video/documento.
- **Envío plantilla:** las plantillas de Meta **solo las soporta 360dialog** en AgentHub. AgentHub **elige automáticamente** un canal 360dialog del flujo para esa petición. Si el flujo no tiene ningún canal 360dialog, la petición falla con un error explícito (añadir canal 360dialog al flujo o indicar uno con `envelope.routing.channelConfigId`).

Collect no tiene que decidir el canal; solo debe enviar el body correcto (texto/media o template).

---

## 6. Ejemplos de body

### 6.1 Solo texto

```json
{
  "channelType": "whatsapp",
  "userId": "593995906687",
  "message": "Hola, tu caso está en progreso.",
  "envelope": {
    "namespace": "cortexcollect",
    "caseId": "case-001",
    "routing": { "flowId": "ef35e53e-f940-4727-a74c-d972dc8c7c44" }
  }
}
```

### 6.2 Texto + imagen (mensaje con imagen; no es plantilla)

```json
{
  "channelType": "whatsapp",
  "userId": "593995906687",
  "message": "Adjunto el comprobante.",
  "mediaUrl": "https://ejemplo.com/comprobante.jpg",
  "mediaType": "image",
  "envelope": {
    "namespace": "cortexcollect",
    "caseId": "case-001",
    "routing": { "flowId": "ef35e53e-f940-4727-a74c-d972dc8c7c44" }
  }
}
```

Solo se entrega dentro de la ventana de 24h. Puede salir por UltraMsg o 360dialog.

### 6.3 Plantilla solo texto (sin variables en el body)

```json
{
  "channelType": "whatsapp",
  "userId": "593995906687",
  "template": {
    "name": "hello_world",
    "language": "es"
  },
  "envelope": {
    "namespace": "cortexcollect",
    "caseId": "case-001",
    "routing": { "flowId": "ef35e53e-f940-4727-a74c-d972dc8c7c44" }
  }
}
```

### 6.4 Plantilla con variables en el body ({{1}}, {{2}})

Ejemplo de plantilla en Meta: *“Hola {{1}}, tu caso {{2}} está en progreso.”*

```json
{
  "channelType": "whatsapp",
  "userId": "593995906687",
  "template": {
    "name": "notificacion_caso",
    "language": "es",
    "body_params": ["Juan", "12345"]
  },
  "envelope": {
    "namespace": "cortexcollect",
    "caseId": "case-001",
    "routing": { "flowId": "ef35e53e-f940-4727-a74c-d972dc8c7c44" }
  }
}
```

`body_params[0]` sustituye {{1}}, `body_params[1]` sustituye {{2}}, etc.

### 6.5 Plantilla con imagen en el header (Media Message Template)

Si la plantilla aprobada en Meta tiene un header de tipo IMAGE:

```json
{
  "channelType": "whatsapp",
  "userId": "593995906687",
  "template": {
    "name": "notificacion_con_imagen",
    "language": "es",
    "header_image_url": "https://ejemplo.com/imagen.jpg",
    "body_params": ["Juan", "12345"]
  },
  "envelope": {
    "namespace": "cortexcollect",
    "caseId": "case-001",
    "routing": { "flowId": "ef35e53e-f940-4727-a74c-d972dc8c7c44" }
  }
}
```

La URL debe ser accesible públicamente por 360dialog/Meta.

---

## 7. Qué implementar en Collect

Toda la configuración descrita en esta sección debe poder definirse **en el frontend (UI) de Collect**: al crear o editar una acción, plantilla o envío por WhatsApp, el usuario/administrador debe poder elegir el tipo de envío y rellenar los campos correspondientes sin tocar código.

### 7.1 Modelo de datos / configuración en el frontend (UI de Collect)

En la pantalla de configuración de la acción o plantilla (por ejemplo “Editar acción” o “Configurar envío WhatsApp”), debe ser posible configurar:

- **Tipo de envío:** “texto/media” o “plantilla WhatsApp” (selector en el frontend).
- **Para texto/media:**
  - Contenido del mensaje (y opcionalmente URL y tipo de media: imagen, video, documento).
- **Para plantilla:**
  - Nombre de la plantilla en Meta/360dialog (campo de texto).
  - Idioma de la plantilla (selector o texto, ej. `es`, `en`).
  - Mapeo de variables de Collect a posiciones {{1}}, {{2}}, … (orden fijo para `body_params`), por ejemplo listando “Variable 1 → {{1}}”, “Variable 2 → {{2}}” o eligiendo qué dato del caso va en cada posición.
  - Opcional: si la plantilla tiene header IMAGE, campo para la URL de la imagen (o indicar que se tomará de un dato dinámico del caso).

Todo lo anterior se configura **en un único frontend** (el de Collect); no hace falta configurar nada en AgentHub para estos valores (en AgentHub solo se configuran flujos, canales y la API key de integración).

### 7.2 Cuándo usar cada modo

- **Texto/media:** cuando el usuario ha escrito en las últimas 24h o cuando aceptáis que el mensaje solo se entregue dentro de 24h.
- **Plantilla:** cuando el usuario no ha escrito en 24h o es el primer mensaje del negocio y queréis garantizar entrega (fuera de 24h). Requiere plantilla aprobada en Meta/360dialog.

Podéis:
- Definir una regla (ej. “si último mensaje del usuario > 24h → usar plantilla X”), o
- Dejar que en la acción se configure “siempre plantilla” y enviar siempre `template` para esa acción.

### 7.3 Construcción del body de la petición

1. **Texto/media:**  
   Incluir `channelType`, `userId`, `envelope`.  
   - Si hay media: `message` (opcional como caption), `mediaUrl`, `mediaType`.  
   - Si no hay media: `message` obligatorio.  
   No incluir `template`.

2. **Plantilla:**  
   Incluir `channelType`, `userId`, `envelope`, `template` con:
   - `name`, `language`;
   - `body_params`: array de valores en el mismo orden que {{1}}, {{2}}, … (si la plantilla tiene variables);
   - `header_image_url` solo si la plantilla tiene header IMAGE.  
   No incluir `message`, `mediaUrl` ni `mediaType`.

### 7.4 Idempotencia

En cada petición de envío, enviar un `idempotency-key` estable y único por “intento lógico” (por ejemplo por caso + tipo de notificación + timestamp de decisión). Así, si Collect reintenta la petición, AgentHub no enviará el mensaje dos veces.

### 7.5 Errores que puede devolver AgentHub (y 360dialog/Meta)

Si la plantilla en Meta tiene un **header de tipo IMAGE** y no se envía `template.header_image_url`, Meta devuelve **400** con un error del estilo: *"Parameter format does not match format in the created template"* y detalle *"header: Format mismatch, expected IMAGE, received UNKNOWN"*. En ese caso hay que incluir en el body **`template.header_image_url`** con una URL pública de la imagen. AgentHub devolverá un mensaje que indica que la plantilla requiere imagen de header.

### 7.6 Errores que puede devolver AgentHub (resto)

- **400** – Validación: falta `message` o `template` según el modo; `mediaUrl` sin `mediaType`; `template` sin `name`/`language`; etc.
- **400** – “Template messages require a 360dialog channel…”: se envió `template` pero el flujo no tiene canal 360dialog (o el canal indicado con `channelConfigId` no es 360dialog). Solución: añadir un canal 360dialog al flujo o indicar uno válido.
- **501** – “Outbound sending for channelType='…' is not implemented”: otro tipo de canal no soportado aún.

Recoger el código y el cuerpo de la respuesta para mostrar o registrar el error en Collect.

### 7.7 Prerrequisitos en Meta/360dialog

- Las plantillas deben estar **creadas y aprobadas** en Meta/360dialog para el número/cuenta que usa el flujo en AgentHub.
- El **nombre** y el **idioma** que Collect envía deben coincidir **exactamente** con los de la plantilla aprobada.
- Si la plantilla tiene header IMAGE, la URL que enviéis en `header_image_url` debe ser accesible por 360dialog/Meta.

---

## 8. Resumen rápido

| Necesidad | Modo | Campos clave |
|-----------|------|--------------|
| Enviar texto (dentro de 24h) | Texto | `message`, `envelope` |
| Enviar imagen/video/documento (dentro de 24h) | Media | `message` (opcional), `mediaUrl`, `mediaType`, `envelope` |
| Enviar mensaje fuera de 24h | Plantilla | `template`: `name`, `language`, y si aplica `body_params`, `header_image_url`; `envelope` |

- **Texto/media:** puede usar canal UltraMsg o 360dialog. Solo se entrega dentro de 24h.
- **Plantilla:** solo 360dialog. Se entrega también fuera de 24h. Collect envía nombre + idioma + parámetros (y opcionalmente URL de imagen de header), no el texto final armado.

Con esta guía se puede implementar en Collect todo lo necesario para enviar por WhatsApp vía AgentHub: texto, media y plantillas (incluidas con imagen en el header). La configuración (tipo de envío, plantilla, nombre, idioma, variables, etc.) se hace **en un único frontend**, el de Cortex Collect; AgentHub no expone UI para estos parámetros, solo recibe la petición del API.
