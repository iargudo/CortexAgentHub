# 📖 Documentación Funcional - CortexAgentHub

**Versión:** 1.1.0  
**Última actualización:** Enero 2026  
**Audiencia:** Usuarios finales, administradores, stakeholders

---

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Características Principales](#características-principales)
3. [Casos de Uso](#casos-de-uso)
4. [Flujos de Usuario](#flujos-de-usuario)
5. [Módulos Funcionales](#módulos-funcionales)
6. [Configuración de Agentes](#configuración-de-agentes)
7. [Sistema de Tools](#sistema-de-tools)
8. [Knowledge Bases (RAG)](#knowledge-bases-rag)
9. [Analytics y Reportes](#analytics-y-reportes)
10. [Widgets WebChat](#widgets-webchat)
11. [Casos de Uso por Industria](#casos-de-uso-por-industria)

---

## 🎯 Visión General

**CortexAgentHub** es una plataforma de automatización de atención al cliente mediante inteligencia artificial que permite a las empresas crear agentes virtuales inteligentes capaces de atender múltiples canales de comunicación simultáneamente.

### Propósito del Sistema

El sistema permite:
- **Automatizar** respuestas a consultas frecuentes
- **Escalar** atención al cliente sin aumentar personal
- **Integrar** con sistemas existentes (CRM, ERP, bases de datos)
- **Personalizar** comportamiento de agentes según necesidades
- **Monitorear** métricas y rendimiento en tiempo real

### Usuarios del Sistema

1. **Administradores** - Configuran y gestionan el sistema completo
2. **Desarrolladores** - Crean tools personalizadas e integraciones
3. **Supervisores** - Monitorean conversaciones y métricas
4. **Clientes Finales** - Interactúan con los agentes a través de canales

---

## 🌟 Características Principales

### 1. Multi-Canal

El sistema soporta múltiples canales de comunicación:

- **WhatsApp** - Integración con UltraMsg, Twilio y 360Dialog
- **Telegram** - Bot API completo
- **WebChat** - Widget embebible en sitios web
- **Email** - SMTP/IMAP para correo electrónico

**Ventaja:** Un mismo agente puede atender todos los canales simultáneamente.

### 2. Multi-LLM

Soporte para múltiples proveedores de lenguaje:

- **OpenAI** - GPT-4, GPT-3.5, GPT-4 Turbo
- **Anthropic** - Claude 3.5 Sonnet, Opus, Haiku
- **Ollama** - Modelos locales (Llama, Mistral, etc.)
- **Google** - Gemini Pro, Ultra
- **HuggingFace** - Modelos open source

**Ventaja:** No dependes de un solo proveedor, puedes balancear costos y rendimiento.

### 3. Agentes Especializados

Cada agente puede:
- Tener su propio comportamiento (system prompt)
- Usar herramientas específicas
- Atender canales específicos
- Tener condiciones de routing personalizadas

**Ejemplo:** Un agente de ventas puede usar tools de búsqueda de productos, mientras que un agente de soporte técnico usa tools de consulta a base de datos.

### 4. Tools Dinámicas

Sistema de herramientas 100% configurable desde la interfaz:

- **Sin código** - Crear tools básicas desde la UI
- **Con código** - JavaScript para lógica compleja
- **Hot-reload** - Cambios instantáneos sin reiniciar
- **Testing integrado** - Probar tools antes de activarlas

**Tipos de tools:**
- JavaScript - Lógica personalizada
- Email - Envío de correos
- SQL - Consultas a base de datos
- REST - Llamadas a APIs externas

### 5. Knowledge Bases (RAG)

Sistema de bases de conocimiento para respuestas contextuales:

- **Subida de documentos** - PDF, TXT, MD, DOCX
- **Importación desde URL** - Contenido web
- **Chunking inteligente** - División automática de documentos
- **Búsqueda vectorial** - Encuentra información relevante
- **Múltiples KBs por agente** - Combina información de varias fuentes

### 6. Analytics en Tiempo Real

Dashboard completo con métricas:
- Conversaciones totales
- Mensajes por minuto
- Tiempo de respuesta promedio
- Costos por LLM
- Distribución por canal
- Uso de tools

### 7. Widgets WebChat

Widgets embebibles personalizables:
- Colores y posición configurables
- Mensaje de bienvenida personalizado
- CORS configurable por dominio
- Múltiples widgets por cuenta

---

## 🎬 Casos de Uso

### Caso de Uso 1: E-Commerce - Asistente de Ventas

**Problema:** Tienda online recibe muchas consultas sobre productos, disponibilidad y envíos.

**Solución:**
1. Crear agente "Asistente de Ventas"
2. Asignar tools: `search_products`, `check_stock`, `calculate_shipping`
3. Conectar a canal WhatsApp y WebChat
4. Configurar knowledge base con catálogo de productos

**Resultado:**
- 90% de consultas resueltas automáticamente
- Ventas 24/7 sin personal nocturno
- Reducción del 70% en tiempo de respuesta

### Caso de Uso 2: Clínica - Asistente de Citas

**Problema:** Recepción saturada con llamadas para agendar citas.

**Solución:**
1. Crear agente "Asistente de Citas"
2. Asignar tools: `check_availability`, `schedule_appointment`, `send_reminder`
3. Conectar a WhatsApp y Telegram
4. Configurar routing por número de teléfono

**Resultado:**
- 85% de citas agendadas automáticamente
- 50% reducción en no-shows (recordatorios)
- Liberación de personal de recepción

### Caso de Uso 3: Soporte Técnico - Agente de Ayuda

**Problema:** Equipo de soporte sobrecargado con consultas repetitivas.

**Solución:**
1. Crear agente "Soporte Técnico"
2. Crear knowledge base con documentación técnica
3. Asignar tools: `search_knowledge_base`, `create_ticket`, `check_order_status`
4. Configurar escalamiento a humano cuando sea necesario

**Resultado:**
- 80% de tickets resueltos sin intervención humana
- Tiempo de respuesta < 5 segundos
- Satisfacción del cliente aumentada

---

## 🔄 Flujos de Usuario

### Flujo 1: Cliente Inicia Conversación

```
1. Cliente abre WhatsApp/WebChat/Telegram
   ↓
2. Cliente envía mensaje inicial
   ↓
3. Sistema identifica el agente apropiado (routing)
   ↓
4. Agente responde con mensaje de bienvenida (si está configurado)
   ↓
5. Cliente continúa la conversación
   ↓
6. Agente procesa mensaje:
   - Busca en knowledge bases si aplica
   - Ejecuta tools si es necesario
   - Genera respuesta con LLM
   ↓
7. Cliente recibe respuesta
   ↓
8. Conversación continúa hasta que cliente termine
```

### Flujo 2: Administrador Crea Agente

```
1. Administrador accede al panel de administración
   ↓
2. Navega a "Agentes" → "Crear Nuevo"
   ↓
3. Configura información básica:
   - Nombre del agente
   - Descripción
   - LLM a usar
   ↓
4. Selecciona canales donde operará
   ↓
5. Configura system prompt (comportamiento)
   ↓
6. Selecciona tools disponibles
   ↓
7. Configura condiciones de routing (opcional)
   ↓
8. Asigna knowledge bases (opcional)
   ↓
9. Guarda y activa el agente
   ↓
10. Agente está listo para recibir mensajes
```

### Flujo 3: Administrador Crea Tool

```
1. Administrador navega a "Tools" → "Crear Nueva"
   ↓
2. Define información básica:
   - Nombre de la tool
   - Descripción
   - Tipo (JavaScript, Email, SQL, REST)
   ↓
3. Define parámetros (schema JSON)
   ↓
4. Escribe implementación:
   - Si es JavaScript: código en editor Monaco
   - Si es Email: configuración SMTP
   - Si es SQL: query SQL
   - Si es REST: URL y método HTTP
   ↓
5. Prueba la tool con datos de ejemplo
   ↓
6. Activa la tool
   ↓
7. Tool está disponible para asignar a agentes
```

### Flujo 4: Búsqueda en Knowledge Base (RAG)

```
1. Cliente pregunta algo al agente
   ↓
2. Agente tiene knowledge bases asignadas
   ↓
3. Sistema genera embedding de la pregunta
   ↓
4. Busca chunks similares en knowledge bases
   ↓
5. Obtiene top 5 chunks más relevantes
   ↓
6. Incluye chunks en contexto del LLM
   ↓
7. LLM genera respuesta usando información encontrada
   ↓
8. Cliente recibe respuesta contextualizada
```

---

## 📦 Módulos Funcionales

### Módulo 1: Dashboard

**Propósito:** Vista general del sistema con métricas clave.

**Funcionalidades:**
- **Tarjetas de métricas:**
  - Total de conversaciones
  - Total de mensajes
  - Usuarios activos (24h)
  - Costo total (24h)
  
- **Gráficos:**
  - Volumen de mensajes por tiempo
  - Tiempo de respuesta (promedio y p95)
  - Costos diarios
  - Distribución por canal
  - Uso de LLM providers
  
- **Filtros de fecha:**
  - Presets: Últimas 24h, 7 días, 30 días
  - Personalizado: Rango de fechas específico
  - Zona horaria: Ecuador (UTC-5)

**Acceso:** `/` (página principal después de login)

### Módulo 2: Gestión de Canales

**Propósito:** Configurar y gestionar canales de comunicación.

**Funcionalidades:**
- **Crear canal:**
  - Seleccionar tipo (WhatsApp, Telegram, WebChat, Email)
  - Configurar parámetros específicos del canal
  - Asignar nombre único
  
- **Editar canal:**
  - Modificar configuración
  - Activar/desactivar
  
- **Eliminar canal:**
  - Solo si no está asignado a ningún agente

- **Ver/Copiar ID del Canal (Channel Config ID):**
  - En la lista de canales, el sistema muestra el **ID del canal** (`channel_configs.id`) para facilitar integraciones externas (por ejemplo, seleccionar explícitamente qué canal WhatsApp usar para envíos salientes).
  - Incluye acción rápida de **copiar al portapapeles**.

**Tipos de canales:**

**WhatsApp:**
- Provider (**ultramsg**, **twilio**, **360dialog**)
- Parámetros del provider (ejemplos):
  - **UltraMsg**: `instanceId`, `apiToken` (token)
  - **Twilio**: credenciales y número configurado en Twilio (según canal)
  - **360Dialog**: `apiToken` (D360 API Key), `phoneNumberId` (y opcional `wabaId`)

**Telegram:**
- Bot Token
- Username del bot

**WebChat:**
- Orígenes permitidos (CORS)
- Configuración de widget

**Email:**
- SMTP Host/Port
- Credenciales
- IMAP para recibir

**Acceso:** `/channels`

### Módulo 2.1: Integraciones Externas (Sistemas terceros)

**Propósito:** Permitir que sistemas externos (CRM/ERP/Collections) aporten contexto y/o soliciten envíos salientes sin depender de una integración “dedicada” por vertical.

**Capacidades principales:**
- **Contexto externo por conversación:** el sistema puede recibir un “sobre” (`external_context`) y guardarlo asociado a la conversación del usuario para que el agente responda con mayor personalización.
- **Envío saliente idempotente:** un sistema externo puede pedir a AgentHub que envíe un mensaje WhatsApp (por el canal configurado), usando una llave de idempotencia para evitar duplicados ante reintentos.
- **WhatsApp texto o texto + imagen:** soporta mensajes con **caption** y **URL pública** de imagen (u otros tipos de media soportados).

**Notas funcionales:**
- **No reemplaza** la capacidad de un sistema externo de enviar WhatsApp directamente (si ya la tiene). Es una opción adicional para centralizar envíos en AgentHub cuando sea conveniente.
- Para elegir el canal WhatsApp correcto cuando hay múltiples, el sistema externo puede usar el **Channel Config ID** (visible en `/channels`).

### Módulo 3: Gestión de LLMs

**Propósito:** Configurar proveedores de lenguaje.

**Funcionalidades:**
- **Crear configuración LLM:**
  - Seleccionar proveedor (OpenAI, Anthropic, etc.)
  - Seleccionar modelo
  - Ingresar API Key (encriptada)
  - Configurar prioridad
  - Identificador de instancia (para múltiples instancias)
  
- **Multi-instancia:**
  - Múltiples configuraciones del mismo proveedor+modelo
  - Útil para balanceo de carga
  - Diferentes API keys por instancia

**Estrategias de balanceo:**
- Round-robin
- Least-latency
- Least-cost

**Acceso:** `/llms`

### Módulo 4: Gestión de Agentes (Flows)

**Propósito:** Crear y configurar agentes inteligentes.

**Funcionalidades:**
- **Información básica:**
  - Nombre y descripción
  - LLM asignado
  - Estado (activo/inactivo)
  - Prioridad
  
- **Canales:**
  - Seleccionar múltiples canales
  - Prioridad por canal
  
- **Comportamiento:**
  - System prompt (instrucciones para el LLM)
  - Mensaje de bienvenida (para WebChat)
  
- **Tools:**
  - Seleccionar tools disponibles para el agente
  - El agente decide cuándo usar cada tool
  
- **Routing:**
  - Condiciones para que el agente procese mensajes
  - Por número de teléfono (regex)
  - Por username de bot
  - Por rango de horas/días
  
- **Knowledge Bases:**
  - Asignar múltiples KBs
  - Configurar umbral de similitud
  - Máximo de resultados

**Acceso:** `/agents`

### Módulo 5: Gestión de Tools

**Propósito:** Crear herramientas dinámicas para agentes.

**Funcionalidades:**
- **Crear tool:**
  - Nombre y descripción
  - Tipo (JavaScript, Email, SQL, REST)
  - Parámetros (schema JSON)
  - Implementación (código o configuración)
  
- **Editor de código:**
  - Monaco Editor con syntax highlighting
  - Autocomplete
  - Validación en tiempo real
  
- **Testing:**
  - Probar tool con parámetros de ejemplo
  - Ver resultado en tiempo real
  - Ver logs de ejecución
  
- **Gestión:**
  - Activar/desactivar
  - Editar
  - Eliminar

**Tools pre-configuradas:**
- `get_weather` - Clima por ciudad
- `send_email` - Envío de correos
- `search_web` - Búsqueda web
- `calculate` - Calculadora
- Y más...

**Acceso:** `/tools`

### Módulo 6: Knowledge Bases

**Propósito:** Gestionar bases de conocimiento para RAG.

**Funcionalidades:**
- **Crear KB:**
  - Nombre y descripción
  - Modelo de embedding
  - Estrategia de chunking
  - Tamaño de chunk y overlap
  
- **Documentos:**
  - Subir archivos (PDF, TXT, MD, DOCX)
  - Importar desde URL
  - Crear manualmente
  - Ver estado de procesamiento
  
- **Embeddings:**
  - Generación automática al subir documento
  - Visualización de chunks generados
  - Re-procesar si es necesario

**Acceso:** `/knowledge-bases`

### Módulo 7: Conversaciones

**Propósito:** Ver y gestionar conversaciones con usuarios.

**Funcionalidades:**
- **Lista de conversaciones:**
  - Filtros: canal, estado, usuario, fechas
  - Búsqueda por ID de usuario
  - Paginación
  
- **Detalle de conversación:**
  - Historial completo de mensajes
  - Información del usuario
  - Tools ejecutadas
  - Costos generados
  - Tiempos de respuesta
  - Envío de mensajes salientes (proactivos) desde el panel:
    - El sistema intenta usar la **configuración original del canal** (guardada en la conversación) para evitar enviar por un canal equivocado cuando existen múltiples canales WhatsApp activos.
  
- **Estadísticas:**
  - Total de conversaciones
  - Conversaciones activas
  - Promedio de mensajes por conversación
  - Tiempo promedio de respuesta

**Acceso:** `/conversations`

### Módulo 8: Widgets

**Propósito:** Crear y gestionar widgets de WebChat.

**Funcionalidades:**
- **Crear widget:**
  - Nombre y clave única
  - Canal asignado
  - Orígenes permitidos (CORS)
  
- **Personalización:**
  - Posición (esquinas)
  - Colores (primario, botón, texto)
  - Tamaño de botón y ventana
  - Mensaje de bienvenida
  - Placeholder de input
  - Indicador de escritura
  - Sonido de notificación
  
- **Código de embed:**
  - Generación automática de código HTML
  - Listo para copiar y pegar

**Acceso:** `/widgets`

### Módulo 9: Analytics

**Propósito:** Análisis detallado de métricas y rendimiento.

**Funcionalidades:**
- **Métricas por tiempo:**
  - Volumen de mensajes
  - Tiempo de respuesta
  - Costos diarios
  
- **Distribución:**
  - Por canal
  - Por LLM provider
  - Por agente
  
- **Filtros:**
  - Rango de fechas personalizado
  - Granularidad (hora, día, semana)

**Acceso:** `/analytics` (integrado en Dashboard)

### Módulo 10: Logs

**Propósito:** Ver logs del sistema para debugging.

**Funcionalidades:**
- **Filtros:**
  - Por nivel (error, warn, info, debug)
  - Por servicio
  - Por conversación
  
- **Visualización:**
  - Formato estructurado
  - Búsqueda de texto
  - Exportación

**Acceso:** `/logs`

### Módulo 11: Playground

**Propósito:** Probar agentes y tools en tiempo real.

**Funcionalidades:**
- **Seleccionar agente:**
  - Por canal
  - Ver configuración
  
- **Enviar mensajes:**
  - Simular conversación completa
  - Ver respuesta del agente
  - Ver tools ejecutadas
  - Ver contexto usado
  
- **Debug:**
  - Ver request completo
  - Ver response completo
  - Ver logs de ejecución

**Acceso:** `/playground`

---

## 🤖 Configuración de Agentes

### Paso 1: Información Básica

```
Nombre: "Asistente de Ventas"
Descripción: "Ayuda a clientes con consultas de productos y ventas"
LLM: GPT-4 (OpenAI)
Estado: Activo
Prioridad: 10
```

### Paso 2: Canales

```
Canales asignados:
- WhatsApp (Canal Principal)
- WebChat (Canal Secundario)

Prioridad por canal:
- WhatsApp: 1
- WebChat: 2
```

### Paso 3: Comportamiento (System Prompt)

```
Eres un asistente de ventas amigable y profesional. Tu objetivo es:
1. Ayudar a los clientes a encontrar productos
2. Responder preguntas sobre disponibilidad
3. Calcular costos de envío
4. Registrar leads interesados

Siempre sé cortés y ofrece ayuda adicional al final de cada respuesta.
```

### Paso 4: Tools Disponibles

```
Tools asignadas:
- search_products (buscar en catálogo)
- check_stock (verificar inventario)
- calculate_shipping (calcular envío)
- send_leadbox_lead (registrar lead)
```

### Paso 5: Routing

```
Condiciones:
- Números de teléfono: +59399*
- Horario: 09:00 - 18:00 (Lun-Vie)
- Zona horaria: America/Guayaquil
```

### Paso 6: Knowledge Bases

```
KBs asignadas:
- Catálogo de Productos (prioridad 1)
- Políticas de Envío (prioridad 2)

Configuración:
- Umbral de similitud: 0.7
- Máximo de resultados: 5
```

---

## 🛠️ Sistema de Tools

### Tipos de Tools

#### 1. JavaScript

**Uso:** Lógica personalizada compleja.

**Ejemplo - Búsqueda de productos:**
```javascript
async function search_products(query) {
  // Lógica de búsqueda
  const results = await db.query(
    'SELECT * FROM products WHERE name ILIKE $1',
    [`%${query}%`]
  );
  return results.rows;
}
```

#### 2. Email

**Uso:** Envío de correos electrónicos.

**Configuración:**
- SMTP Host
- SMTP Port
- Username/Password
- From address

#### 3. SQL

**Uso:** Consultas directas a base de datos.

**Ejemplo:**
```sql
SELECT * FROM orders WHERE customer_id = $1 AND status = 'pending'
```

#### 4. REST

**Uso:** Llamadas a APIs externas.

**Configuración:**
- URL
- Método HTTP
- Headers
- Body template

### Creación de Tool

**Proceso:**
1. Ir a "Tools" → "Crear Nueva"
2. Llenar información básica
3. Definir parámetros (schema JSON)
4. Escribir implementación
5. Probar con datos de ejemplo
6. Activar tool
7. Asignar a agentes

---

## 📚 Knowledge Bases (RAG)

### Creación de Knowledge Base

**Paso 1: Información básica**
```
Nombre: "Catálogo de Productos"
Descripción: "Información de todos los productos disponibles"
Modelo de embedding: OpenAI text-embedding-3-small
Estrategia de chunking: Recursive
Tamaño de chunk: 1000 caracteres
Overlap: 200 caracteres
```

**Paso 2: Subir documentos**
- Opción 1: Subir archivo (PDF, TXT, MD, DOCX)
- Opción 2: Importar desde URL
- Opción 3: Crear manualmente

**Paso 3: Procesamiento**
- Sistema genera chunks automáticamente
- Crea embeddings usando el modelo configurado
- Almacena en base de datos con índice vectorial

**Paso 4: Asignar a agentes**
- Seleccionar agentes que usarán esta KB
- Configurar umbral de similitud
- Configurar máximo de resultados

### Uso en Conversaciones

Cuando un agente tiene KBs asignadas:
1. Cliente hace pregunta
2. Sistema genera embedding de la pregunta
3. Busca chunks similares en KBs asignadas
4. Incluye chunks relevantes en contexto del LLM
5. LLM genera respuesta usando información encontrada

---

## 📊 Analytics y Reportes

### Métricas Disponibles

**Dashboard Principal:**
- Total de conversaciones
- Total de mensajes
- Usuarios activos (24h)
- Costo total (24h)
- Mensajes por minuto
- Tiempo promedio de respuesta

**Gráficos:**
- Volumen de mensajes por tiempo
- Tiempo de respuesta (promedio y p95)
- Costos diarios
- Distribución por canal
- Distribución por LLM provider
- Uso de tools

### Filtros de Fecha

**Presets:**
- Últimas 24 horas
- Últimos 7 días
- Últimos 30 días

**Personalizado:**
- Seleccionar fecha inicio
- Seleccionar fecha fin
- Zona horaria: Ecuador (UTC-5)

---

## 💬 Widgets WebChat

### Creación de Widget

**Paso 1: Información básica**
```
Nombre: "Widget Principal"
Clave: "main-widget"
Canal: WebChat Principal
```

**Paso 2: Configuración CORS**
```
Orígenes permitidos:
- https://example.com
- https://www.example.com
```

**Paso 3: Personalización**
```
Posición: bottom-right
Color primario: #3B82F6
Color botón: #3B82F6
Color texto botón: #FFFFFF
Tamaño botón: 56px
Ancho ventana: 380px
Alto ventana: 500px
Mensaje bienvenida: "¡Hola! ¿En qué puedo ayudarte?"
```

**Paso 4: Obtener código**
```html
<script>
  (function() {
    var script = document.createElement('script');
    script.src = 'https://tu-dominio.com/widget.js';
    script.setAttribute('data-widget-key', 'main-widget');
    document.head.appendChild(script);
  })();
</script>
```

### Características del Widget

- **Responsive** - Se adapta a móviles y desktop
- **Tiempo real** - WebSocket para comunicación instantánea
- **Autenticación** - JWT para seguridad
- **Personalizable** - Colores, posición, mensajes
- **Multi-instancia** - Múltiples widgets por cuenta

---

## 🏢 Casos de Uso por Industria

### Retail & E-Commerce

**Agente:** Asistente de Ventas  
**Canales:** WhatsApp + WebChat  
**Tools:** search_products, check_stock, calculate_shipping  
**KB:** Catálogo de productos  

**Resultados típicos:**
- 90% consultas resueltas automáticamente
- Ventas 24/7
- +40% conversión

### Salud & Clínicas

**Agente:** Asistente de Citas  
**Canales:** WhatsApp + Telegram  
**Tools:** check_availability, schedule_appointment, send_reminder  
**KB:** Información de servicios médicos  

**Resultados típicos:**
- 85% citas agendadas automáticamente
- 50% reducción en no-shows
- Liberación de personal de recepción

### Educación

**Agente:** Asistente Académico  
**Canales:** WebChat + Email  
**Tools:** search_courses, check_schedule, register_student  
**KB:** Información académica, programas  

**Resultados típicos:**
- 80% consultas resueltas
- Disponibilidad 24/7
- Reducción de carga administrativa

### Servicios Financieros

**Agente:** Asistente Financiero  
**Canales:** WhatsApp + WebChat  
**Tools:** check_balance, transfer_funds, check_transactions  
**KB:** Términos y condiciones, productos financieros  

**Resultados típicos:**
- Consultas básicas automatizadas
- Reducción de llamadas a call center
- Mejor experiencia del cliente

---

## 📱 Experiencia del Usuario Final

### Interacción por WhatsApp

```
Usuario: Hola
Agente: ¡Hola! Soy el asistente de ventas. ¿En qué puedo ayudarte?

Usuario: Busco una mesa de comedor
Agente: Te ayudo a buscar mesas de comedor. ¿Qué estilo prefieres?

Usuario: Moderna y blanca
Agente: [Ejecuta tool: search_products]
        Encontré 3 opciones de mesas modernas blancas:
        1. Mesa Moderna Blanca - $299
        2. Mesa Minimalista Blanca - $349
        3. Mesa Escandinava Blanca - $399
        
        ¿Te gustaría más información de alguna?

Usuario: La primera
Agente: [Ejecuta tool: check_stock]
        La mesa Moderna Blanca está disponible. 
        [Ejecuta tool: calculate_shipping]
        El envío a tu ciudad cuesta $25.
        
        Total: $324
        ¿Deseas proceder con la compra?
```

### Interacción por WebChat

```
[Widget aparece en esquina inferior derecha]

Usuario hace clic en widget
↓
Widget se abre mostrando mensaje de bienvenida
↓
Usuario escribe mensaje
↓
Agente responde en tiempo real
↓
Si agente necesita ejecutar tool, muestra indicador de "pensando"
↓
Respuesta aparece con información completa
↓
Usuario puede continuar conversación
↓
Usuario cierra widget cuando termina
```

---

## 🎯 Mejores Prácticas

### Configuración de Agentes

1. **System Prompt claro:**
   - Define rol y objetivo
   - Establece tono de comunicación
   - Incluye instrucciones específicas

2. **Tools apropiadas:**
   - Solo asignar tools necesarias
   - Documentar bien cada tool
   - Probar antes de activar

3. **Routing específico:**
   - Usar condiciones claras
   - Evitar overlaps entre agentes
   - Priorizar correctamente

### Knowledge Bases

1. **Contenido relevante:**
   - Solo información útil
   - Actualizar regularmente
   - Eliminar información obsoleta

2. **Chunking adecuado:**
   - Tamaño apropiado (500-1500 caracteres)
   - Overlap suficiente (10-20%)
   - Estrategia según tipo de contenido

### Tools

1. **Nombres descriptivos:**
   - Usar nombres claros
   - Documentar parámetros
   - Incluir ejemplos

2. **Manejo de errores:**
   - Validar inputs
   - Manejar excepciones
   - Retornar mensajes claros

---

## 📞 Soporte y Recursos

### Documentación Adicional

- **README.md** - Guía de instalación y configuración
- **docs/DOCUMENTACION_TECNICA.md** - Detalles técnicos del sistema
- **docs/** - Documentación específica por tema

### Recursos

- **Dashboard** - Monitoreo en tiempo real
- **Logs** - Debugging y troubleshooting
- **Playground** - Pruebas interactivas

---

**Última actualización:** Enero 2026  
**Versión del documento:** 1.1.0

