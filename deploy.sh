#!/bin/bash

# Arciv MVP Deployment Script
# This script helps you deploy Arciv with Docker Compose

set -e

echo "🚀 Arciv MVP Deployment Script"
echo "================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your configuration:"
    echo "   - Generate SECRET_KEY: openssl rand -hex 32"
    echo "   - Generate ENCRYPTION_KEY: openssl rand -hex 32"
    echo "   - Add your AI API keys (optional but recommended)"
    echo "   - Add Telegram bot token (optional)"
    echo ""
    echo "Press Enter to continue after editing .env file..."
    read -r
fi

# Check if secrets are configured
if grep -q "change_me_generate_with_openssl_rand_hex_32" .env; then
    echo "⚠️  Please configure your secrets in .env file:"
    echo "   - SECRET_KEY: openssl rand -hex 32"
    echo "   - ENCRYPTION_KEY: openssl rand -hex 32"
    echo ""
    echo "Press Enter to continue anyway (not recommended for production)..."
    read -r
fi

echo "🏗️  Building and starting Arciv..."

# Build and start the services
docker-compose up -d --build

echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
echo "🔍 Checking service status..."
docker-compose ps

# Run database migrations
echo "🗄️  Running database migrations..."
docker-compose exec api alembic upgrade head

echo ""
echo "✅ Arciv is now running!"
echo ""
echo "🌐 Access Arciv at: http://localhost:8000"
echo "📊 Health check: http://localhost:8000/health"
echo "📖 API docs: http://localhost:8000/docs"
echo ""
echo "🔧 Management commands:"
echo "   View logs: docker-compose logs -f"
echo "   Stop: docker-compose down"
echo "   Restart: docker-compose restart"
echo "   Update: git pull && docker-compose up -d --build"
echo ""
echo "📚 For more information, see README.md"
echo ""
echo "🎉 Happy reading with Arciv!"
