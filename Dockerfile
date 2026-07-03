# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# The root postinstall script runs `quasar prepare`, which needs the
# full project (quasar.config.ts, src/, etc.) to detect the app, so
# dependencies can't be installed from just package.json/yarn.lock.
COPY . .
RUN yarn install --frozen-lockfile

# The PWA service-worker sources live in their own package
# (used by the Quasar CLI to bundle src-pwa/sw/custom-sw.ts).
RUN yarn --cwd src-pwa install --frozen-lockfile

RUN yarn quasar build -m pwa

# ---- Runtime stage ----
FROM nginx:alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/pwa /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
