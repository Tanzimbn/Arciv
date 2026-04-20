import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _derive_key(raw_key: str) -> bytes:
    return hashlib.sha256(raw_key.encode()).digest()


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


def mask_api_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "..." + "****"
