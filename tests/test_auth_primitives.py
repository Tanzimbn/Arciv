"""Password policy, hashing, and access-token signing — no services needed."""
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from api.middleware.auth import create_access_token
from api.utils.security import (
    MIN_PASSWORD_LENGTH,
    hash_password,
    validate_password_strength,
    verify_password,
)
from api.utils.tokens import hash_token


@pytest.mark.parametrize("password", ["Testpass123", "aB3aaaaa", "Str0ng-Passphrase!"])
def test_acceptable_passwords_pass(password):
    assert validate_password_strength(password) == password


@pytest.mark.parametrize(
    "password,reason",
    [
        ("aB3", "at least"),
        ("a" * 7 + "B", "digit"),          # long enough, mixed case, no digit
        ("alllower123", "uppercase"),
        ("ALLUPPER123", "lowercase"),
        ("NoDigitsHere", "digit"),
        ("", "at least"),
    ],
)
def test_weak_passwords_are_rejected_with_a_useful_message(password, reason):
    with pytest.raises(ValueError, match=reason):
        validate_password_strength(password)


def test_minimum_length_boundary():
    assert MIN_PASSWORD_LENGTH == 8
    with pytest.raises(ValueError):
        validate_password_strength("Abcdef1")  # 7 chars
    assert validate_password_strength("Abcdef12")  # 8 chars


def test_hash_is_salted_and_verifiable():
    a, b = hash_password("Testpass123"), hash_password("Testpass123")
    assert a != b, "bcrypt must salt — identical hashes would leak shared passwords"
    assert verify_password("Testpass123", a)
    assert verify_password("Testpass123", b)
    assert not verify_password("Testpass124", a)


def test_hash_does_not_contain_the_password():
    assert "Testpass123" not in hash_password("Testpass123")


def test_access_token_round_trips_the_user_id():
    from api.config import settings

    user_id = uuid.uuid4()
    payload = jwt.decode(
        create_access_token(user_id), settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
    )
    assert payload["sub"] == str(user_id)
    exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    assert exp > datetime.now(timezone.utc)


def test_token_signed_with_another_secret_is_rejected():
    from api.config import settings

    token = create_access_token(uuid.uuid4())
    with pytest.raises(jwt.JWTError):
        jwt.decode(token, "a-different-secret", algorithms=[settings.ALGORITHM])


def test_expired_token_is_rejected():
    from api.config import settings

    expired = jwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        jwt.decode(expired, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def test_unsigned_token_is_not_accepted():
    """`alg: none` must not be honoured — otherwise anyone mints any user's token."""
    from api.config import settings

    def _seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    forged = f"{_seg({'alg': 'none', 'typ': 'JWT'})}.{_seg({'sub': str(uuid.uuid4())})}."
    with pytest.raises(jwt.JWTError):
        jwt.decode(forged, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def test_refresh_tokens_are_stored_as_hashes():
    """The DB never holds a usable refresh token."""
    raw = "some-raw-refresh-token"
    hashed = hash_token(raw)
    assert raw not in hashed
    assert len(hashed) == 64
    assert hash_token(raw) == hashed          # deterministic, so lookup works
    assert hash_token(raw + "x") != hashed
