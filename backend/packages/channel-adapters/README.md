# @cortex/channel-adapters

Multi-channel communication adapters for connecting various messaging platforms to the CortexMCP AI orchestration system.

## Features

- ✅ **WebChat**: Real-time WebSocket-based chat with JWT authentication
- ✅ **WhatsApp**: Integration via Ultramsg or Twilio
- ✅ **Telegram**: Full Telegram Bot API support with webhook handling
- ✅ **Email**: SMTP/IMAP integration with nodemailer
- ✅ **Unified Interface**: All adapters implement the same base interface
- ✅ **Session Management**: Automatic session tracking per user
- ✅ **Webhook Support**: Handle incoming messages via webhooks
- ✅ **Health Monitoring**: Built-in health checks for all adapters

## Installation

```bash
pnpm add @cortex/channel-adapters
```

## Quick Start

### WebChat (WebSocket)

```typescript
import { WebChatAdapter } from '@cortex/channel-adapters';

const adapter = new WebChatAdapter();
await adapter.initialize({
  type: 'webchat',
  name: 'Main WebChat',
  enabled: true,
  config: {
    wsPort: 3001,
    allowedOrigins: ['http://localhost:3000'],
    jwtSecret: process.env.JWT_SECRET!,
    maxConnections: 1000,
  },
});

// Listen for messages
adapter.onMessage('user123', (message) => {
  console.log('Received:', message.content);
});

// Send message
await adapter.sendMessage('user123', {
  channelUserId: 'user123',
  content: 'Hello from AI!',
});

// Get connected users
const users = adapter.getConnectedUsers();
console.log('Connected users:', users);
```

### WhatsApp (Ultramsg)

```typescript
import { WhatsAppAdapter } from '@cortex/channel-adapters';

const adapter = new WhatsAppAdapter();
await adapter.initialize({
  type: 'whatsapp',
  name: 'Business WhatsApp',
  enabled: true,
  config: {
    provider: 'ultramsg',
    apiToken: process.env.WHATSAPP_TOKEN!,
    instanceId: 'instance12345',
    phoneNumber: '+1234567890',
    webhookUrl: 'https://your-domain.com/webhooks/whatsapp',
  },
});

// Send text message
await adapter.sendMessage('+1234567890', {
  channelUserId: '+1234567890',
  content: 'Hello from AI!',
});

// Send media
await adapter.sendMedia(
  '+1234567890',
  'https://example.com/image.jpg',
  'image',
  'Check this out!'
);

// Handle webhook
app.post('/webhooks/whatsapp', async (req, res) => {
  const message = await adapter.handleWebhook(req.body);
  if (message) {
    // Process the message
    console.log('Received:', message.content);
  }
  res.sendStatus(200);
});
```

### Telegram Bot

```typescript
import { TelegramAdapter } from '@cortex/channel-adapters';

const adapter = new TelegramAdapter();
await adapter.initialize({
  type: 'telegram',
  name: 'Support Bot',
  enabled: true,
  config: {
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    webhookUrl: 'https://your-domain.com/webhooks/telegram',
    allowedUpdates: ['message', 'callback_query'],
  },
});

// Send message
await adapter.sendMessage('123456789', {
  channelUserId: '123456789',
  content: 'Hello from AI!',
  metadata: {
    parseMode: 'Markdown',
  },
});

// Send with inline keyboard
await adapter.sendMessageWithKeyboard('123456789', 'Choose an option:', [
  [
    { text: 'Option 1', callback_data: 'opt1' },
    { text: 'Option 2', callback_data: 'opt2' },
  ],
]);

// Send typing indicator
await adapter.sendTypingAction('123456789');

// Handle webhook
app.post('/webhooks/telegram', async (req, res) => {
  const message = await adapter.handleWebhook(req.body);
  if (message) {
    console.log('Received:', message.content);
  }
  res.sendStatus(200);
});
```

### Email (SMTP)

```typescript
import { EmailAdapter } from '@cortex/channel-adapters';

const adapter = new EmailAdapter();
await adapter.initialize({
  type: 'email',
  name: 'Support Email',
  enabled: true,
  config: {
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'your-email@gmail.com',
      pass: 'your-app-password',
    },
    fromAddress: 'support@yourcompany.com',
  },
});

// Send email
await adapter.sendMessage('customer@example.com', {
  channelUserId: 'customer@example.com',
  content: 'Thank you for contacting us!',
  metadata: {
    subject: 'Re: Your inquiry',
  },
});

// Send HTML email
await adapter.sendHtmlEmail(
  'customer@example.com',
  'Welcome!',
  '<h1>Welcome to our service!</h1><p>We are happy to have you.</p>'
);

// Send with attachments
await adapter.sendEmailWithAttachments(
  'customer@example.com',
  'Your Report',
  'Please find your report attached.',
  [
    {
      filename: 'report.pdf',
      path: '/path/to/report.pdf',
    },
  ]
);
```

## Base Adapter

All adapters extend `BaseChannelAdapter` which provides:

```typescript
abstract class BaseChannelAdapter {
  // Initialize the adapter
  abstract initialize(config: ChannelConfig): Promise<void>;

  // Send a message
  abstract sendMessage(userId: string, message: OutgoingMessage): Promise<void>;

  // Receive and normalize a message
  abstract receiveMessage(payload: any): NormalizedMessage;

  // Handle webhook
  abstract handleWebhook(payload: any): Promise<NormalizedMessage | null>;

  // Health check
  abstract isHealthy(): Promise<boolean>;

  // Shutdown
  abstract shutdown(): Promise<void>;

  // Get session context
  getSessionContext(userId: string): SessionContext;
}
```

