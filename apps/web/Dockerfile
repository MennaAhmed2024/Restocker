FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @restockr/shared && npm run build --workspace @restockr/web

FROM nginx:1.29-alpine
COPY infrastructure/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
HEALTHCHECK CMD wget -qO- http://127.0.0.1/health || exit 1
