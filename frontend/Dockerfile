# Dockerfile para Admin Frontend
FROM node:20-alpine AS build

# Instalar pnpm (versión 9 para compatibilidad con lockfile 9.0)
RUN npm install -g pnpm@9

WORKDIR /app

# Copiar archivos de configuración
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./

# Copiar packages necesarios
COPY backend/packages/shared ./backend/packages/shared
COPY frontend ./frontend

# Instalar dependencias
RUN pnpm install --frozen-lockfile || pnpm install

# Construir shared (si tiene dependencias)
RUN pnpm --filter @cortex/shared build || true

# Construir el frontend con variables de entorno de build
# Las variables VITE_* deben pasarse como ARG y luego ENV para que estén disponibles en build time
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app/frontend

# Construir la aplicación
RUN pnpm build

# Stage de producción con nginx
FROM nginx:alpine AS production

# Copiar archivos construidos
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Copiar configuración de nginx personalizada con MIME types correctos
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

