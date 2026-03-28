# --- STAGE 1: Build Frontend ---
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- STAGE 2: Build Backend ---
FROM node:18-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./

# --- STAGE 3: Final Production Image ---
FROM node:18-alpine
WORKDIR /app

# Copy built frontend assets to a location the backend can serve
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy backend source
COPY --from=backend-builder /app/backend ./backend

# Set working directory to backend
WORKDIR /app/backend

# Ensure environment variables are handled (Cloud Run normally injects these)
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
