from governed_rag.corpus import Corpus
from governed_rag.graph_retrieval import FinancialKnowledgeGraph
from governed_rag.retrieval import HybridRetriever


def test_knowledge_graph_links_entities_to_corpus_sources() -> None:
    corpus = Corpus.from_json()
    graph = FinancialKnowledgeGraph.from_json(corpus)
    context = graph.expand("Northstar cloud revenue margin", "equity")

    assert {entity["id"] for entity in context.seed_entities} >= {
        "org:northstar",
        "product:cloud",
        "metric:revenue",
        "metric:margin",
    }
    assert any(
        path.source == "product:cloud"
        and path.relation == "drives"
        and path.target == "metric:revenue"
        for path in context.paths
    )
    assert context.document_boosts["NST-10K-2025-REV"] > 0


def test_graph_score_is_fused_into_ranked_retrieval() -> None:
    retriever = HybridRetriever(Corpus.from_json())
    results, context = retriever.search_with_trace(
        "How do renewable energy and cloud growth affect Northstar emissions?",
        "esg",
        top_k=3,
    )

    assert results[0].source_id == "NST-ESG-2025-EMISSIONS"
    assert results[0].graph_score > 0
    assert context.paths
    assert all(0 <= result.combined_score <= 1 for result in results)


def test_graph_expansion_fails_empty_for_unlinked_query() -> None:
    graph = FinancialKnowledgeGraph.from_json(Corpus.from_json())
    context = graph.expand("unrelated zxqv token", "equity")

    assert context.seed_entities == []
    assert context.paths == []
    assert context.document_boosts == {}
