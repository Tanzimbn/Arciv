"""End-to-end auth: register → verify → login → refresh rotation → reset.

The single most important assertion here is that an unverified account cannot
log in. Everything downstream (quotas, tenancy) assumes a verified identity.
"""
import pytest

from api.utils.tokens import hash_token

pytestmark = pytest.mark.integration

EMAIL = "newuser@example.com"
PASSWORD = "Testpass123"


async def _register(client, email=EMAIL, password=PASSWORD, **extra):
    return await client.post(
        "/api/auth/register", json={"email": email, "password": password, **extra}
    )


async def _verification_token(pool, redis_client) -> str:
    """Pull the raw token out of the enqueued email job's context."""
    jobs = pool.job_args("send_email_job")
    assert jobs, "register must enqueue a verification email"
    ctx = jobs[-1][3]
    token = ctx["verify_url"].split("token=")[1]
    # The token is stored hashed in Redis — never in the clear.
    assert await redis_client.exists(f"verify:{hash_token(token)}")
    return token


async def test_register_verify_login(client, app_state, redis_client):
    r = await _register(client)
    assert r.status_code == 201, r.text
    assert "verify" in r.json()["message"].lower()

    # Cannot log in before verifying.
    r = await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 403
    assert "not verified" in r.json()["detail"].lower()

    token = await _verification_token(app_state, redis_client)
    r = await client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 200

    r = await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["expires_in"] > 0

    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == EMAIL
    assert "password_hash" not in me and "ai_api_key_enc" not in me


async def test_verification_token_is_single_use(client, app_state, redis_client):
    await _register(client)
    token = await _verification_token(app_state, redis_client)
    assert (await client.post("/api/auth/verify-email", json={"token": token})).status_code == 200
    # Replaying it must fail — otherwise a leaked link stays valid forever.
    r = await client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 400


async def test_bogus_verification_token_rejected(client, app_state):
    r = await client.post("/api/auth/verify-email", json={"token": "not-a-real-token"})
    assert r.status_code == 400


async def test_duplicate_email_is_rejected(client, app_state):
    assert (await _register(client)).status_code == 201
    r = await _register(client)
    assert r.status_code == 409


async def test_weak_password_rejected_at_the_schema(client, app_state):
    r = await _register(client, password="weak")
    assert r.status_code == 422


async def test_wrong_password_does_not_reveal_whether_the_email_exists(client, app_state):
    await _register(client)
    a = await client.post("/api/auth/login", json={"email": EMAIL, "password": "Wrongpass123"})
    b = await client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "Wrongpass123"}
    )
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]


async def test_forgot_password_response_is_identical_for_unknown_emails(client, app_state):
    await _register(client)
    a = await client.post("/api/auth/forgot-password", json={"email": EMAIL})
    b = await client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json(), "differing bodies would enumerate registered users"


# --------------------------------------------------------------------------- #
# Refresh-token rotation
# --------------------------------------------------------------------------- #
async def _verified_login(client, app_state, redis_client) -> dict:
    await _register(client)
    token = await _verification_token(app_state, redis_client)
    await client.post("/api/auth/verify-email", json={"token": token})
    r = await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    return r.json()


async def test_refresh_rotates_and_invalidates_the_old_token(client, app_state, redis_client):
    tokens = await _verified_login(client, app_state, redis_client)
    old = tokens["refresh_token"]

    r = await client.post("/api/auth/refresh", json={"refresh_token": old})
    assert r.status_code == 200
    new = r.json()["refresh_token"]
    assert new != old

    # Replaying the rotated-out token must fail.
    assert (await client.post("/api/auth/refresh", json={"refresh_token": old})).status_code == 401
    # The new one works.
    assert (await client.post("/api/auth/refresh", json={"refresh_token": new})).status_code == 200


async def test_logout_revokes_the_refresh_token(client, app_state, redis_client):
    tokens = await _verified_login(client, app_state, redis_client)
    assert (
        await client.post("/api/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    ).status_code == 200
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


async def test_password_reset_kills_every_existing_session(client, app_state, redis_client):
    tokens = await _verified_login(client, app_state, redis_client)

    r = await client.post("/api/auth/forgot-password", json={"email": EMAIL})
    assert r.status_code == 200
    ctx = app_state.job_args("send_email_job")[-1][3]
    reset_token = ctx["reset_url"].split("token=")[1]

    r = await client.post(
        "/api/auth/reset-password", json={"token": reset_token, "new_password": "Newpass456"}
    )
    assert r.status_code == 200

    # Old refresh token is dead...
    r = await client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401
    # ...old password no longer works, new one does.
    assert (
        await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    ).status_code == 401
    assert (
        await client.post("/api/auth/login", json={"email": EMAIL, "password": "Newpass456"})
    ).status_code == 200


async def test_reset_token_is_single_use(client, app_state, redis_client):
    await _verified_login(client, app_state, redis_client)
    await client.post("/api/auth/forgot-password", json={"email": EMAIL})
    token = app_state.job_args("send_email_job")[-1][3]["reset_url"].split("token=")[1]
    assert (
        await client.post(
            "/api/auth/reset-password", json={"token": token, "new_password": "Newpass456"}
        )
    ).status_code == 200
    r = await client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "Another789"}
    )
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Authentication enforcement
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/links"),
        ("post", "/api/links"),
        ("get", "/api/feeds"),
        ("get", "/api/settings"),
        ("get", "/api/notifications"),
        ("get", "/api/account/export"),
    ],
)
async def test_protected_routes_reject_anonymous_callers(client, app_state, method, path):
    r = await getattr(client, method)(path, **({"json": {}} if method == "post" else {}))
    assert r.status_code in (401, 403), f"{path} is reachable without a token"


async def test_garbage_bearer_token_is_rejected(client, app_state):
    r = await client.get("/api/links", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


async def test_token_for_a_deleted_user_is_rejected(client, app_state, make_user, session_factory):
    from sqlalchemy import delete

    from api.models.user import User

    user_id, headers = await make_user()
    assert (await client.get("/api/links", headers=headers)).status_code == 200

    async with session_factory() as db:
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()

    assert (await client.get("/api/links", headers=headers)).status_code == 401
