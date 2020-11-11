FROM node:12.19.0-buster AS build

# Service description
ENV DOMAIN=localhost
ENV PORT=4010
ENV ROOT_PATH=router
ENV USE_IPV6=true

# Router distribution service
ENV ROUTER_DIST_URL=http://router-distributor:4020

# API service
ENV API_URL=http://digital-server:4000

# Auth service
ENV AUTH_URL=http://auth-server:5000

# Settings for mediasoup
ENV RTC_MIN_PORT=40000
ENV RTC_MAX_PORT=40100
ENV LISTEN_IP=127.0.0.1

COPY package.json ./
COPY tsconfig.json ./
COPY ecosystem.config.js ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:12.19.0-buster
ENV NODE_ENV=production
COPY package.json ./
RUN npm install
COPY --from=build /dist ./dist
EXPOSE 4020
ENTRYPOINT ["node", "./dist/index.js"]
