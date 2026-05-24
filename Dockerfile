# Stage 1: build the React frontend.
# Pin to the native build platform — the output (HTML/JS) is arch-agnostic, so
# there's no reason to rebuild it inside an emulated arm64 container. Without
# this, multi-platform CI runs `npm ci` twice (once per arch) and the arm64
# leg can take 30+ minutes under QEMU.
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# Stage 2: Python runtime with the built frontend baked in
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Replace any local frontend/dist with the freshly-built one from stage 1
RUN rm -rf frontend/dist
COPY --from=frontend-build /frontend/dist ./frontend/dist

# Ensure the combined-startup script is executable even when authored on
# Windows (which doesn't preserve Unix exec bits across COPY).
RUN chmod +x /app/bin/start.sh

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
