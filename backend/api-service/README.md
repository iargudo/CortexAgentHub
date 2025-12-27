# @cortex/api-service

REST API service for CortexMCP - provides HTTP endpoints for message processing, webhooks, and admin management.

## Features

- **Message API**: Send messages and retrieve conversation history
- **Webhook Handlers**: Receive messages from WhatsApp, Telegram, and Email
- **Admin API**: Manage channels, LLMs, tools, and view analytics
- **Authentication**: JWT-based auth for admin endpoints, API key auth for message endpoints
- **Rate Limiting**: Configurable rate limits per endpoint
- **WebSocket Support**: Real-time communication support
- **Multipart Upload**: File upload support

## API Endpoints

### Public Endpoints

#### Health Check
```
GET /health
```

### Message Endpoints (requires API key)

#### Send Message
```
POST /api/v1/messages/send
Headers: X-API-Key: your-api-key

{
  "channelType": "whatsapp",
  "userId": "+1234567890",
  "content": "Hello, how can I help?",
  "metadata": {}
}
```

#### Get Conversation
```
GET /api/v1/conversations/:conversationId?limit=50
Headers: X-API-Key: your-api-key
```

#### Get User Conversations
```
GET /api/v1/conversations/user/:userId?channelType=whatsapp&limit=20
Headers: X-API-Key: your-api-key
```

#### Delete Conversation
```
DELETE /api/v1/conversations/:conversationId
Headers: X-API-Key: your-api-key
```

### Webhook Endpoints (no auth)

#### WhatsApp Webhook
```
POST /webhooks/whatsapp
```

#### Telegram Webhook
```
POST /webhooks/telegram
```

#### Email Webhook
```
POST /webhooks/email
```

### Admin Endpoints (requires JWT)

#### Dashboard Statistics
```
GET /api/admin/dashboard/stats
Headers: Authorization: Bearer your-jwt-token
```

#### System Health
```
GET /api/admin/health
Headers: Authorization: Bearer your-jwt-token
```

#### List Channels
```
GET /api/admin/channels
Headers: Authorization: Bearer your-jwt-token
```

#### Test Channel
```
POST /api/admin/channels/:channelId/test
Headers: Authorization: Bearer your-jwt-token

{
  "testMessage": "Test message"
}
```

#### List LLMs
```
GET /api/admin/llms
Headers: Authorization: Bearer your-jwt-token
```

#### List Tools
```
GET /api/admin/tools
Headers: Authorization: Bearer your-jwt-token
```

#### Get Analytics
```
GET /api/admin/analytics?startDate=2024-01-01&endDate=2024-01-07&granularity=day
Headers: Authorization: Bearer your-jwt-token
```

#### Get Logs
```
GET /api/admin/logs?level=error&limit=100
Headers: Authorization: Bearer your-jwt-token
```

## Environment Variables

```bash
# Server
API_PORT=3000
API_HOST=0.0.0.0
CORS_ORIGIN=*

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/cortex

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key-change-in-production
VALID_API_KEYS=key1,key2,key3

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60

# MCP Server
MCP_CONTEXT_TTL=3600

# Channel Adapters
# WhatsApp - Supports: ultramsg, twilio, 360dialog
WHATSAPP_PROVIDER=ultramsg
# Ultramsg configuration
WHATSAPP_ULTRAMSG_INSTANCE_ID=instance123
WHATSAPP_ULTRAMSG_TOKEN=token123
# Twilio configuration (if WHATSAPP_PROVIDER=twilio)
# WHATSAPP_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# WHATSAPP_TWILIO_AUTH_TOKEN=your_auth_token
# 360dialog configuration (if WHATSAPP_PROVIDER=360dialog)
# WHATSAPP_360DIALOG_API_KEY=D360-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# WHATSAPP_360DIALOG_PHONE_NUMBER_ID=123456789012345
# WHATSAPP_360DIALOG_WABA_ID=waba_id_optional
# Common WhatsApp settings
WHATSAPP_PHONE_NUMBER=+1234567890
WHATSAPP_WEBHOOK_URL=https://your-domain.com/webhooks/whatsapp
WHATSAPP_WEBHOOK_SECRET=your_webhook_secret_optional

TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_WEBHOOK_URL=https://your-domain/webhooks/telegram

EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your-email@gmail.com
EMAIL_SMTP_PASS=your-password
EMAIL_FROM_ADDRESS=noreply@your-domain.com

WEBCHAT_WS_PORT=8081
WEBCHAT_ALLOWED_ORIGINS=*
```

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build
pnpm build

# Start production server
pnpm start
```

## Architecture

```
APIServer
  ├── Fastify App (HTTP/WebSocket)
  ├── Database (PostgreSQL)
  ├── Redis (Context & Rate Limiting)
  ├── MCP Server (Tool Management)
  ├── LLM Gateway (Load Balancer)
  ├── AI Orchestrator (Message Processing)
  └── Channel Adapters
      ├── WhatsApp
      ├── Telegram
      ├── Email
      └── WebChat
```

## Controllers

- **MessagesController**: Handles message sending and conversation retrieval
- **WebhooksController**: Processes incoming webhooks from channels
- **AdminController**: Manages admin panel operations

## Middleware

- **authenticateJWT**: JWT token validation for admin endpoints
- **authenticateAPIKey**: API key validation for message endpoints
- **requireAdmin**: Admin role verification
- **errorHandler**: Global error handling and formatting

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage
```

## Security

- All admin endpoints require JWT authentication
- Message endpoints require API key authentication
- Webhook endpoints use channel-specific verification (signature validation)
- Rate limiting applied to all endpoints
- CORS configured with allowed origins
- SQL injection protection in database queries
- Input validation using Fastify schemas

## Production Deployment

1. Set environment variables properly
2. Use HTTPS in production
3. Configure proper CORS origins
4. Set strong JWT secret
5. Use managed databases (RDS, ElastiCache)
6. Enable request logging
7. Set up monitoring (Prometheus/Grafana)
8. Configure rate limits based on traffic

## License

MIT
