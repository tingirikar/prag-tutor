"""Text chunking utilities with sliding window overlap and page span tracking."""

from typing import Any, Dict, List, Set, Tuple


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 100) -> List[str]:
    """Chunks raw text into segments of approximately chunk_size characters with overlap."""
    raw_lines = [line.strip() for line in text.split("\n") if line.strip()]
    chunks = []
    current_chunk = []
    current_len = 0

    for line in raw_lines:
        if len(line) < 4:
            continue
        if current_len + len(line) > chunk_size and current_chunk:
            chunk_str = " ".join(current_chunk)
            if len(chunk_str) >= 30:
                chunks.append(chunk_str)
            # Maintain overlap
            overlap_lines = []
            accum_overlap = 0
            for prev_line in reversed(current_chunk):
                if accum_overlap + len(prev_line) <= overlap:
                    overlap_lines.insert(0, prev_line)
                    accum_overlap += len(prev_line)
                else:
                    break
            current_chunk = overlap_lines + [line]
            current_len = sum(len(l) for l in current_chunk)
        else:
            current_chunk.append(line)
            current_len += len(line)

    if current_chunk:
        chunk_str = " ".join(current_chunk)
        if len(chunk_str) >= 30:
            chunks.append(chunk_str)

    return chunks


def chunk_text_with_pages(
    pages: List[Tuple[int, str]], chunk_size: int = 600, overlap: int = 100
) -> List[Dict[str, Any]]:
    """Chunks text while tracking which page(s) each chunk came from with semantic sliding window overlap.

    Args:
        pages: List of (page_number, page_text) tuples.
        chunk_size: Maximum characters per chunk (default 600).
        overlap: Character overlap between consecutive chunks (default 100).

    Returns:
        List of dicts: [{"text": "...", "page_numbers": [0, 1]}, ...]
    """
    chunks = []
    current_chunk_lines: List[str] = []
    current_chunk_pages: Set[int] = set()
    current_len = 0

    for page_num, page_text in pages:
        raw_lines = [line.strip() for line in page_text.split("\n") if line.strip()]
        for line in raw_lines:
            if len(line) < 4:
                continue
            if current_len + len(line) > chunk_size and current_chunk_lines:
                chunk_str = " ".join(current_chunk_lines)
                if len(chunk_str) >= 30:
                    chunks.append(
                        {
                            "text": chunk_str,
                            "page_numbers": sorted(current_chunk_pages),
                        }
                    )
                # Retain trailing overlap lines to maintain semantic continuity
                overlap_lines: List[str] = []
                accum_overlap = 0
                for prev in reversed(current_chunk_lines):
                    if accum_overlap + len(prev) <= overlap:
                        overlap_lines.insert(0, prev)
                        accum_overlap += len(prev)
                    else:
                        break

                current_chunk_lines = overlap_lines + [line]
                current_chunk_pages = {page_num}
                current_len = sum(len(l) for l in current_chunk_lines)
            else:
                current_chunk_lines.append(line)
                current_chunk_pages.add(page_num)
                current_len += len(line)

    if current_chunk_lines:
        chunk_str = " ".join(current_chunk_lines)
        if len(chunk_str) >= 30:
            chunks.append(
                {
                    "text": chunk_str,
                    "page_numbers": sorted(current_chunk_pages),
                }
            )

    return chunks
