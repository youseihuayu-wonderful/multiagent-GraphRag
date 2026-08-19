from __future__ import annotations

import json
import os
from pathlib import Path

from governed_rag.models import Document

PROJECT_ROOT = Path(
    os.getenv("GOVERNED_RAG_PROJECT_ROOT", str(Path(__file__).resolve().parents[2]))
)
DEFAULT_CORPUS_PATH = PROJECT_ROOT / "data" / "documents" / "financial_corpus.json"


class Corpus:
    def __init__(self, documents: list[Document]) -> None:
        self.documents = documents
        self.by_id = {document.source_id: document for document in documents}
        if len(self.by_id) != len(documents):
            raise ValueError("source_id values must be unique")

    @classmethod
    def from_json(cls, path: str | Path = DEFAULT_CORPUS_PATH) -> Corpus:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls([Document.model_validate(item) for item in payload])

    def for_domain(self, domain: str) -> list[Document]:
        return [document for document in self.documents if document.domain == domain]

    def validate_quote(self, source_id: str, quote: str) -> bool:
        document = self.by_id.get(source_id)
        if not document:
            return False
        normalized_quote = " ".join(quote.lower().split())
        normalized_text = " ".join(document.text.lower().split())
        return normalized_quote in normalized_text
