"""Key-custody invariants (NFR-PUB-05).

A user's provider API key is the single most sensitive thing this app stores, and
the rotation path is easy to break silently: a rotation that can't decrypt old
blobs locks every user out of AI until they re-enter their key.
"""
import base64

import pytest

from api.utils.encryption import (
    _ENVELOPE_PREFIX,
    decrypt_secret,
    encrypt_secret,
    encrypt_value,
    mask_api_key,
    rewrap_secret,
)

# Deliberately low-entropy and obviously fake: a realistic-looking key literal
# here trips the repo's gitleaks pre-commit hook, and a scanner that cries wolf
# on test fixtures is a scanner people start ignoring.
PLAINTEXT = "not-a-real-key"


def test_envelope_round_trip():
    blob = encrypt_secret(PLAINTEXT)
    assert blob.startswith(_ENVELOPE_PREFIX)
    assert PLAINTEXT not in blob
    assert decrypt_secret(blob) == PLAINTEXT


def test_envelope_blob_carries_active_kek_id(monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "ENCRYPTION_KEY_ID", "7")
    assert encrypt_secret(PLAINTEXT).split(":")[2] == "7"


def test_each_encryption_uses_a_fresh_data_key():
    """Two encryptions of the same plaintext must not produce the same blob —
    otherwise equal ciphertexts leak that two users share a key."""
    assert encrypt_secret(PLAINTEXT) != encrypt_secret(PLAINTEXT)


def test_legacy_blob_still_decrypts(monkeypatch):
    """Rows written before envelope encryption must keep working."""
    from api.config import settings

    legacy = encrypt_value(PLAINTEXT, settings.ENCRYPTION_KEY)
    assert not legacy.startswith(_ENVELOPE_PREFIX)
    assert decrypt_secret(legacy) == PLAINTEXT


def test_rotation_decrypts_old_blobs_and_rewraps_under_new_kek(monkeypatch):
    from api.config import settings

    old_key, old_id = settings.ENCRYPTION_KEY, settings.ENCRYPTION_KEY_ID
    old_blob = encrypt_secret(PLAINTEXT)

    # Operator rotates: new active KEK, previous one retired but still available.
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "a-brand-new-master-key")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY_ID", "2")
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_RETIRED", f"{old_id}:{old_key}")

    # Old blob is readable through the retired KEK...
    assert decrypt_secret(old_blob) == PLAINTEXT
    # ...and rewrapping moves it onto the new KEK without the user re-entering it.
    new_blob = rewrap_secret(old_blob)
    assert new_blob.split(":")[2] == "2"
    assert decrypt_secret(new_blob) == PLAINTEXT

    # Once the retired key is dropped, only rewrapped blobs remain readable.
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_RETIRED", "")
    assert decrypt_secret(new_blob) == PLAINTEXT
    with pytest.raises(ValueError):
        decrypt_secret(old_blob)


def test_legacy_blob_rewraps_during_rotation(monkeypatch):
    """The rotation script must not choke on pre-envelope rows."""
    from api.config import settings

    old_key, old_id = settings.ENCRYPTION_KEY, settings.ENCRYPTION_KEY_ID
    legacy = encrypt_value(PLAINTEXT, old_key)

    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "second-generation-master-key")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY_ID", "2")
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_RETIRED", f"{old_id}:{old_key}")

    rewrapped = rewrap_secret(legacy)
    assert rewrapped.startswith(f"{_ENVELOPE_PREFIX}2:")
    assert decrypt_secret(rewrapped) == PLAINTEXT


def test_wrong_key_cannot_decrypt(monkeypatch):
    from api.config import settings

    blob = encrypt_secret(PLAINTEXT)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "an-unrelated-key")
    with pytest.raises(Exception):  # noqa: B017 — cryptography raises InvalidTag
        decrypt_secret(blob)


def test_unknown_kek_id_raises_rather_than_silently_failing(monkeypatch):
    blob = encrypt_secret(PLAINTEXT)
    from api.config import settings

    monkeypatch.setattr(settings, "ENCRYPTION_KEY_ID", "99")
    with pytest.raises(ValueError, match="No KEK available"):
        decrypt_secret(blob)


def test_tampered_ciphertext_is_rejected():
    """AES-GCM is authenticated: a flipped byte must fail, not decrypt to junk."""
    blob = encrypt_secret(PLAINTEXT)
    prefix, kek_id, wrapped, data = blob.split(":", 3)
    raw = bytearray(base64.b64decode(data))
    raw[-1] ^= 0x01
    tampered = f"{prefix}:{kek_id}:{wrapped}:{base64.b64encode(bytes(raw)).decode()}"
    with pytest.raises(Exception):  # noqa: B017 — InvalidTag
        decrypt_secret(tampered)


@pytest.mark.parametrize(
    "key,expected",
    [
        ("sk-1234567890abcdef", "sk-1...****"),
        ("short", "****"),
        ("exactly8", "****"),
    ],
)
def test_mask_api_key_never_leaks_the_tail(key, expected):
    masked = mask_api_key(key)
    assert masked == expected
    assert key[4:] not in masked or len(key) <= 8
