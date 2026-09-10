FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV DOCKER_BUILD=1
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    iputils-ping python3 python3-pip \
    && pip3 install 'impacket==0.12.0' --break-system-packages \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY backend/wmiexec.py /usr/local/bin/wmiexec.py
RUN chmod +x /usr/local/bin/wmiexec.py

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /fe/dist ./public

ENV NODE_ENV=production
ENV WMIEXEC_PATH=/usr/local/bin/wmiexec.py
RUN mkdir -p logs && chown -R node:node /app
USER node

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/app.js"]
