# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile TypeScript to dist/.
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime

# Run as a non-root user for defense in depth.
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

WORKDIR /app

# Copy only what the runtime needs.
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json* ./

# Install production dependencies only.
RUN npm ci --omit=dev && npm cache clean --force

# Drop privileges.
USER nodejs

# The MCP server listens on port 3000 when run as an HTTP service.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
