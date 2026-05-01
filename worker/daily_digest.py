import asyncio
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import AsyncSessionLocal
from api.models.link import Link
from api.models.feed import Feed
from api.models.notification import Notification
from api.models.user import User

logger = logging.getLogger(__name__)


async def send_daily_digest():
    """Send daily digest to all users with Telegram notifications enabled"""
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping daily digest")
        return

    async with AsyncSessionLocal() as session:
        # Get all users with linked Telegram accounts and notifications enabled
        result = await session.execute(
            select(User).where(
                User.telegram_chat_id.isnot(None),
                User.feed_notify_telegram == True
            )
        )
        users = result.scalars().all()

    if not users:
        logger.info("No users with Telegram notifications enabled")
        return

    bot_token = settings.TELEGRAM_BOT_TOKEN
    base_url = "https://api.telegram.org"
    
    async with httpx.AsyncClient() as client:
        for user in users:
            try:
                # Get new items from the last 24 hours
                yesterday = datetime.utcnow() - timedelta(days=1)
                
                async with AsyncSessionLocal() as session:
                    result = await session.execute(
                        select(Link, Feed)
                        .join(Feed, Link.feed_id == Feed.id)
                        .where(
                            Link.user_id == user.id,
                            Link.saved_at >= yesterday,
                            Link.feed_id.isnot(None)
                        )
                        .order_by(Link.saved_at.desc())
                        .limit(10)
                    )
                    
                    items = []
                    for row in result:
                        link, feed = row
                        items.append({
                            'title': link.title or "Untitled",
                            'feed_name': feed.title or "Unknown Feed",
                            'url': link.url
                        })

                if not items:
                    continue  # No new items for this user

                # Format the digest message
                message = f"📬 Arciv Daily — {len(items)} new post{'s' if len(items) > 1 else ''} added\n\n"
                
                for item in items[:5]:  # Limit to 5 items to keep message concise
                    message += f"• {item['feed_name']}: \"{item['title']}\"\n"
                
                if len(items) > 5:
                    message += f"... and {len(items) - 5} more\n"
                
                message += "\nView all in Arciv →"

                # Send the message via Telegram bot API
                response = await client.post(
                    f"{base_url}/bot{bot_token}/sendMessage",
                    json={
                        "chat_id": user.telegram_chat_id,
                        "text": message,
                        "parse_mode": "HTML"
                    },
                    timeout=10.0
                )

                if response.status_code == 200:
                    logger.info(f"Daily digest sent to user {user.id}")
                else:
                    logger.error(f"Failed to send digest to user {user.id}: {response.text}")

            except Exception as e:
                logger.error(f"Error sending daily digest to user {user.id}: {e}")


async def create_quota_warning_notifications():
    """Create notifications for users approaching AI quota limits"""
    async with AsyncSessionLocal() as session:
        # For MVP, we'll just check shared Gemini key usage
        # In a real implementation, you'd track per-user usage
        
        # Get today's date in UTC
        today = datetime.utcnow().date()
        
        # This is a placeholder for quota checking logic
        # In a real implementation, you'd check Redis for usage counts
        pass
