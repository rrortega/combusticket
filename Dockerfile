# ==============================================================================
# Dockerfile: FacturaGas (Web / REST API & BullMQ Queue Worker)
# Supports dual-role deployment via APP_MODE (web | worker | all)
# ==============================================================================
FROM node:20-bookworm-slim

# Install Chromium, fonts, and required native libraries for browser automation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Environment variables
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    CHROME_BIN=/usr/bin/chromium \
    CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies plus tsx for TypeScript runtime execution
RUN npm ci --omit=dev && npm install tsx typescript

# Copy application source code and assets
COPY . .

# Ensure storage directories exist with appropriate read/write permissions
RUN mkdir -p output/videos output/receipts && chmod -R 777 output

# Expose standard HTTP port
EXPOSE 4000

# Default command inspects APP_MODE / SERVICE_ROLE in src/main.ts
CMD ["npm", "start"]
