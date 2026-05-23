# Stage 1: build the React frontend
FROM node:20-alpine AS frontend-build

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

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
