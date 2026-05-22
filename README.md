# Arciv — Smart Link Organizer

> **Arciv** helps you save, organize, and get AI-powered summaries of links from across the web. Subscribe to blogs and get daily digests via Telegram.

![Arciv Screenshot](docs/images/screenshot-main.png)

## ✨ Features

- **🔗 Smart Link Saving** — Paste any URL, get automatic metadata extraction and AI classification
- **🤖 AI-Powered Organization** — Links are automatically categorized into Watch Later, Read Later, Try Later, or Inbox
- **📝 AI Summaries** — Get concise 2-3 sentence summaries of articles and content
- **📡 Blog Feed Tracking** — Subscribe to RSS/Atom feeds, get daily updates
- **📱 Telegram Integration** — Save links by forwarding to bot, receive daily digests
- **🔔 Smart Notifications** — In-app and Telegram notifications for new content
- **🏠 Self-Hosted** — Your data stays private, docker-compose deployment

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- 5 minutes of free time

### 1. Clone and Setup

```bash
git clone https://github.com/yourusername/arciv.git
cd arciv
cp .env.example .env
```

### 2. Configure Environment

Generate secure secrets:

```bash
openssl rand -hex 32  # Copy to SECRET_KEY in .env
openssl rand -hex 32  # Copy to ENCRYPTION_KEY in .env
```

Optional but recommended:
- Get a free Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
- Create a Telegram bot with [@BotFather](https://t.me/BotFather)

Add these to your `.env` file.

### 3. Launch Arciv

```bash
docker compose up -d
```

That's it! Arciv will be running at http://localhost:8000

### 4. First Steps

1. **Create an account** at http://localhost:8000
2. **Save your first link** — paste any URL in the input bar
3. **Configure AI** — Go to Settings to add your AI provider key
4. **Subscribe to feeds** — Add your favorite blogs in the Feeds section
5. **Link Telegram** — Generate a token in Settings to connect the bot

## 📸 Screenshots

### Main Interface
![Main Interface](docs/images/screenshot-main.png)
*Clean, focused interface for saving and organizing links*

### AI-Powered Classification
![AI Classification](docs/images/screenshot-ai.png)
*Links are automatically categorized with AI summaries and tags*

### Feed Management
![Feed Management](docs/images/screenshot-feeds.png)
*Subscribe to blogs and track new content automatically*

### Telegram Integration
![Telegram Bot](docs/images/screenshot-telegram.png)
*Save links by forwarding and receive daily digests*

## 🏗️ Architecture

Arciv is built with modern, reliable technologies:

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | Python + FastAPI | Async API with automatic documentation |
| **Database** | PostgreSQL | Reliable data storage with full-text search |
| **Queue** | Redis + ARQ | Persistent job processing for AI and feeds |
| **Frontend** | React + Vite + TailwindCSS | Modern, responsive web interface |
| **AI** | Multiple Providers | Gemini, Groq, Claude, OpenAI, Ollama support |
| **Bot** | python-telegram-bot | Telegram integration for notifications |

## 🔧 Configuration

### Environment Variables

See `.env.example` for all configuration options. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection for job queue |
| `SECRET_KEY` | ✅ | JWT signing key (generate with `openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | ✅ | AES-256 key for API keys (generate with `openssl rand -hex 32`) |
| `TELEGRAM_BOT_TOKEN` | ❌ | Bot token for Telegram integration |
| `SHARED_GEMINI_KEY` | ❌ | Shared Gemini key for free tier users |

### AI Providers

Arciv supports multiple AI providers:

1. **Google Gemini** (Free tier available)
2. **Groq** (Fast inference, free tier)
3. **Anthropic Claude** (Paid, high quality)
4. **OpenAI GPT** (Paid)
5. **Ollama** (Local, self-hosted)

Users can select their preferred provider in Settings.

## 📡 Telegram Bot Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Copy the bot token to `TELEGRAM_BOT_TOKEN` in `.env`
3. Restart Arciv: `docker compose restart bot`
4. In Arciv Settings, generate a linking token
5. Send `/start <token>` to your bot

**Bot Features:**
- Save links by forwarding URLs
- Receive daily digests of new feed items
- Get notifications about feed updates

## 🔄 Daily Feed Polling

Arciv automatically checks all subscribed feeds for new content:

- **Default schedule**: Daily at 08:00 UTC
- **Configurable**: Set any cron schedule via `FEED_POLL_CRON`
- **Smart polling**: Uses ETags and Last-Modified headers to avoid unnecessary requests
- **Failure handling**: Automatic retry with exponential backoff

## 🛠️ Development

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt
npm install

# Start database and Redis
docker compose up db redis -d

# Run database migrations
alembic upgrade head

# Start API server
uvicorn api.main:app --reload

# Start worker (in another terminal)
python -m arq worker.worker.WorkerSettings

# Start frontend (in another terminal)
cd frontend && npm run dev

# Start bot (optional)
python bot/main.py
```

### Database Migrations

```bash
# Create new migration
alembic revision --autogenerate -m "Description"

# Apply migrations
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

### Adding New AI Providers

1. Create provider class in `api/utils/ai_providers/`
2. Implement the `AIProvider` interface
3. Add to provider list in Settings
4. Update documentation

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:8000/health
```

Returns system status including API, database, Redis, and last feed poll time.

### Logs

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f bot
```

## 🔒 Security

- **API Keys**: Encrypted at rest with AES-256
- **Authentication**: JWT tokens with configurable expiration
- **Rate Limiting**: 30 links per user per hour
- **Input Validation**: All URLs are validated and canonicalized
- **Database**: All queries scoped to authenticated users

## 🚀 Deployment

### Production Deployment

1. **Update `.env`**:
   ```env
   ENVIRONMENT=production
   SECRET_KEY=<your-secure-secret>
   ENCRYPTION_KEY=<your-secure-encryption-key>
   ```

2. **Deploy with Docker Compose**:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

3. **Set up reverse proxy** (nginx, Caddy, etc.) to handle HTTPS

### Environment Considerations

- **Memory**: Minimum 2GB RAM recommended
- **Storage**: 10GB minimum for database growth
- **Network**: Stable internet connection for AI APIs and feed polling

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Run the test suite: `pytest`
5. Submit a pull request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/arciv/issues)
- **Documentation**: [docs/](docs/)
- **Community**: [Discussions](https://github.com/yourusername/arciv/discussions)

## 🗺️ Roadmap

### v0.2.0 (Planned)
- [ ] Full-text search
- [ ] Topic clustering
- [ ] Browser extension
- [ ] Data export functionality

### v0.3.0 (Future)
- [ ] Multi-user support
- [ ] Advanced analytics
- [ ] Mobile app
- [ ] OAuth providers

---

**Built with ❤️ for people who love to read and learn**
