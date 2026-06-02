import random
import re

_ADJECTIVES = [
    "amber", "azure", "bold", "brave", "bright", "calm", "clean", "clear",
    "clever", "cool", "crisp", "dark", "deep", "deft", "distant", "early",
    "fair", "fast", "fierce", "firm", "fleet", "fluid", "fresh", "glad",
    "grand", "green", "hale", "hardy", "keen", "kind", "light", "lofty",
    "lone", "lucky", "lunar", "mellow", "mighty", "nimble", "noble", "north",
    "pale", "patient", "plain", "proud", "quick", "quiet", "rapid", "rare",
    "sage", "sharp", "silent", "silver", "sleek", "slim", "solar", "solid",
    "still", "strong", "sure", "swift", "tall", "true", "vast", "wild",
]

_NOUNS = [
    "ant", "arc", "ash", "atlas", "bear", "birch", "bloom", "brook",
    "canyon", "cedar", "cliff", "cloud", "coast", "coral", "crane",
    "creek", "dune", "elm", "falcon", "fern", "field", "finch", "fjord",
    "flint", "fox", "gale", "glen", "hawk", "heath", "heron", "hill",
    "iris", "jade", "jay", "kite", "lake", "lark", "leaf", "lynx",
    "maple", "marsh", "meadow", "mesa", "mist", "moon", "moss", "oak",
    "otter", "owl", "panda", "peak", "pine", "pond", "quill", "raven",
    "reed", "ridge", "river", "robin", "rock", "sage", "shore", "sparrow",
    "spruce", "star", "stone", "storm", "tide", "vale", "wolf", "wren",
]

_PATTERN = re.compile(r'^[a-z][a-z0-9_]{1,28}[a-z0-9]$')


def generate_username() -> str:
    adj = random.choice(_ADJECTIVES)
    noun = random.choice(_NOUNS)
    num = random.randint(1000, 9999)
    return f"{adj}_{noun}_{num}"


def validate_username(s: str) -> bool:
    if not s or len(s) < 3 or len(s) > 30:
        return False
    if not _PATTERN.match(s):
        return False
    if "__" in s:
        return False
    return True
