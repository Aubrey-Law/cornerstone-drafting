# Slim LibreOffice + Node 22 worker for Fly / containers.
# LibreOffice writer is enough for DOCX → PDF.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-java-common \
    default-jre-headless \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
# Common path on Debian packages
ENV SOFFICE_BINARY_PATH=/usr/bin/soffice

EXPOSE 8080

CMD ["node", "server.mjs"]
