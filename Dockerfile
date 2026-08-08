FROM node:22.14-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY db ./db
COPY src ./src
COPY seed ./seed
COPY test ./test

RUN mkdir -p /data

ENV DB_FILE=/data/billing.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/web/server.js"]
