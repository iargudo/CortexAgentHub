# 📚 Documentación Técnica - CortexAgentHub

**Versión:** 1.0.0  
**Última actualización:** Diciembre 2025  
**Autor:** Equipo de Desarrollo CortexAgentHub

---

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Stack Tecnológico](#stack-tecnológico)
4. [Estructura del Proyecto](#estructura-del-proyecto)
5. [Base de Datos](#base-de-datos)
6. [APIs y Endpoints](#apis-y-endpoints)
7. [Servicios y Componentes](#servicios-y-componentes)
8. [Seguridad](#seguridad)
9. [Despliegue y DevOps](#despliegue-y-devops)
10. [Configuración](#configuración)
11. [Desarrollo](#desarrollo)
12. [Troubleshooting](#troubleshooting)

---

## 🎯 Visión General

**CortexAgentHub** es una plataforma de orquestación de IA multi-canal construida con arquitectura de microservicios, diseñada para escalar horizontalmente y manejar millones de interacciones simultáneas.

### Características Técnicas Principales

- **Arquitectura Monorepo** - PNPM Workspaces para gestión de dependencias
- **TypeScript First** - 100% tipado estático en frontend y backend
- **Microservicios Modulares** - Paquetes independientes y reutilizables
- **Base de Datos PostgreSQL** - Con extensión pgvector para búsqueda vectorial
- **Cache Distribuido** - Redis para contexto y sesiones
- **Colas Asíncronas** - BullMQ para procesamiento de tareas
- **WebSockets** - Comunicación en tiempo real para WebChat
- **Multi-LLM Gateway** - Balanceo de carga y fallback automático

---

## 🏗️ Arquitectura del Sistema

### Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Vite)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Dashboard  │  │   Admin UI   │  │  Chat Client │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
└─────────┼──────────────────┼──────────────────┼────────────────────┘
          │                  │                  │
          │ HTTP/REST        │ HTTP/REST        │ WebSocket
          │                  │                  │
┌─────────┼──────────────────┼──────────────────┼────────────────────┐
│         │                  │                  │                      │
│  ┌──────▼──────────────────▼──────────────────▼──────┐            │
│  │         API SERVICE (Fastify + TypeScript)         │            │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │            │
│  │  │ Controllers│ │ Services │ │  Routes  │          │            │
│  │  └─────┬────┘  └─────┬────┘  └─────┬────┘          │            │
│  └────────┼──────────────┼──────────────┼───────────────┘            │
│           │              │              │                            │
│  ┌────────▼──────────────▼──────────────▼───────────────┐          │
│  │              CORE PACKAGES                           │          │
│  │  ┌──────────────┐  ┌──────────────┐                 │          │
│  │  │   Router     │  │ Orchestrator │                 │          │
│  │  └──────────────┘  └──────────────┘                 │          │
│  └────────┬──────────────────┬──────────────────────────┘          │
│           │                  │                                      │
│  ┌────────▼──────────────────▼──────────────────────────┐          │
│  │         CHANNEL ADAPTERS                              │          │
│  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐            │          │
│  │  │WhatsApp││Telegram││WebChat││ Email │            │          │
│  │  └──────┘  └──────┘  └──────┘  └──────┘            │          │
│  └────────┬──────────────────┬──────────────────────────┘          │
│           │                  │                                      │
│  ┌────────▼──────────────────▼──────────────────────────┐          │
│  │         LLM GATEWAY                                  │          │
│  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐            │          │
│  │  │OpenAI││Anthropic││ Ollama││Google │            │          │
│  │  └──────┘  └──────┘  └──────┘  └──────┘            │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐          │
│  │         MCP SERVER (Tools Execution)                 │          │
│  │  ┌──────────────┐  ┌──────────────┐                 │          │
│  │  │ Tool Engine  │  │  Execution   │                 │          │
│  │  └──────────────┘  └──────────────┘                 │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐          │
│  │         QUEUE SERVICE (BullMQ)                       │          │
│  │  ┌──────────────┐  ┌──────────────┐                 │          │
│  │  │   Workers    │  │   Jobs       │                 │          │
│  │  └──────────────┘  └──────────────┘                 │          │
│  └──────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    INFRAESTRUCTURA                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  PostgreSQL  │  │    Redis    │  │   Azure      │              │
│  │  (pgvector)  │  │   (Cache)   │  │  (Deploy)    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

### Flujo de Procesamiento de Mensajes

```
1. Mensaje llega por canal (WhatsApp/Telegram/WebChat/Email)
   ↓
2. Channel Adapter normaliza el mensaje
   ↓
3. FlowBasedMessageRouter identifica el agente (flow) apropiado
   ↓
4. AIOrchestrator procesa el mensaje:
   - Obtiene contexto de Redis/PostgreSQL
   - Ejecuta RAG si hay knowledge bases
   - Determina qué tools usar
   ↓
5. MCP Server ejecuta tools si es necesario
   ↓
6. LLM Gateway genera respuesta:
   - Selecciona LLM según configuración
   - Balancea carga entre instancias
   - Maneja fallbacks automáticos
   ↓
7. Respuesta se envía por el mismo canal
   ↓
8. Se guarda en PostgreSQL y se actualiza analytics
```

---

## 💻 Stack Tecnológico

### Backend

| Tecnología | Versión | Propósito |
|-----------|---------|-----------|
| **Node.js** | 18+ | Runtime JavaScript |
| **TypeScript** | 5.3+ | Tipado estático |
| **Fastify** | 4.x | HTTP server de alto rendimiento |
| **PostgreSQL** | 15+ | Base de datos relacional |
| **pgvector** | Latest | Búsqueda vectorial |
| **Redis** | 7.x | Cache y context store |
| **BullMQ** | Latest | Cola de trabajos |
| **pg** | Latest | Cliente PostgreSQL |
| **ioredis** | Latest | Cliente Redis |
| **axios** | Latest | Cliente HTTP |
| **jsonwebtoken** | Latest | Autenticación JWT |
| **bcrypt** | Latest | Hash de contraseñas |

### Frontend

| Tecnología | Versión | Propósito |
|-----------|---------|-----------|
| **React** | 18.x | UI library |
| **TypeScript** | 5.3+ | Tipado estático |
| **Vite** | 5.x | Build tool y dev server |
| **Tailwind CSS** | 3.x | Utility-first CSS |
| **React Query** | Latest | Data fetching y cache |
| **Recharts** | Latest | Gráficos y visualizaciones |
| **Monaco Editor** | Latest | Editor de código |
| **Axios** | Latest | Cliente HTTP |
| **React Router** | Latest | Routing |
| **Lucide Icons** | Latest | Iconografía |

### Herramientas de Desarrollo

| Tecnología | Versión | Propósito |
|-----------|---------|-----------|
| **PNPM** | 8+ | Gestor de paquetes |
| **ESLint** | Latest | Linting |
| **Prettier** | Latest | Code formatting |
| **Docker** | Latest | Containerización |
| **Azure CLI** | Latest | Deployment a Azure |

---

## 📁 Estructura del Proyecto

### Monorepo Structure

```
CortexAgentHub/
├── backend/
│   ├── api-service/          # Servicio API principal
│   │   ├── src/
│   │   │   ├── controllers/  # Controladores HTTP
│   │   │   ├── routes/       # Definición de rutas
│   │   │   ├── services/     # Lógica de negocio
│   │   │   ├── middleware/   # Middleware (auth, errors)
│   │   │   └── server.ts     # Servidor Fastify
│   │   ├── scripts/          # Scripts de utilidad
│   │   └── public/           # Archivos estáticos (widget.js)
│   │
│   └── packages/             # Paquetes compartidos
│       ├── core/             # Lógica core (router, orchestrator)
│       ├── channel-adapters/ # Adaptadores de canales
│       ├── llm-gateway/      # Gateway multi-LLM
│       ├── mcp-server/       # Servidor MCP (tools)
│       ├── database/         # Repositorios y migraciones
│       ├── queue-service/    # Servicio de colas
│       └── shared/           # Utilidades compartidas
│
├── frontend/
│   ├── src/
│   │   ├── pages/            # Páginas principales
│   │   ├── components/       # Componentes reutilizables
│   │   ├── services/          # Servicios API
│   │   ├── hooks/             # Custom hooks
│   │   └── types/             # TypeScript types
│   └── public/               # Assets estáticos
│
├── docs/                      # Documentación adicional
├── scripts/                   # Scripts de deployment
└── package.json               # Configuración del monorepo
```

### Paquetes Principales

#### `backend/api-service`
Servicio HTTP principal que expone todas las APIs REST y WebSocket.

**Archivos clave:**
- `src/server.ts` - Configuración del servidor Fastify
- `src/controllers/` - Controladores para cada dominio
- `src/routes/` - Definición de rutas
- `src/services/` - Servicios de negocio (RAG, Embeddings)

#### `backend/packages/core`
Lógica central de orquestación y routing.

**Componentes:**
- `FlowBasedMessageRouter` - Enruta mensajes a flows apropiados
- `AIOrchestrator` - Orquesta la ejecución de LLM y tools
- `RoutingMatcher` - Evalúa condiciones de routing

#### `backend/packages/channel-adapters`
Adaptadores para cada canal de comunicación.

**Adaptadores:**
- `WhatsAppAdapter` - Integración con UltraMsg/Twilio
- `TelegramAdapter` - Bot API de Telegram
- `WebChatAdapter` - WebSocket para webchat
- `EmailAdapter` - SMTP/IMAP para email

#### `backend/packages/llm-gateway`
Gateway unificado para múltiples proveedores de LLM.

**Características:**
- Balanceo de carga (round-robin, least-latency, least-cost)
- Circuit breaker para recuperación de fallos
- Rate limiting por proveedor
- Fallback automático

#### `backend/packages/mcp-server`
Servidor MCP (Model Context Protocol) para ejecución de tools.

**Características:**
- Ejecución segura de JavaScript
- Hot-reload de tools
- Testing integrado
- Rate limiting por tool

#### `backend/packages/database`
Repositorios y migraciones de base de datos.

**Estructura:**
- `src/repositories/` - Repositorios para cada entidad
- `migrations/` - Migraciones SQL
- `scripts/` - Scripts de utilidad

---

## 🗄️ Base de Datos

### Esquema Principal

#### Tablas Core

**`conversations`** - Conversaciones de usuarios
```sql
- id (UUID, PK)
- channel (VARCHAR) - Tipo de canal
- channel_user_id (VARCHAR) - ID del usuario en el canal
- flow_id (UUID, FK) - Agente que procesó la conversación
- started_at (TIMESTAMP)
- last_activity (TIMESTAMP)
- status (VARCHAR) - active, closed, archived
- metadata (JSONB)
```

**`messages`** - Mensajes individuales
```sql
- id (UUID, PK)
- conversation_id (UUID, FK)
- role (VARCHAR) - user, assistant, system
- content (TEXT)
- timestamp (TIMESTAMP)
- llm_provider (VARCHAR)
- llm_model (VARCHAR)
- tokens_used (JSONB)
- cost (NUMERIC)
- metadata (JSONB)
```

**`orchestration_flows`** - Agentes/Flows configurados
```sql
- id (UUID, PK)
- name (VARCHAR)
- description (TEXT)
- llm_id (UUID, FK)
- enabled_tools (TEXT[]) - Array de nombres de tools
- flow_config (JSONB) - Configuración visual
- routing_conditions (JSONB) - Condiciones de routing
- priority (INTEGER)
- active (BOOLEAN)
- greeting_message (TEXT)
- created_at, updated_at (TIMESTAMPTZ)
```

**`channel_configs`** - Configuraciones de canales
```sql
- id (UUID, PK)
- channel_type (VARCHAR) - whatsapp, telegram, webchat, email
- name (VARCHAR) - Nombre único
- config (JSONB) - Configuración específica del canal
- is_active (BOOLEAN)
- created_at, updated_at (TIMESTAMP)
```

**`flow_channels`** - Relación M:M entre flows y canales
```sql
- id (UUID, PK)
- flow_id (UUID, FK)
- channel_id (UUID, FK)
- active (BOOLEAN)
- priority (INTEGER)
- created_at, updated_at (TIMESTAMPTZ)
```

#### Tablas de Knowledge Bases (RAG)

**`knowledge_bases`** - Bases de conocimiento
```sql
- id (UUID, PK)
- name (VARCHAR, UNIQUE)
- description (TEXT)
- embedding_model_id (UUID, FK)
- chunk_size (INTEGER)
- chunk_overlap (INTEGER)
- chunking_strategy (VARCHAR)
- active (BOOLEAN)
- metadata (JSONB)
```

**`knowledge_base_documents`** - Documentos en KB
```sql
- id (UUID, PK)
- knowledge_base_id (UUID, FK)
- title (VARCHAR)
- content (TEXT)
- source_type (VARCHAR) - manual, file, url, api
- status (VARCHAR) - pending, processing, completed, failed
- metadata (JSONB)
```

**`knowledge_base_embeddings`** - Embeddings vectoriales
```sql
- id (UUID, PK)
- document_id (UUID, FK)
- knowledge_base_id (UUID, FK)
- chunk_index (INTEGER)
- content (TEXT)
- embedding (VECTOR) - pgvector
- token_count (INTEGER)
- metadata (JSONB)
```

**`flow_knowledge_bases`** - Relación M:M flows-KB
```sql
- id (UUID, PK)
- flow_id (UUID, FK)
- knowledge_base_id (UUID, FK)
- priority (INTEGER)
- similarity_threshold (NUMERIC)
- max_results (INTEGER)
- active (BOOLEAN)
```

#### Tablas de Tools

**`tool_definitions`** - Definiciones de tools dinámicas
```sql
- id (UUID, PK)
- name (VARCHAR, UNIQUE)
- description (TEXT)
- parameters (JSONB) - Schema JSON
- implementation (TEXT) - Código JavaScript
- permissions (JSONB)
- active (BOOLEAN)
- tool_type (VARCHAR) - javascript, email, sql, rest
- config (JSONB)
```

**`tool_executions`** - Log de ejecuciones
```sql
- id (UUID, PK)
- message_id (UUID, FK)
- tool_name (VARCHAR)
- parameters (JSONB)
- result (JSONB)
- status (VARCHAR) - success, error, timeout
- execution_time_ms (INTEGER)
- executed_at (TIMESTAMP)
```

#### Otras Tablas Importantes

- **`llm_configs`** - Configuraciones de LLM con multi-instancia
- **`embedding_models`** - Modelos de embeddings
- **`admin_users`** - Usuarios administradores
- **`widgets`** - Configuración de widgets webchat
- **`analytics_events`** - Eventos de analytics
- **`system_logs`** - Logs del sistema
- **`context_store`** - Almacenamiento de contexto (alternativa a Redis)

### Extensiones PostgreSQL

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- Funciones criptográficas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- Generación de UUIDs
CREATE EXTENSION IF NOT EXISTS vector;        -- pgvector para búsqueda vectorial
```

### Índices Clave

- **B-tree** para búsquedas rápidas en campos comunes
- **GIN** para búsquedas en campos JSONB
- **HNSW** (pgvector) para búsqueda de similitud vectorial

---

## 🔌 APIs y Endpoints

### API Admin (`/api/admin`)

#### Autenticación
- `POST /api/admin/auth/login` - Login de administrador
- `GET /api/admin/users/me` - Usuario actual
- `POST /api/admin/users/me/change-password` - Cambiar contraseña

#### Dashboard y Analytics
- `GET /api/admin/dashboard/stats` - Estadísticas del dashboard
- `GET /api/admin/analytics` - Analytics con filtros de fecha
- `GET /api/admin/health` - Estado de salud del sistema

#### Gestión de Flows (Agentes)
- `GET /api/admin/flows` - Listar flows
- `POST /api/admin/flows` - Crear flow
- `PUT /api/admin/flows/:id` - Actualizar flow
- `DELETE /api/admin/flows/:id` - Eliminar flow

#### Gestión de Canales
- `GET /api/admin/channels` - Listar canales
- `POST /api/admin/channels` - Crear canal
- `PUT /api/admin/channels/:id` - Actualizar canal
- `DELETE /api/admin/channels/:id` - Eliminar canal

#### Gestión de LLMs
- `GET /api/admin/llms` - Listar configuraciones LLM
- `POST /api/admin/llms` - Crear configuración LLM
- `PUT /api/admin/llms/:id` - Actualizar LLM
- `DELETE /api/admin/llms/:id` - Eliminar LLM

#### Gestión de Tools
- `GET /api/admin/tools` - Listar tools
- `POST /api/admin/tools` - Crear tool
- `PUT /api/admin/tools/:id` - Actualizar tool
- `DELETE /api/admin/tools/:id` - Eliminar tool
- `POST /api/admin/tools/:id/test` - Probar tool

#### Knowledge Bases
- `GET /api/admin/knowledge-bases` - Listar KBs
- `POST /api/admin/knowledge-bases` - Crear KB
- `PUT /api/admin/knowledge-bases/:id` - Actualizar KB
- `DELETE /api/admin/knowledge-bases/:id` - Eliminar KB
- `POST /api/admin/knowledge-bases/:id/documents` - Subir documento
- `GET /api/admin/knowledge-bases/:id/documents` - Listar documentos

#### Widgets
- `GET /api/admin/widgets` - Listar widgets
- `POST /api/admin/widgets` - Crear widget
- `PUT /api/admin/widgets/:id` - Actualizar widget
- `DELETE /api/admin/widgets/:id` - Eliminar widget
- `GET /api/admin/widgets/:widgetKey/config` - Config pública del widget

### API Pública (`/api/v1`)

#### Mensajes
- `POST /api/v1/messages` - Enviar mensaje
- `GET /api/v1/conversations/:id` - Obtener conversación

#### Webhooks
- `POST /api/webhooks/whatsapp` - Webhook de WhatsApp
- `POST /api/webhooks/telegram` - Webhook de Telegram

### WebSocket (`/webchat/ws`)

**Autenticación:**
```javascript
// Cliente envía al conectar:
{
  type: 'auth',
  token: 'JWT_TOKEN'
}

// Servidor responde:
{
  type: 'auth_success',
  agentId: 'uuid',
  greetingMessage: '...'
}
```

**Mensajes:**
```javascript
// Cliente → Servidor
{
  type: 'message',
  content: 'Hola'
}

// Servidor → Cliente
{
  type: 'message',
  role: 'assistant',
  content: 'Respuesta del agente',
  metadata: {...}
}
```

---

## 🔧 Servicios y Componentes

### RAGService

Servicio de Retrieval-Augmented Generation para búsqueda en knowledge bases.

**Métodos principales:**
- `search(query: RAGQuery): Promise<RAGResult>` - Buscar en KBs
- `getKnowledgeBasesForFlow(flowId: string): Promise<FlowKB[]>`

**Flujo:**
1. Obtiene KBs asignadas al flow
2. Genera embedding de la consulta usando el modelo configurado
3. Busca chunks similares usando pgvector (cosine similarity)
4. Retorna chunks ordenados por relevancia

### EmbeddingService

Servicio para generar embeddings usando múltiples proveedores.

**Soporta:**
- OpenAI (text-embedding-3-small, text-embedding-3-large)
- Cohere (embed-english-v3.0)
- HuggingFace Inference API
- Modelos locales (si están disponibles)

### FlowBasedMessageRouter

Router inteligente que determina qué flow (agente) debe procesar un mensaje.

**Estrategias de routing:**
- Por tipo de canal
- Por número de teléfono (regex)
- Por username de bot (Telegram)
- Por condiciones personalizadas (JSONB)
- Por prioridad

### AIOrchestrator

Orquestador principal que coordina la ejecución de LLM y tools.

**Flujo de ejecución:**
1. Obtiene contexto de conversación
2. Ejecuta RAG si hay KBs asignadas
3. Construye mensajes para el LLM
4. Ejecuta tools si el LLM las solicita
5. Genera respuesta final
6. Guarda en base de datos

### LLM Gateway

Gateway unificado para múltiples proveedores de LLM.

**Características:**
- **Load Balancing**: Round-robin, least-latency, least-cost
- **Circuit Breaker**: Detecta fallos y cambia automáticamente
- **Rate Limiting**: Por proveedor y por usuario
- **Fallback**: Cambia automáticamente si un LLM falla
- **Cost Tracking**: Registra tokens y costos por llamada

**Proveedores soportados:**
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude 3.5 Sonnet, Opus, Haiku)
- Ollama (modelos locales)
- Google (Gemini Pro, Ultra)
- HuggingFace Inference API

### MCP Server

Servidor MCP (Model Context Protocol) para ejecución de tools dinámicas.

**Características:**
- Ejecución segura de JavaScript en sandbox
- Hot-reload sin reiniciar servidor
- Rate limiting por tool
- Logging de todas las ejecuciones
- Testing integrado

---

## 🔒 Seguridad

### Autenticación

**JWT Tokens:**
- Algoritmo: HS256
- Expiración: 24 horas (configurable)
- Refresh: No implementado (requiere nuevo login)

**Endpoints protegidos:**
- Todos los endpoints `/api/admin/*` requieren autenticación
- WebSocket requiere token JWT en conexión inicial

### Autorización

**Roles:**
- `admin` - Acceso completo al sistema
- Implementación básica (expandible a múltiples roles)

### Validación

**Input Validation:**
- Validación de tipos con TypeScript
- Validación de esquemas con validadores personalizados
- Sanitización de inputs antes de guardar en BD

### Rate Limiting

**Implementado en:**
- LLM Gateway (por proveedor)
- MCP Server (por tool)
- API endpoints (configurable)

### CORS

**Configuración:**
- Permite orígenes específicos para widgets
- Configurable por widget individual

---

## 🚀 Despliegue y DevOps

### Docker

**Imágenes:**
- `backend/api-service` - Servicio API
- `frontend` - Aplicación React (Nginx)

**Docker Compose:**
```yaml
services:
  api:
    build: ./backend/api-service
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=...
      - REDIS_URL=...
  
  frontend:
    build: ./frontend
    ports:
      - "80:80"
```

### Azure App Service

**Deployment Script:**
- `deploy-docker.sh` - Script automatizado para Azure
- Soporta múltiples entornos (staging, production)
- Configuración automática de variables de entorno

**Requisitos Azure:**
- App Service Plan (Linux)
- PostgreSQL Flexible Server
- Redis Cache (opcional)
- WebSockets habilitados

### Variables de Entorno

**Backend (.env):**
```bash
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# JWT
JWT_SECRET=...

# LLM API Keys
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

# Channel APIs
ULTRAMSG_API_KEY=...
ULTRAMSG_INSTANCE_ID=...
TELEGRAM_BOT_TOKEN=...

# Email
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
```

**Frontend (.env):**
```bash
VITE_API_URL=http://localhost:3000
VITE_FRONTEND_URL=http://localhost:5174
```

---

## ⚙️ Configuración

### Configuración de Canales

**WhatsApp (UltraMsg):**
```json
{
  "instanceId": "132581",
  "phoneNumber": "593997369006",
  "provider": "ultramsg"
}
```

**Telegram:**
```json
{
  "botToken": "123456:ABC-DEF..."
}
```

**WebChat:**
```json
{
  "allowedOrigins": ["https://example.com"]
}
```

### Configuración de LLM

**Multi-instancia:**
```json
{
  "provider": "openai",
  "model": "gpt-4",
  "instance_identifier": "server1",
  "api_key_encrypted": "...",
  "priority": 0,
  "active": true
}
```

### Configuración de Flows

**Routing Conditions:**
```json
{
  "phoneNumbers": ["+59399*"],
  "botUsernames": ["@mybot"],
  "timeRanges": [{
    "start": "09:00",
    "end": "18:00",
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "timezone": "America/Guayaquil"
  }]
}
```

---

## 💻 Desarrollo

### Setup Local

```bash
# 1. Clonar repositorio
git clone <repo-url>
cd CortexAgentHub

# 2. Instalar dependencias
pnpm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 4. Iniciar PostgreSQL y Redis
docker-compose up -d postgres redis

# 5. Ejecutar migraciones
cd backend/packages/database
pnpm run migrate

# 6. Iniciar desarrollo
pnpm dev
```

### Scripts Disponibles

```bash
# Desarrollo
pnpm dev                    # Inicia todos los servicios en modo desarrollo
pnpm build                  # Compila todos los paquetes
pnpm lint                   # Ejecuta linter
pnpm format                 # Formatea código con Prettier

# Base de datos
pnpm migrate                # Ejecuta migraciones
pnpm seed                   # Pobla base de datos con datos de prueba
```

### Estructura de Código

**Convenciones:**
- TypeScript strict mode habilitado
- ESLint + Prettier para formato consistente
- Interfaces para todos los tipos públicos
- Documentación JSDoc en funciones complejas

**Testing:**
- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- E2E tests: `*.e2e.test.ts`

---

## 🐛 Troubleshooting

### Problemas Comunes

**1. Error de conexión a base de datos**
```
Solución: Verificar DATABASE_URL y que PostgreSQL esté corriendo
```

**2. WebSocket no conecta**
```
Solución: Verificar que WebSockets estén habilitados en Azure App Service
```

**3. Tools no se ejecutan**
```
Solución: Verificar que MCP Server esté corriendo y que la tool esté activa
```

**4. LLM no responde**
```
Solución: Verificar API keys y que el proveedor esté activo en llm_configs
```

### Logs

**Ubicación:**
- Backend: `backend/api-service/logs/`
- Azure: Log Stream en Azure Portal
- Docker: `docker logs <container-name>`

**Niveles:**
- `error` - Errores críticos
- `warn` - Advertencias
- `info` - Información general
- `debug` - Información detallada

---

## 📊 Monitoreo

### Métricas Disponibles

**Dashboard:**
- Total de conversaciones
- Total de mensajes
- Usuarios activos (24h)
- Costo total (24h)
- Mensajes por minuto
- Tiempo promedio de respuesta

**Analytics:**
- Volumen de mensajes por tiempo
- Tiempo de respuesta (avg, p95)
- Costos diarios
- Distribución por canal
- Uso de LLM providers

### Health Checks

**Endpoint:** `GET /api/admin/health`

**Respuesta:**
```json
{
  "status": "healthy",
  "services": {
    "database": "up",
    "redis": "up",
    "llm_gateway": "up"
  }
}
```

---

## 📝 Notas Adicionales

### Zona Horaria

El sistema usa **UTC-5 (Ecuador)** como zona horaria predeterminada para:
- Filtros de fecha en Dashboard
- Analytics y reportes
- Timestamps en conversaciones

### Escalabilidad

**Horizontal Scaling:**
- Múltiples instancias de API Service
- Load balancer en frontend
- Redis compartido para contexto
- PostgreSQL con conexiones pool

**Vertical Scaling:**
- Aumentar recursos de App Service
- Escalar PostgreSQL tier
- Aumentar memoria de Redis

---

**Última actualización:** Diciembre 2025  
**Versión del documento:** 1.0.0

