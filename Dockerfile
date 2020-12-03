FROM node:14.15.0-buster AS build

# Service description
ENV DOMAIN=localhost
ENV PORT=4010
# The public port may differ when using nginx proxy
ENV PUBLIC_PORT=8080
ENV USE_IPV6=false
ENV WS_PREFIX=wss
ENV REST_PREFIX=http
# The public port may differ when using nginx proxy
ENV ROOT_PATH=''

ENV ROUTER_DIST_URL=wss://router-distributor:4020
ENV API_URL=http://digital-server:4000
ENV AUTH_URL=http://auth-server:5000

ENV RTC_MIN_PORT=40000
ENV RTC_MAX_PORT=40100
ENV LISTEN_IP=0.0.0.0

COPY package.json ./
COPY tsconfig.json ./
COPY ecosystem.config.js ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:14.15.0-buster
ENV NODE_ENV=production
COPY package.json ./
RUN npm install
COPY --from=build /dist ./dist
EXPOSE 4020
ENTRYPOINT ["node", "./dist/index.js"]
