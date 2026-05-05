import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager

# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import AsyncSessionLocal
from api.models.user import User

# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# Telegram bot token
BOT_TOKEN = settings.TELEGRAM_BOT_TOKEN
if not BOT_TOKEN:
    logger.error("TELEGRAM_BOT_TOKEN not set in environment variables")
    exit(1)

# Base URL for API calls
API_BASE_URL = "http://api:8000/api"


async def get_user_by_telegram_token(token: str) -> User | None:
    """Find user by their Telegram linking token"""
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from datetime import datetime
        
        result = await session.execute(
            select(User).where(
                User.telegram_link_token == token,
                User.telegram_link_token_expires_at > datetime.utcnow()
            )
        )
        return result.scalar_one_or_none()


async def link_telegram_account(user_id: str, chat_id: int) -> bool:
    """Link Telegram chat ID to user account"""
    async with AsyncSessionLocal() as session:
        try:
            from sqlalchemy import update
            
            await session.execute(
                update(User)
                .where(User.id == user_id)
                .values(telegram_chat_id=chat_id)
            )
            await session.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to link Telegram account: {e}")
            await session.rollback()
            return False


async def submit_link_via_telegram(user_id: str, url: str) -> bool:
    """Submit a URL to the API on behalf of a user"""
    async with httpx.AsyncClient() as client:
        try:
            # Get user's JWT token (this would need to be stored or generated)
            # For MVP, we'll create a simple endpoint that accepts user_id
            response = await client.post(
                f"{API_BASE_URL}/telegram/submit-link",
                json={"user_id": user_id, "url": url},
                timeout=10.0
            )
            return response.status_code == 201
        except Exception as e:
            logger.error(f"Failed to submit link via Telegram: {e}")
            return False


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command with token"""
    args = context.args
    if not args:
        await update.message.reply_text(
            "👋 Welcome to Arciv bot!\n\n"
            "To link this bot to your Arciv account:\n"
            "1. Go to Settings in Arciv web app\n"
            "2. Click 'Link Telegram Bot'\n"
            "3. Copy the token and send: /start <token>\n\n"
            "You can also forward any URL to this bot to save it to Arciv."
        )
        return

    token = args[0]
    chat_id = update.effective_chat.id

    # Find user by token
    user = await get_user_by_telegram_token(token)
    if not user:
        await update.message.reply_text(
            "❌ Invalid or expired token.\n"
            "Please generate a new token from Arciv Settings."
        )
        return

    # Link the account
    success = await link_telegram_account(str(user.id), chat_id)
    if success:
        await update.message.reply_text(
            "✅ Successfully linked your Telegram account!\n\n"
            "You can now:\n"
            "• Forward any URL to save it to Arciv\n"
            "• Receive daily digests of new feed items\n\n"
            "Happy reading! 📚"
        )
    else:
        await update.message.reply_text(
            "❌ Failed to link your account. Please try again."
        )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /help command"""
    await update.message.reply_text(
        "🤖 Arciv Bot Help\n\n"
        "Commands:\n"
        "/start <token> - Link your Arciv account\n"
        "/help - Show this help message\n\n"
        "Features:\n"
        "• Forward any URL to save it to Arciv\n"
        "• Receive daily digest of new feed items\n\n"
        "Need help? Visit your Arciv Settings page."
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle incoming messages (URLs)"""
    message = update.message
    if not message or not message.text:
        return

    text = message.text.strip()
    chat_id = update.effective_chat.id

    # Check if this looks like a URL
    if not (text.startswith('http://') or text.startswith('https://')):
        await message.reply_text(
            "🔗 Please send a URL (link) to save it to Arciv.\n"
            "Example: https://example.com/article"
        )
        return

    # Find user by chat_id
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        
        result = await session.execute(
            select(User).where(User.telegram_chat_id == chat_id)
        )
        user = result.scalar_one_or_none()
        user_id = str(user.id) if user else None

    if not user_id:
        await message.reply_text(
            "❌ This Telegram account is not linked to Arciv.\n"
            "Use /start <token> to link your account first."
        )
        return

    # Submit the URL
    await message.reply_text("⏳ Saving your link...")
    success = await submit_link_via_telegram(str(user_id), text)

    if success:
        await message.reply_text(
            "✅ Link saved successfully!\n"
            "Check your Arciv account to see it."
        )
    else:
        await message.reply_text(
            "❌ Failed to save link. Please try again later."
        )


async def send_daily_digest():
    """Send daily digest to all linked users"""
    async with AsyncSessionLocal() as session:
        # Get all users with linked Telegram accounts and notifications enabled
        result = await session.execute(
            """
            SELECT u.id, u.telegram_chat_id
            FROM users u
            WHERE u.telegram_chat_id IS NOT NULL
            AND u.feed_notify_telegram = true
            """
        )
        users = result.fetchall()

    bot = Bot(token=BOT_TOKEN)
    async with httpx.AsyncClient() as client:
        for user_id, chat_id in users:
            try:
                # Get daily digest from API
                response = await client.get(
                    f"{API_BASE_URL}/telegram/daily-digest/{user_id}",
                    timeout=10.0
                )
                if response.status_code == 200:
                    digest = response.json()
                    if digest.get("items"):
                        message = "📬 Arciv Daily — {} new posts added\n\n".format(
                            len(digest["items"])
                        )
                        for item in digest["items"][:5]:  # Limit to 5 items
                            message += f"• {item['feed_name']}: \"{item['title']}\"\n"
                        message += "\nView all in Arciv →"
                        
                        await bot.send_message(chat_id=chat_id, text=message)
            except Exception as e:
                logger.error(f"Failed to send daily digest to user {user_id}: {e}")


def main() -> None:
    """Start the bot"""
    application = Application.builder().token(BOT_TOKEN).build()

    # Add handlers
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message)
    )

    # Start the bot
    logger.info("Starting Arciv Telegram bot...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
