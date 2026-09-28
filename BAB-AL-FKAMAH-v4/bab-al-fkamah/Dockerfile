# BAB AL FKAMAH — image du serveur (Node.js 22)
FROM node:22-alpine
ENV NODE_ENV=production \
    TZ=Asia/Dubai \
    PORT=3000 \
    PORT_WEB=0
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY database ./database
RUN mkdir -p uploads/plats uploads/profils uploads/logo && chown -R node:node /app
USER node
EXPOSE 3000 53/udp 53/tcp
VOLUME ["/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/sante || exit 1
CMD ["node", "server/index.js"]
