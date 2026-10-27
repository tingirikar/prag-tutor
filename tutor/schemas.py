"""Pydantic request models and response data classes for the FastAPI endpoints."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TopicLearnerState(BaseModel):
    topic: str
    normalized_topic: Optional[str] = None
    p_known: float = 0.20
    effective_mastery: float = 0.20
    mastered: bool = False
    needs_refresher: bool = False
    active_misconceptions: List[str] = Field(default_factory=list)


class QueryRequest(BaseModel):
    query: str = Field(min_length=1)
    topic: Optional[str] = None
    subject: str = Field(min_length=1)
    level: str = "beginner"
    history: List[Dict[str, str]] = Field(default_factory=list)
    include_image: bool = True
    image_mode: str = "notes"
    model: Optional[str] = None
    provider: Optional[str] = None
    mastered_topics: List[str] = Field(default_factory=list)
    learner_profile: List[TopicLearnerState] = Field(default_factory=list)



class ImageRequest(BaseModel):
    query: str = Field(min_length=1)
    topic: str = ""
    mode: str = "notes"
    subject: str = Field(min_length=1)


class DocumentRequest(BaseModel):
    filename: str = Field(min_length=1)
    subject: str = Field(min_length=1)


class IndexRequest(BaseModel):
    filenames: List[str] = Field(default_factory=list)
    subject: str = Field(min_length=1)


@dataclass
class ResponseResult:
    """Structured response from the RAG pipeline.

    Replaces the old ResponseResult(str) hack that subclassed str
    to carry metadata. Now it's a clean dataclass.
    """

    response: str
    topic: Optional[str] = None
    prerequisites: List[str] = field(default_factory=list)
    sources: List[Dict[str, Any]] = field(default_factory=list)
    model: Optional[str] = None
    provider: Optional[str] = None

    def __str__(self):
        return self.response


class BKTUpdateRequest(BaseModel):
    p_known: float = 0.20
    observations: List[bool] = Field(default_factory=list)
    elapsed_days: float = 0.0
    memory_stability: float = 7.0
    review_streak: int = 0
    p_learn: float = 0.15
    p_guess: float = 0.25
    p_slip: float = 0.10


class BKTUpdateResponse(BaseModel):
    prior_mastery: float
    effective_prior: float
    posterior_mastery: float
    mastered: bool
    needs_refresher: bool
    effective_mastery: float
    memory_stability: float
    review_streak: int


class MisconceptionDiagnosisRequest(BaseModel):
    topic: str = ""
    question: str = ""
    selected_answer: str = ""
    correct_answer: str = ""


class MisconceptionDiagnosisResponse(BaseModel):
    misconception: str


