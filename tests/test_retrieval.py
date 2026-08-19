from governed_rag.corpus import Corpus
from governed_rag.retrieval import HybridRetriever


def test_retrieval_is_domain_scoped() -> None:
    retriever = HybridRetriever(Corpus.from_json())
    results = retriever.search("cloud revenue growth", "equity", top_k=3)
    assert results
    assert all(result.domain == "equity" for result in results)
    assert results[0].source_id == "NST-10K-2025-REV"


def test_macro_retrieval_finds_cpi_source() -> None:
    retriever = HybridRetriever(Corpus.from_json())
    results = retriever.search("latest CPI inflation trend", "macro", top_k=2)
    assert results[0].source_id == "MACRO-CPI-2026-06"