## Message Normalization

All incoming messages are normalized to a common format:

```typescript
interface NormalizedMessage {
  id: string;
  conversationId: string;
  channelType: ChannelType; // 'whatsapp' | 'telegram' | 'webchat' | 'email'
  channelUserId: string;
  role: MessageRole; // 'user' | 'assistant' | 'system'
  content: string;
  timestamp: string;
  metadata?: any;
}
```

## Session Management

Each adapter automatically tracks user sessions:

```typescript
interface SessionContext {
  sessionId: string;
  channelType: ChannelType;
  userId: string;
  startedAt: Date;
  lastActivity: Date;
  metadata: any;
}

// Get session for a user
const session = adapter.getSessionContext('user123');
console.log('Session started:', session.startedAt);
console.log('Last activity:', session.lastActivity);
```

## Webhook Setup

### WhatsApp (Ultramsg)

1. Go to your Ultramsg dashboard
2. Navigate to Settings → Webhook
3. Set webhook URL: `https://your-domain.com/webhooks/whatsapp`
4. Enable webhook events: Message received

### Telegram

Webhook is automatically set during adapter initialization if `webhookUrl` is provided.

You can also set it manually:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/webhooks/telegram"
```

### Email

Use email service webhooks (SendGrid, Mailgun, etc.) or implement IMAP polling.

## Advanced Features

### WebChat: Authentication

```typescript
// Client-side: Generate JWT token
const token = jwt.sign({ userId: 'user123' }, JWT_SECRET, { expiresIn: '24h' });

// Connect WebSocket
const ws = new WebSocket('ws://localhost:3001');

// Authenticate
ws.send(
  JSON.stringify({
    type: 'auth',
    token: token,
  })
);

// Send message
ws.send(
  JSON.stringify({
    type: 'message',
    content: 'Hello!',
    messageId: 'msg123',
  })
);
```

### WebChat: Broadcasting

```typescript
// Send message to all connected users
await adapter.broadcast('System maintenance in 5 minutes!');
```

### WhatsApp: Media Support

```typescript
// Send image
await adapter.sendMedia(userId, 'https://example.com/image.jpg', 'image', 'Caption');

// Send video
await adapter.sendMedia(userId, 'https://example.com/video.mp4', 'video');

// Send document
await adapter.sendMedia(userId, 'https://example.com/doc.pdf', 'document');

// Send location
await adapter.sendLocation(userId, 40.7128, -74.006, 'New York, NY');

// Send contact
await adapter.sendContact(userId, 'John Doe', '+1234567890');
```

### Telegram: Rich Messages

```typescript
// Inline keyboard
await adapter.sendMessageWithKeyboard(userId, 'Choose:', [
  [
    { text: 'Website', url: 'https://example.com' },
    { text: 'Contact', callback_data: 'contact' },
  ],
]);

// Photo with caption
await adapter.sendPhoto(userId, 'https://example.com/image.jpg', 'Look at this!');

// Document
await adapter.sendDocument(userId, 'https://example.com/file.pdf', 'Here is your file');

// Location
await adapter.sendLocation(userId, 40.7128, -74.006);
```

### Email: Thread Replies

```typescript
// Reply to existing email
await adapter.sendReply(
  'customer@example.com',
  'Re: Support Request',
  'We have resolved your issue.',
  '<original-message-id@example.com>',
  '<thread-references>'
);
```

## Error Handling

All adapters use standardized error handling:

```typescript
import { ChannelError, ERROR_CODES } from '@cortex/shared';

try {
  await adapter.sendMessage(userId, message);
} catch (error) {
  if (error instanceof ChannelError) {
    console.error(`Error code: ${error.code}`);
    console.error(`Channel: ${adapter.channelType}`);
  }
}
```

## Health Checks

```typescript
// Check if adapter is healthy
const isHealthy = await adapter.isHealthy();

if (!isHealthy) {
  console.error('Adapter is not healthy, reinitializing...');
  await adapter.initialize(config);
}
```

## Graceful Shutdown

```typescript
// Shutdown adapter gracefully
await adapter.shutdown();

// For WebChat, this closes all connections
// For other adapters, it cleans up resources
```

## Testing

```typescript
// Mock adapter for testing
class MockAdapter extends BaseChannelAdapter {
  readonly channelType = ChannelType.WEBCHAT;

  async sendMessage(userId: string, message: OutgoingMessage): Promise<void> {
    console.log('Mock send:', message.content);
  }

  // ... implement other methods
}
```

## Performance Considerations

- **WebChat**: Supports thousands of concurrent connections
- **WhatsApp**: Respect Ultramsg/Twilio rate limits
- **Telegram**: Bot API has built-in rate limiting
- **Email**: Use `sendBulk()` with delays for mass emails

## Security

- **WebChat**: JWT authentication required
- **WhatsApp**: Webhook secret verification
- **Telegram**: Secret token verification
- **Email**: TLS/SSL encryption

## TypeScript Support

Full TypeScript support with comprehensive type definitions.

## License

MIT
