"""Independent byte-level tokenizer, no vocabulary download, no learned BPE."""

def encode(text: str) -> list[int]:
    return list(text.encode('utf-8'))


def decode(token_ids: list[int]) -> str:
    return bytes(int(t) for t in token_ids).decode('utf-8', errors='replace')
