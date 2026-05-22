# Changelog

All notable changes to Arciv will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-02

### Added
- **Core Link Management**
  - URL input with automatic metadata extraction
  - AI-powered classification into queues (Watch Later, Read Later, Try Later, Inbox)
  - AI-generated summaries and tags
  - Manual queue overrides and tagging
  - Link deduplication with canonical URL normalization
  - Mark as done functionality with archive view

- **AI Integration**
  - Support for multiple AI providers (Gemini, Groq, Claude, OpenAI, Ollama)
  - Graceful degradation when AI is unavailable
  - URL heuristic fallback classification
  - Retry logic with exponential backoff
  - Per-user API key encryption
  - Shared Gemini key for free tier users

- **Feed Tracking**
  - RSS/Atom feed discovery from URLs
  - Daily feed polling with configurable schedule
  - Import of 10 most recent items on subscription
  - Feed failure handling with degraded/dead status
  - Manual feed refresh
  - Pause/resume feed updates

- **Notifications**
  - In-app notification bell with unread count
  - Notification panel with mark all read functionality
  - Telegram bot integration for daily digests
  - Save links by forwarding to Telegram bot
  - Configurable notification preferences

- **Telegram Bot**
  - Secure token-based account linking
  - URL submission via message forwarding
  - Daily digest messages with new feed items
  - Bot commands (/start, /help)
  - Error handling and user feedback

- **User Interface**
  - Clean, minimalist design with Tailwind CSS
  - Responsive layout for mobile and desktop
  - Queue-based filtering (All, Watch Later, Read Later, Try Later, Inbox, Archive)
  - Real-time status indicators for AI processing
  - Error states for unreachable links and failed AI processing
  - Feed status indicators (active, paused, degraded, dead)

- **Technical Features**
  - FastAPI backend with async support
  - PostgreSQL database with proper indexing
  - Redis-backed job queue with ARQ
  - JWT authentication with secure token handling
  - AES-256 encryption for API keys
  - Docker Compose deployment
  - Database migrations with Alembic
  - Health check endpoint

- **Security**
  - Rate limiting on link submission (30/hour per user)
  - User-scoped database queries
  - Encrypted API key storage
  - Input validation and URL canonicalization
  - Telegram webhook validation

### Technical Details
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, Alembic
- **Database**: PostgreSQL 16+ with proper indexes
- **Queue**: Redis 7+ with ARQ job processing
- **Frontend**: React 18+, Vite, Tailwind CSS
- **AI SDK**: Unified interface supporting multiple providers
- **Bot**: python-telegram-bot with webhook support
- **Deployment**: Docker Compose with health checks

### Performance
- Link save API responds within 500ms (AI processing async)
- Feed polling completes within 1 hour for up to 500 feeds
- Mobile-responsive design with touch-friendly interface
- Efficient database queries with proper indexing

### Known Limitations
- Single user per instance (multi-user planned for v0.2.0)
- No full-text search (planned for v0.2.0)
- No browser extension (planned for v0.2.0)
- No data export functionality (planned for v0.2.0)

### Documentation
- Comprehensive README with quickstart guide
- Detailed environment variable documentation
- Architecture overview and deployment guide
- API documentation available via FastAPI auto-docs

---

## [Unreleased]

### Planned for v0.2.0
- Full-text search with PostgreSQL
- Topic clustering and exploration
- Browser extension for easier link saving
- Data export functionality (JSON, CSV)
- Multi-user support with teams
- OAuth providers (Google, GitHub)
- Advanced analytics dashboard
- Mobile app (iOS/Android)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/arciv/issues)
- **Documentation**: [README.md](README.md)
- **Community**: [GitHub Discussions](https://github.com/yourusername/arciv/discussions)

---

**Built with ❤️ for people who love to read and learn**
