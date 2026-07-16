# Multi-stage: vite build → nginx:alpine. Final image ~50 MB.
FROM node:20-alpine AS build

WORKDIR /app

# Deps first — cacheable layer.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/healthz || exit 1
