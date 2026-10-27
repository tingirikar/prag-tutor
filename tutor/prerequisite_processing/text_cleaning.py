"""Text cleaning, CID font ligature replacement, and filename sanitization."""

import os
import re
from typing import List

# Common PDF ligatures and font encoding artifacts
CID_REPLACEMENTS = {
    "(cid:415)": "ti",
    "(cid:427)": "tt",
    "(cid:400)": "fi",
    "(cid:401)": "fl",
    "(cid:402)": "ff",
    "(cid:403)": "ffi",
    "(cid:404)": "ffl",
    "(cid:414)": "th",
    "(cid:426)": "tr",
    "(cid:428)": "tu",
    "(cid:429)": "ty",
}


def clean_extracted_text(text: str) -> str:
    """Cleans PDF extraction artifacts such as CID font issues, ligatures, and irregular whitespace."""
    if not text:
        return ""

    # Replace known CID ligatures
    for cid, rep in CID_REPLACEMENTS.items():
        text = text.replace(cid, rep)

    # Replace any remaining (cid:XXX) with an empty string
    text = re.sub(r"\(cid:\d+\)", "", text)

    # Normalize unicode quotes and dashes
    text = text.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    text = text.replace("—", "-").replace("–", "-")

    # Normalize whitespace while preserving line structure
    lines = [line.strip() for line in text.splitlines()]
    cleaned_lines = []
    for line in lines:
        if re.match(r"^(page\s*)?\d+$", line, re.IGNORECASE):
            continue
        if line:
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines)


def get_safe_filename(name: str) -> str:
    """Converts a document name into a safe filesystem stem."""
    stem = os.path.splitext(os.path.basename(name))[0]
    # Replace non-alphanumeric chars with underscore
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", stem)
    # Collapse multiple underscores
    safe = re.sub(r"_+", "_", safe).strip("_")
    return safe or "document"


def split_text_into_representative_windows(
    text: str, max_windows: int = 4, window_chars: int = 7000
) -> List[str]:
    """Splits long cleaned document text into up to `max_windows` evenly spaced representative windows.

    If text length is within window_chars, returns [text].
    Otherwise, captures start, early-mid, late-mid, and end slices across the full document text
    so concepts from the entire document are captured without exceeding prompt context limits.
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return []

    total_len = len(cleaned)
    if total_len <= window_chars:
        return [cleaned]

    # Determine window count (2 to max_windows)
    num_windows = min(max_windows, max(2, (total_len + window_chars - 1) // window_chars))
    max_start = total_len - window_chars
    starts = [
        int(round(i * max_start / (num_windows - 1)))
        for i in range(num_windows)
    ]

    windows: List[str] = []
    seen_starts = set()
    for s in starts:
        if s in seen_starts:
            continue
        seen_starts.add(s)
        window_slice = cleaned[s : s + window_chars].strip()
        if window_slice:
            windows.append(window_slice)

    return windows or [cleaned[:window_chars]]

