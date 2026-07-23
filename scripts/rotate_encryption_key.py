"""Re-wrap every stored provider key under the current active KEK.

Run this after rotating ``ENCRYPTION_KEY`` (see the runbook in ``.env.example``):

    1. openssl rand -hex 32                       # generate a new KEK
    2. move the current KEK into ENCRYPTION_KEYS_RETIRED as "1:<old>"
    3. set the new value as ENCRYPTION_KEY, and ENCRYPTION_KEY_ID to 2
    4. python -m scripts.rotate_encryption_key
    5. clear ENCRYPTION_KEYS_RETIRED              # old KEK no longer needed

Each secret's data key (DEK) and plaintext are preserved — only the wrapping
KEK changes — so no user has to re-enter their provider key. Idempotent: rows
already under the active KEK are simply re-wrapped again. Legacy (pre-envelope)
rows are upgraded to the envelope format in the same pass.
"""
import asyncio

from sqlalchemy import select

from api.database import AsyncSessionLocal
from api.models.user import User
from api.utils.encryption import rewrap_secret

_BATCH = 100


async def rotate() -> None:
    rewrapped = 0
    failed = 0
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(User.ai_api_key_enc.is_not(None))
        )
        users = result.scalars().all()

        for i, user in enumerate(users, start=1):
            try:
                user.ai_api_key_enc = rewrap_secret(user.ai_api_key_enc)
                rewrapped += 1
            except Exception as exc:  # noqa: BLE001 — report and continue
                failed += 1
                # Some crypto errors (e.g. InvalidTag) stringify empty, so name
                # the type — a failure here means no available KEK could decrypt
                # this row (check ENCRYPTION_KEYS_RETIRED).
                print(f"  ! user {user.id}: {type(exc).__name__}: {exc}")
            if i % _BATCH == 0:
                await session.commit()
        await session.commit()

    print(f"Re-wrapped {rewrapped} key(s); {failed} failure(s).")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(rotate())
