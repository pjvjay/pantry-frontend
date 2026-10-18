# Multi-stage: vite build → nginx:alpine. Final image ~50 MB.
FROM node:20-alpine AS build

WORKDIR /app

# Deps first — cacheable layer.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/

# The release this build is. build.yml passes them (RELEASING.md in
# pantry-platform); Vite compiles them into src/version.ts and writes
# dist/version.json. A plain `docker build` leaves them empty and the
# console says "unknown".
ARG APP_VERSION=""
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_GIT_SHA=$GIT_SHA \
    VITE_BUILD_TIME=$BUILD_TIME
RUN npm run build

FROM nginx:alpine

# The same values as labels, so anyone holding only the image can find
# its commit (ARGs do not cross stages, so they are declared again).
ARG APP_VERSION=""
ARG GIT_SHA=""
ARG BUILD_TIME=""
LABEL org.opencontainers.image.title="pantry-frontend" \
      org.opencontainers.image.source="https://github.com/pjvjay/pantry-frontend" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_TIME

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/healthz || exit 1
