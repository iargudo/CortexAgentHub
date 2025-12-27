# @cortex/admin-frontend

Admin panel for CortexAgentHub - Built with React, TypeScript, Vite, and Tailwind CSS.

## Features

- **Dashboard**: Real-time metrics, system health, channel distribution, LLM usage
- **Channels**: Manage and configure communication channels (WhatsApp, Telegram, Email, WebChat)
- **LLMs**: Configure LLM providers, view performance metrics, manage priorities
- **Tools**: Manage MCP tools, view execution statistics, configure permissions
- **Analytics**: Historical data visualization with charts (message volume, response time, costs)
- **Logs**: Real-time log viewer with filtering and auto-refresh
- **Playground**: Interactive testing environment for sending messages and viewing responses

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **React Router** for navigation
- **TanStack Query** (React Query) for data fetching
- **Recharts** for data visualization
- **Lucide React** for icons
- **Axios** for API calls

## Installation

```bash
pnpm install
```

## Development

```bash
# Start development server
pnpm dev

# Open in browser at http://localhost:5173
```

## Build

```bash
# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Environment Variables

Create a `.env` file:

```bash
VITE_API_URL=http://localhost:3000
```

## Project Structure

```
src/
├── components/
│   └── Layout.tsx          # Main layout with sidebar navigation
├── pages/
│   ├── Dashboard.tsx       # Dashboard with metrics and charts
│   ├── Channels.tsx        # Channel management
│   ├── LLMs.tsx            # LLM provider management
│   ├── Tools.tsx           # MCP tools management
│   ├── Analytics.tsx       # Analytics charts
│   ├── Logs.tsx            # Log viewer
│   └── Playground.tsx      # Interactive testing
├── services/
│   └── api.ts              # API client with Axios
├── styles/
│   └── index.css           # Global styles and Tailwind
├── App.tsx                 # Main app with routing
└── main.tsx                # Entry point
```

## API Integration

The frontend connects to the CortexAgentHub API at `http://localhost:3000` (configurable via environment variables).

### API Endpoints Used

- `GET /api/admin/dashboard/stats` - Dashboard statistics
- `GET /api/admin/health` - System health check
- `GET /api/admin/channels` - Channel configurations
- `GET /api/admin/llms` - LLM provider configurations
- `GET /api/admin/tools` - MCP tools list
- `GET /api/admin/analytics` - Analytics data
- `GET /api/admin/logs` - System logs
- `POST /api/v1/messages/send` - Send test messages

## Features by Page

### Dashboard
- Real-time system metrics (conversations, messages, users, costs)
- System health status with service indicators
- Channel distribution pie chart
- LLM provider usage bar chart
- Top tools table
- Real-time metrics (messages/min, avg response time, uptime)

### Channels
- View all configured channels
- Enable/disable channels
- View channel statistics (messages received/sent, response time)
- Test channel connections
- Configure channel settings

### LLMs
- View all LLM provider configurations
- Enable/disable providers
- View performance metrics (requests, latency, cost, error rate)
- Configure provider priority
- Test provider connections

### Tools
- View all MCP tools
- Enable/disable tools
- View execution statistics
- Configure tool permissions
- View allowed channels per tool

### Analytics
- Message volume over time (line chart)
- Response time trends (avg and P95)
- Daily cost trends
- Configurable date ranges (24h, 7d, 30d)

### Logs
- Real-time log streaming (auto-refresh every 5s)
- Filter by log level (error, warn, info, debug)
- Expandable metadata for each log entry
- Color-coded by severity
- Timestamps and structured display

### Playground
- Interactive chat interface
- Configure channel type and user ID
- Send test messages
- View LLM responses with metadata
- See token usage, costs, and tool executions
- Conversation history

## Styling

Uses Tailwind CSS with custom utility classes:

```css
.card          - White card with shadow
.btn           - Base button
.btn-primary   - Primary action button
.btn-secondary - Secondary button
.btn-danger    - Danger/delete button
.input         - Form input
.badge         - Badge/tag
.badge-success - Success badge (green)
.badge-warning - Warning badge (yellow)
.badge-error   - Error badge (red)
.badge-info    - Info badge (blue)
```

## Data Fetching

Uses TanStack Query for all API calls with:
- Automatic refetching (configurable per query)
- Caching with 30s stale time
- Loading and error states
- Optimistic updates

Example:
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['dashboard-stats'],
  queryFn: () => api.getDashboardStats(),
  refetchInterval: 30000, // Refresh every 30s
});
```

## Authentication

Currently uses a placeholder JWT authentication system. In production:

1. User logs in and receives JWT token
2. Token stored in localStorage
3. Axios interceptor adds token to all requests
4. 401 responses redirect to login page

## Responsive Design

- Fully responsive for desktop, tablet, and mobile
- Sidebar collapses on mobile
- Charts adjust to container size
- Grid layouts adapt to screen size

## Performance

- Vite for fast HMR during development
- Code splitting with React Router
- Lazy loading for routes (can be added)
- Optimized bundle size
- React Query caching reduces API calls

## Customization

### Colors

Modify `tailwind.config.js` to change the primary color scheme:

```js
theme: {
  extend: {
    colors: {
      primary: {
        // Your custom colors
      },
    },
  },
},
```

### API URL

Change API endpoint in `.env`:

```
VITE_API_URL=https://your-production-api.com
```

## Production Deployment

```bash
# Build for production
pnpm build

# Dist folder contains optimized static files
# Deploy to:
# - Netlify
# - Vercel
# - AWS S3 + CloudFront
# - Any static hosting
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

MIT
