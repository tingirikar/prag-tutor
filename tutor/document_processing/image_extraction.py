"""Extracts diagrams and illustrations from PDFs with heuristic quality filtering."""

import io
import json
import os
import shutil
from typing import Any, Dict, List, Tuple

try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None

try:
    from PIL import Image, ImageStat
except ImportError:
    Image = None
    ImageStat = None


def is_quality_image(
    img,
    min_entropy: float = 1.5,
    min_std_dev: float = 15.0,
    min_unique_ratio: float = 0.002,
) -> Tuple[bool, float, str]:
    """Checks if an image is a meaningful diagram/figure vs junk.

    Returns (is_good: bool, quality_score: float, reason: str).

    Filters out:
      - Solid color blocks (low entropy + low std dev)
      - Near-blank or gradient fills (low unique color ratio)
      - Extremely thin/wide decorators (bad aspect ratio)
      - Repeated watermark-style patterns
    """
    if Image is None or ImageStat is None:
        return True, 1.0, "quality check unavailable"

    try:
        w, h = img.size

        # 1. Aspect ratio check — reject extreme aspect ratios (borders, lines)
        aspect = max(w, h) / max(min(w, h), 1)
        if aspect > 8.0:
            return False, 0.0, f"extreme aspect ratio ({aspect:.1f}:1)"

        # 2. Convert to RGB for consistent analysis
        analysis_img = img.convert("RGB") if img.mode != "RGB" else img

        # 3. Entropy — measures information content
        #    Solid color -> ~0, rich diagram -> 4-7+
        entropy = analysis_img.entropy()
        if entropy < min_entropy:
            return False, entropy / 7.0, f"low entropy ({entropy:.2f})"

        # 4. Standard deviation of pixel values
        stat = ImageStat.Stat(analysis_img)
        avg_std = sum(stat.stddev) / len(stat.stddev)
        if avg_std < min_std_dev:
            return False, avg_std / 80.0, f"low contrast (std_dev={avg_std:.1f})"

        # 5. Unique color density — sample center crop to check diversity
        sample = analysis_img.copy()
        sample.thumbnail((100, 100), Image.NEAREST)
        colors = sample.getcolors(maxcolors=10001)
        if colors is not None:
            total_pixels = sample.size[0] * sample.size[1]
            unique_ratio = len(colors) / max(total_pixels, 1)
            if unique_ratio < min_unique_ratio:
                return (
                    False,
                    unique_ratio,
                    f"too few unique colors ({len(colors)} in {total_pixels}px)",
                )

        # Compute composite quality score (0.0 - 1.0)
        entropy_score = min(entropy / 7.0, 1.0)
        std_score = min(avg_std / 80.0, 1.0)
        quality_score = round((entropy_score * 0.6 + std_score * 0.4), 3)

        return True, quality_score, "ok"

    except Exception as e:
        return True, 0.5, f"analysis error: {e}"


def extract_images_from_pdf(
    pdf_file: str,
    pdf_name: str,
    subject: str,
    pdf_dir: str = "",
) -> List[Dict[str, Any]]:
    """Extracts embedded images from a PDF using PyMuPDF.

    Saves images to {pdf_dir}/{subject}/images/{safe_name}/ and creates an
    image_index.json.
    Returns the image index data.
    """
    if fitz is None or Image is None:
        print(
            f"[Notice] Skipping image extraction for '{pdf_name}' (PyMuPDF or Pillow not available)."
        )
        return []

    if not subject or not str(subject).strip():
        raise ValueError("Subject is required for image extraction.")

    from pathlib import Path

    stem = Path(pdf_name).stem.replace(" ", "_")
    safe_subject = str(subject).strip().lower()
    doc_images_dir = os.path.join(pdf_dir, safe_subject, "images", stem)

    # Clean previous extraction
    if os.path.exists(doc_images_dir):
        shutil.rmtree(doc_images_dir)
    os.makedirs(doc_images_dir, exist_ok=True)

    image_index = []

    try:
        doc = fitz.open(pdf_file)
        image_count = 0

        for page_num in range(len(doc)):
            page = doc[page_num]
            image_list = page.get_images(full=True)

            for img_idx, img_info in enumerate(image_list):
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    width = base_image.get("width", 0)
                    height = base_image.get("height", 0)

                    # Skip tiny images (likely icons/bullets/decorations)
                    if width < 50 or height < 50:
                        continue

                    # Skip very small file sizes (likely spacer images)
                    if len(image_bytes) < 2000:
                        continue

                    img = Image.open(io.BytesIO(image_bytes))
                    if img.mode not in ("RGB", "RGBA"):
                        img = img.convert("RGB")

                    # Quality check — reject junk images
                    is_good, quality_score, reason = is_quality_image(img)
                    if not is_good:
                        print(
                            f"    Skipped bad image page {page_num} img {img_idx}: {reason}"
                        )
                        continue

                    # Resize if too large (max 800px on longest side) to save space
                    max_dim = 800
                    if max(img.size) > max_dim:
                        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

                    image_count += 1
                    img_filename = f"{stem}_img{image_count}.jpg"
                    img_path = os.path.join(doc_images_dir, img_filename)
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img.save(img_path, "JPEG", quality=90, optimize=True)

                    image_index.append(
                        {
                            "filename": img_filename,
                            "page_number": page_num,
                            "width": width,
                            "height": height,
                            "size_bytes": len(image_bytes),
                            "quality_score": quality_score,
                            "path": f"{safe_subject}/images/{stem}/{img_filename}",
                        }
                    )

                except Exception as img_err:
                    print(
                        f"  [Notice] Could not extract image {img_idx} from page {page_num}: {img_err}"
                    )
                    continue

        doc.close()

        # Persist extracted images manifest directly into MongoDB Atlas
        try:
            from tutor.config import get_db
            db = get_db()
            if db is not None:
                clean_subj = safe_subject.upper()
                db.documents.update_one(
                    {"name": pdf_name, "subject": clean_subj},
                    {
                        "$set": {
                            "extractedImages": image_index,
                            "imageCount": image_count,
                        }
                    },
                    upsert=True,
                )
        except Exception as db_err:
            print(f"  [Notice] Could not update MongoDB document image index: {db_err}")

        # Ensure no legacy image_index.json remains on disk
        legacy_index = os.path.join(doc_images_dir, "image_index.json")
        if os.path.exists(legacy_index):
            try:
                os.remove(legacy_index)
            except Exception:
                pass

        print(
            f"  Extracted {image_count} image(s) from '{pdf_name}' for subject '{safe_subject}'."
        )
        return image_index

    except Exception as e:
        print(f"  [Warning] Image extraction failed for '{pdf_name}': {e}")
        return []
