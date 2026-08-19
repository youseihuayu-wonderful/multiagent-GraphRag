from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from urllib.request import Request, urlopen

import numpy as np
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from governed_rag.corpus import Corpus
from governed_rag.graph_retrieval import FinancialKnowledgeGraph
from governed_rag.models import Domain, GraphContext, RetrievedChunk

TOKEN_PATTERN = re.compile(
    r"[a-zA-Z][a-zA-Z0-9_-]+|[\u3400-\u9fff]|[\u3040-\u30ff]|[\uac00-\ud7af]"
)
MINIMUM_RELEVANCE_SCORE = 0.42


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())


def content_tokens(text: str) -> list[str]:
    return [token for token in tokenize(text) if token not in ENGLISH_STOP_WORDS]


class BM25Index:
    def __init__(self, documents: list[str], k1: float = 1.5, b: float = 0.75) -> None:
        self.tokenized = [content_tokens(document) for document in documents]
        self.k1 = k1
        self.b = b
        self.lengths = np.array([len(tokens) for tokens in self.tokenized], dtype=float)
        self.average_length = float(self.lengths.mean()) if len(self.lengths) else 1.0
        document_frequency: Counter[str] = Counter()
        for tokens in self.tokenized:
            document_frequency.update(set(tokens))
        count = len(self.tokenized)
        self.idf = {
            term: math.log(1 + (count - frequency + 0.5) / (frequency + 0.5))
            for term, frequency in document_frequency.items()
        }

    def score(self, query: str) -> np.ndarray:
        query_terms = content_tokens(query)
        scores = np.zeros(len(self.tokenized), dtype=float)
        for index, tokens in enumerate(self.tokenized):
            frequencies = Counter(tokens)
            denominator_length = 1 - self.b + self.b * self.lengths[index] / self.average_length
            for term in query_terms:
                frequency = frequencies.get(term, 0)
                if not frequency:
                    continue
                numerator = frequency * (self.k1 + 1)
                denominator = frequency + self.k1 * denominator_length
                scores[index] += self.idf.get(term, 0.0) * numerator / denominator
        return scores


class OllamaEmbedder:
    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.model = model or os.getenv("OLLAMA_EMBEDDING_MODEL", "qwen3-embedding:latest")
        resolved_url = base_url or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        self.url = f"{resolved_url.rstrip('/')}/api/embed"

    def embed(self, texts: list[str]) -> np.ndarray:
        request = Request(
            self.url,
            data=json.dumps({"model": self.model, "input": texts}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=120) as response:  # noqa: S310 - configured local endpoint
            payload = json.load(response)
        if payload.get("error"):
            raise RuntimeError(f"Ollama embedding failed: {payload['error']}")
        return np.asarray(payload["embeddings"], dtype=float)


class HybridRetriever:
    """Graph-aware BM25 + vector retrieval with auditable score fusion."""

    def __init__(
        self,
        corpus: Corpus,
        lexical_weight: float = 0.38,
        title_weight: float = 0.12,
        graph_weight: float = 0.18,
        embedding_backend: str = "tfidf",
    ) -> None:
        if lexical_weight + title_weight + graph_weight >= 1:
            raise ValueError("retrieval weights must leave a positive vector weight")
        self.corpus = corpus
        self.lexical_weight = lexical_weight
        self.title_weight = title_weight
        self.graph_weight = graph_weight
        self.embedding_backend = embedding_backend
        self.minimum_relevance_score = MINIMUM_RELEVANCE_SCORE
        self.knowledge_graph = FinancialKnowledgeGraph.from_json(corpus)
        texts = [f"{document.title}. {document.text}" for document in corpus.documents]
        self.bm25 = BM25Index(texts)
        if embedding_backend == "ollama":
            self.embedder = OllamaEmbedder()
            self.vectorizer = None
            self.document_vectors = self.embedder.embed(texts)
        elif embedding_backend == "tfidf":
            self.embedder = None
            self.vectorizer = TfidfVectorizer(
                ngram_range=(1, 2), stop_words="english", sublinear_tf=True
            )
            self.document_vectors = self.vectorizer.fit_transform(texts)
        else:
            raise ValueError("embedding_backend must be 'tfidf' or 'ollama'")

    def search(self, query: str, domain: Domain, top_k: int = 3) -> list[RetrievedChunk]:
        results, _ = self.search_with_trace(query, domain, top_k)
        return results

    def search_with_trace(
        self,
        query: str,
        domain: Domain,
        top_k: int = 3,
    ) -> tuple[list[RetrievedChunk], GraphContext]:
        raw_lexical = self.bm25.score(query)
        # Keep absolute relevance. Per-query max normalization makes the least-bad
        # document look perfect even when every document is unrelated.
        lexical = 1.0 - np.exp(-raw_lexical / 6.0)
        if self.embedder:
            query_vector = self.embedder.embed([query])
        else:
            assert self.vectorizer is not None
            query_vector = self.vectorizer.transform([query])
        vector = np.clip(cosine_similarity(query_vector, self.document_vectors)[0], 0.0, 1.0)
        query_terms = set(content_tokens(query))
        title = np.array(
            [
                len(query_terms & set(content_tokens(document.title))) / max(1, len(query_terms))
                for document in self.corpus.documents
            ],
            dtype=float,
        )
        graph_context = self.knowledge_graph.expand(query, domain)
        graph = np.array(
            [
                graph_context.document_boosts.get(document.source_id, 0.0)
                for document in self.corpus.documents
            ],
            dtype=float,
        )
        vector_weight = 1 - self.lexical_weight - self.title_weight - self.graph_weight
        combined = (
            self.lexical_weight * lexical
            + vector_weight * vector
            + self.title_weight * title
            + self.graph_weight * graph
        )

        candidates = [
            index
            for index, document in enumerate(self.corpus.documents)
            if document.domain == domain
        ]
        candidates.sort(key=lambda index: combined[index], reverse=True)
        results: list[RetrievedChunk] = []
        for index in candidates[:top_k]:
            document = self.corpus.documents[index]
            results.append(
                RetrievedChunk(
                    source_id=document.source_id,
                    title=document.title,
                    domain=document.domain,
                    text=document.text,
                    lexical_score=float(lexical[index]),
                    vector_score=float(vector[index]),
                    title_score=float(title[index]),
                    graph_score=float(graph[index]),
                    combined_score=float(min(1.0, combined[index])),
                )
            )
        return results, graph_context
