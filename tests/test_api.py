from fastapi.testclient import TestClient

from governed_rag import api as api_module
from governed_rag.api import app

client = TestClient(app)


def test_service_info_and_health() -> None:
    service = client.get("/").json()
    assert service["status"] == "online"
    assert service["data"] == "synthetic-financial-corpus"

    scope = client.get("/scope").json()
    assert scope["synthetic"] is True
    assert scope["supported_organizations"] == [
        "Harbor Industrial Systems",
        "Northstar Technologies",
    ]
    assert scope["external_web_search"] is False
    assert scope["general_document_workspace"]["enabled"] is True
    assert scope["general_document_workspace"]["persistence"] == "none"
    assert scope["general_document_workspace"]["maximum_documents"] == 20
    assert scope["general_document_workspace"]["minimum_document_characters"] == 1
    assert scope["general_document_workspace"]["maximum_document_characters"] is None
    assert scope["general_document_workspace"]["maximum_total_characters"] == 120_000
    assert scope["general_document_workspace"]["execution_modes"] == [
        "deterministic",
        "hybrid",
        "llm",
    ]
    assert scope["general_document_workspace"]["llm_available"] is False

    health_response = client.get("/health")
    health = health_response.json()
    assert health_response.headers["X-Request-ID"]
    assert health["status"] == "ok"
    assert health["retrieval_backend"] == "tfidf"
    assert health["corpus_documents"] == 12
    assert health["llm_available"] is False


def test_optional_bearer_authentication(monkeypatch) -> None:
    monkeypatch.setattr(api_module, "configured_api_keys", ["production-secret"])
    denied = client.post(
        "/query", json={"query": "What drove Northstar revenue?", "top_k": 2}
    )
    assert denied.status_code == 401
    assert denied.headers["X-Request-ID"]

    allowed = client.post(
        "/query",
        json={"query": "What drove Northstar revenue?", "top_k": 2},
        headers={"Authorization": "Bearer production-secret"},
    )
    assert allowed.status_code == 200


def test_query_validation() -> None:
    assert client.post("/query", json={"query": "   ", "top_k": 3}).status_code == 422
    assert client.post("/query", json={"query": "valid question", "top_k": 6}).status_code == 422


def test_unsupported_company_query_is_rejected_without_unrelated_answer() -> None:
    response = client.post(
        "/query",
        json={"query": "What drove Tesla growth and what risks affect margin?", "top_k": 3},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["trust_report"]["decision"] == "REJECT"
    assert payload["answer"] is None
    assert payload["agent_outputs"] == []
    assert "No indexed organization" in payload["errors"][0]


def test_general_document_query_endpoint() -> None:
    response = client.post(
        "/general/query",
        json={
            "query": "When does the Ares mission launch?",
            "documents": [
                {
                    "title": "Mission notes",
                    "text": (
                        "The Ares mission launches in September 2028. Its objective is to "
                        "collect ice samples near the Martian north pole."
                    ),
                }
            ],
            "top_k": 3,
        },
    )
    assert response.status_code == 200
    assert response.headers["X-Request-ID"]
    payload = response.json()
    assert payload["trust_report"]["decision"] == "ACCEPT"
    assert "September 2028" in payload["answer"]
    assert payload["retrieval_mode"] == "general-document-graphrag"
    assert payload["execution"]["actual_mode"] == "deterministic"
    assert payload["knowledge_graph"]["synthetic"] is False


def test_strict_llm_mode_fails_clearly_without_server_provider() -> None:
    response = client.post(
        "/general/query",
        json={
            "query": "When does the Ares mission launch?",
            "documents": [
                {
                    "title": "Mission notes",
                    "text": "The Ares mission launches in September 2028 near the Martian pole.",
                }
            ],
            "mode": "llm",
        },
    )
    assert response.status_code == 503
    assert "no server-side provider" in response.json()["detail"]
    assert response.headers["X-Request-ID"]


def test_general_document_accepts_short_and_large_individual_sources() -> None:
    short_response = client.post(
        "/general/query",
        json={
            "query": "What does the note say?",
            "documents": [{"title": "Short note", "text": "OK"}],
        },
    )
    assert short_response.status_code == 200

    large_response = client.post(
        "/general/query",
        json={
            "query": "When does Ares launch?",
            "documents": [
                {
                    "title": "Large mission brief",
                    "text": "Ares launches in September 2028. " * 1_000,
                }
            ],
        },
    )
    assert large_response.status_code == 200


def test_query_endpoint() -> None:
    response = client.post(
        "/query", json={"query": "What drove Northstar cloud revenue growth?", "top_k": 2}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["trust_report"]["decision"] == "ACCEPT"
    assert payload["routes"] == ["equity"]
    assert payload["retrieval_mode"] == "graphrag-hybrid"
    assert len(payload["trace_steps"]) == 4
    assert payload["trace_steps"][1]["output"]["candidates"]
