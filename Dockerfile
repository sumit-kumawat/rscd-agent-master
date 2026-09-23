# syntax=docker/dockerfile:1
# UI: run `cd frontend && npm run build` before `docker compose build app` (copies into backend/public).
FROM node:20-bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
    iputils-ping python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install 'impacket==0.12.0' --break-system-packages

COPY backend/wmiexec.py /usr/local/bin/wmiexec.py
RUN chmod +x /usr/local/bin/wmiexec.py

WORKDIR /app
COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev
COPY version.txt ./version.txt
COPY backend/ ./

RUN test -f public/index.html \
 && test -n "$(ls -A public/assets 2>/dev/null)" \
 || (echo "ERROR: Missing frontend bundle. Run: cd frontend && npm run build" && exit 1)

ENV NODE_ENV=production
ENV WMIEXEC_PATH=/usr/local/bin/wmiexec.py
RUN mkdir -p logs && chown -R node:node /app
USER node

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/app.js"]
