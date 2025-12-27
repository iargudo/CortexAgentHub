# Dockerfile para API Service (Backend)
FROM node:20-alpine AS base

# Instalar pnpm globalmente (versión 9 para compatibilidad con lockfile 9.0)
RUN npm install -g pnpm@9

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración del monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./

# Copiar todos los packages necesarios
COPY backend/packages/shared ./backend/packages/shared
COPY backend/packages/database ./backend/packages/database
COPY backend/packages/core ./backend/packages/core
COPY backend/packages/llm-gateway ./backend/packages/llm-gateway
COPY backend/packages/mcp-server ./backend/packages/mcp-server
COPY backend/packages/channel-adapters ./backend/packages/channel-adapters
COPY backend/packages/queue-service ./backend/packages/queue-service
COPY backend/api-service ./backend/api-service

# Configurar pnpm para optimizar uso de espacio durante install
# Usar shamefully-hoist para reducir el tamaño del store
# IMPORTANTE: No cambiar auto-install-peers para evitar conflictos con el lockfile
RUN pnpm config set store-dir /tmp/.pnpm-store && \
    pnpm config set shamefully-hoist true

# Instalar dependencias del workspace con limpieza agresiva
# Limpiar cache después de cada paso crítico para evitar ENOSPC
# Usar --no-frozen-lockfile si hay conflictos de configuración, pero preferir frozen
RUN pnpm install --frozen-lockfile || (pnpm config set auto-install-peers true && pnpm install --frozen-lockfile) && \
    pnpm store prune && \
    # Limpiar archivos temporales pero mantener el store para builds
    rm -rf /tmp/.pnpm-store/v3/tmp || true && \
    find /tmp -type f -name "*.tgz" -delete 2>/dev/null || true

# Construir todos los packages necesarios
# Limpiar después de cada build para liberar espacio
RUN pnpm --filter @cortex/shared build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/database build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/core build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/llm-gateway build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/mcp-server build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/channel-adapters build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/queue-service build && \
    pnpm store prune || true
RUN pnpm --filter @cortex/api-service build && \
    pnpm store prune && \
    rm -rf /tmp/.pnpm-store || true

# Stage de producción
FROM node:20-alpine AS production

# Instalar pnpm (versión 9 para compatibilidad con lockfile 9.0)
RUN npm install -g pnpm@9

WORKDIR /app

# Copiar solo archivos necesarios para producción
COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/backend/packages/shared/package.json ./backend/packages/shared/
COPY --from=base /app/backend/packages/shared/dist ./backend/packages/shared/dist
COPY --from=base /app/backend/packages/database/package.json ./backend/packages/database/
COPY --from=base /app/backend/packages/database/dist ./backend/packages/database/dist
COPY --from=base /app/backend/packages/database/migrations ./backend/packages/database/migrations
COPY --from=base /app/backend/packages/core/package.json ./backend/packages/core/
COPY --from=base /app/backend/packages/core/dist ./backend/packages/core/dist
COPY --from=base /app/backend/packages/llm-gateway/package.json ./backend/packages/llm-gateway/
COPY --from=base /app/backend/packages/llm-gateway/dist ./backend/packages/llm-gateway/dist
COPY --from=base /app/backend/packages/mcp-server/package.json ./backend/packages/mcp-server/
COPY --from=base /app/backend/packages/mcp-server/dist ./backend/packages/mcp-server/dist
COPY --from=base /app/backend/packages/channel-adapters/package.json ./backend/packages/channel-adapters/
COPY --from=base /app/backend/packages/channel-adapters/dist ./backend/packages/channel-adapters/dist
COPY --from=base /app/backend/packages/queue-service/package.json ./backend/packages/queue-service/
COPY --from=base /app/backend/packages/queue-service/dist ./backend/packages/queue-service/dist
COPY --from=base /app/backend/api-service/package.json ./backend/api-service/
COPY --from=base /app/backend/api-service/dist ./backend/api-service/dist
COPY --from=base /app/backend/api-service/public ./backend/api-service/public

# Instalar solo dependencias de producción
RUN pnpm install --prod --frozen-lockfile

# Exponer puerto
EXPOSE 8080

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=8080

# Crear un archivo .env vacío para evitar errores si el código lo busca
# Las variables reales vendrán de Azure App Service configuration
RUN touch .env

# Comando para iniciar la aplicación
CMD ["node", "backend/api-service/dist/index.js"]

