"""Prerequisite processing pipeline: topic extraction, graph building, validation, and storage."""

from tutor.prerequisite_processing.graph_builder import (
    generate_prerequisite_graph,
    generate_prerequisite_graph_weighted,
)
from tutor.prerequisite_processing.pipeline import PrerequisiteGenerator
from tutor.prerequisite_processing.storage import save_prerequisites_to_mongodb
from tutor.prerequisite_processing.text_cleaning import (
    clean_extracted_text,
    get_safe_filename,
    split_text_into_representative_windows,
)
from tutor.prerequisite_processing.topic_extraction import (
    canonicalize_lexical_name,
    deduplicate_and_filter_topics,
    deduplicate_and_filter_topics_with_metadata,
    extract_candidate_topics_from_chunk,
    extract_topics_with_metadata,
    normalize_topic_name,
    parse_json_safely,
)
from tutor.prerequisite_processing.validation import (
    break_cycles,
    remove_transitive_redundancies,
    validate_and_sanitize_graph,
    validate_and_sanitize_graph_with_details,
)

__all__ = [
    "PrerequisiteGenerator",
    "clean_extracted_text",
    "get_safe_filename",
    "split_text_into_representative_windows",
    "parse_json_safely",
    "normalize_topic_name",
    "canonicalize_lexical_name",
    "deduplicate_and_filter_topics",
    "deduplicate_and_filter_topics_with_metadata",
    "extract_candidate_topics_from_chunk",
    "extract_topics_with_metadata",
    "generate_prerequisite_graph",
    "generate_prerequisite_graph_weighted",
    "break_cycles",
    "remove_transitive_redundancies",
    "validate_and_sanitize_graph",
    "validate_and_sanitize_graph_with_details",
    "save_prerequisites_to_mongodb",
]
