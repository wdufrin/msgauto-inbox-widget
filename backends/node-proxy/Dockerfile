FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY packages/omnibar-wc/dist ./packages/omnibar-wc/dist
COPY examples ./examples
COPY backends/node-proxy ./backends/node-proxy

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "backends/node-proxy/server.js"]
