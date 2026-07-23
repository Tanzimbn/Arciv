"""Secret-at-rest encryption for provider API keys.

Two layers live here:

* **Legacy** (`encrypt_value`/`decrypt_value`) — a value encrypted directly
  under a key derived from a single master secret. Kept so rows written before
  envelope encryption still decrypt.
* **Envelope** (`encrypt_secret`/`decrypt_secret`) — the current scheme. Each
  secret gets its own random 256-bit data key (DEK); the DEK is wrapped by a
  versioned key-encryption key (KEK). The stored blob carries the KEK id, so
  the master key can be rotated by re-wrapping DEKs (see
  ``scripts/rotate_encryption_key.py``) without any user re-entering their key.

Envelope blob format (all AES-256-GCM, ``nonce(12)+ciphertext`` base64'd)::

    env:v1:<kek_id>:<b64(wrapnonce+wrapped_dek)>:<b64(datanonce+ciphertext)>
"""

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_ENVELOPE_PREFIX = "env:v1:"


def _derive_key(raw_key: str) -> bytes:
    return hashlib.sha256(raw_key.encode()).digest()


# --- Legacy: direct encryption under one master key (back-compat only) -------


def encrypt_value(plaintext: str, raw_key: str) -> str:
    key = _derive_key(raw_key)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_value(encrypted: str, raw_key: str) -> str:
    key = _derive_key(raw_key)
    aesgcm = AESGCM(key)
    data = base64.b64decode(encrypted)
    nonce, ciphertext = data[:12], data[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


# --- KEK registry ------------------------------------------------------------


def _kek_registry() -> tuple[str, dict[str, bytes]]:
    """Return ``(active_kek_id, {kek_id: derived_key_bytes})``.

    The active KEK comes from ``ENCRYPTION_KEY`` / ``ENCRYPTION_KEY_ID``.
    Retired KEKs — kept only to decrypt/rewrap during rotation — are parsed
    from ``ENCRYPTION_KEYS_RETIRED`` (``id:secret,id:secret``).
    """
    from api.config import settings

    active_id = settings.ENCRYPTION_KEY_ID
    registry = {active_id: _derive_key(settings.ENCRYPTION_KEY)}

    retired = (settings.ENCRYPTION_KEYS_RETIRED or "").strip()
    if retired:
        for entry in retired.split(","):
            entry = entry.strip()
            if not entry:
                continue
            kid, _, secret = entry.partition(":")
            kid, secret = kid.strip(), secret.strip()
            if kid and secret and kid not in registry:
                registry[kid] = _derive_key(secret)
    return active_id, registry


# --- Envelope: per-record DEK wrapped by a versioned KEK ----------------------


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


def encrypt_secret(plaintext: str) -> str:
    """Envelope-encrypt ``plaintext`` under the active KEK."""
    active_id, registry = _kek_registry()
    kek = registry[active_id]

    dek = AESGCM.generate_key(bit_length=256)
    wrap_nonce = os.urandom(12)
    wrapped_dek = AESGCM(kek).encrypt(wrap_nonce, dek, None)

    data_nonce = os.urandom(12)
    ciphertext = AESGCM(dek).encrypt(data_nonce, plaintext.encode(), None)

    return (
        f"{_ENVELOPE_PREFIX}{active_id}:"
        f"{_b64(wrap_nonce + wrapped_dek)}:{_b64(data_nonce + ciphertext)}"
    )


def _decrypt_legacy(blob: str) -> str:
    """Decrypt a pre-envelope blob, trying every KEK in the registry.

    Legacy rows were AES-GCM'd under ``_derive_key(<master secret>)``. The KEK
    registry derives its keys the same way, so any active-or-retired secret can
    decrypt one. Trying retired keys too is what lets ``rewrap_secret`` migrate
    legacy rows during a key rotation instead of failing on them.
    """
    _, registry = _kek_registry()
    data = base64.b64decode(blob)
    nonce, ciphertext = data[:12], data[12:]
    last_err: Exception | None = None
    for key in registry.values():
        try:
            return AESGCM(key).decrypt(nonce, ciphertext, None).decode()
        except Exception as err:  # wrong key → InvalidTag; try the next
            last_err = err
    raise last_err or ValueError("No KEK could decrypt legacy blob")


def decrypt_secret(blob: str) -> str:
    """Decrypt an envelope blob, or fall back to the legacy scheme."""
    if not blob.startswith(_ENVELOPE_PREFIX):
        # Pre-envelope row: encrypted directly under a master key. Try the
        # active KEK and any retired ones so rotation can migrate these too.
        return _decrypt_legacy(blob)

    body = blob[len(_ENVELOPE_PREFIX) :]
    kek_id, wrapped_b64, data_b64 = body.split(":", 2)

    _, registry = _kek_registry()
    kek = registry.get(kek_id)
    if kek is None:
        raise ValueError(
            f"No KEK available for id {kek_id!r} (rotation config missing?)"
        )

    wrapped = _unb64(wrapped_b64)
    dek = AESGCM(kek).decrypt(wrapped[:12], wrapped[12:], None)

    data = _unb64(data_b64)
    return AESGCM(dek).decrypt(data[:12], data[12:], None).decode()


def rewrap_secret(blob: str) -> str:
    """Re-envelope a secret under the active KEK.

    Used by the key-rotation script: decrypts with whichever KEK the blob
    references (or the legacy path) and re-encrypts under the current active
    KEK. The plaintext key never leaves the process and the user need not
    re-enter it.
    """
    return encrypt_secret(decrypt_secret(blob))


def mask_api_key(key: str) -> str:
    """
    Masking key in (key[:4] + "..." + "****") format
    """
    if len(key) <= 8:
        return "****"
    return key[:4] + "..." + "****"
