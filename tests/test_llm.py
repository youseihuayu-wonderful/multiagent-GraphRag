import pytest

from governed_rag.llm import (
    HybridDocumentRAG,
    LLMSettings,
    LLMUnavailableError,
    OllamaChatProvider,
)
from governed_rag.models import Decision, GeneralDocumentInput


class FakeProvider:
    name = "fake-openai-compatible"
    model = "fake-agent-model"

    def __init__(self, fail: bool = False) -> None:
        self.calls = 0
        self.fail = fail

    def chat_json(self, *, system: str, user: str) -> dict[str, object]:
        self.calls += 1
        if self.fail:
            raise LLMUnavailableError("provider unavailable")
        if self.calls == 1:
            return {
                "strategies": ["keyword", "semantic", "graph"],
                "retrieval_query": "Ares mission launch ice samples",
                "rationale": "Use all evidence views for a source-grounded answer.",
            }
        return {
            "answer": (
                "The Ares mission will launch in September 2028 and collect ice samples "
                "near the Martian north pole."
            ),
            "source_ids": ["DOC-01-C01"],
        }


def documents() -> list[GeneralDocumentInput]:
    return [
        GeneralDocumentInput(
            title="Ares mission brief",
            text=(
                "The Ares mission will launch in September 2028 and collect ice samples "
                "near the Martian north pole. The mission will operate for ninety days."
            ),
        )
    ]


def test_hybrid_runtime_executes_llm_planner_and_synthesizer() -> None:
    provider = FakeProvider()
    response = HybridDocumentRAG(provider=provider).invoke(
        "When does Ares launch and what will it collect?",
        documents(),
        top_k=3,
        mode="hybrid",
    )
    assert provider.calls == 2
    assert response.trust_report.decision is Decision.ACCEPT
    assert response.execution is not None
    assert response.execution.actual_mode == "llm"
    assert response.execution.provider == provider.name
    assert response.answer is not None
    assert "September 2028" in response.answer
    assert response.trace_steps[0].node == "llm_planner"
    assert any(step.node == "llm_synthesizer" for step in response.trace_steps)


def test_schema_validation_retries_once() -> None:
    class RetryProvider(FakeProvider):
        def chat_json(self, *, system: str, user: str) -> dict[str, object]:
            self.calls += 1
            if self.calls == 1:
                return {"strategies": ["not-a-tool"], "retrieval_query": "x"}
            if self.calls == 2:
                assert "JSON Schema" in system
                return {
                    "strategies": ["keyword"],
                    "retrieval_query": "Ares mission launch",
                    "rationale": "Find the stated mission launch date.",
                }
            return {
                "answer": "The Ares mission will launch in September 2028.",
                "source_ids": ["DOC-01-C01"],
            }

    provider = RetryProvider()
    response = HybridDocumentRAG(provider=provider).invoke(
        "When does Ares launch?", documents(), top_k=3, mode="llm"
    )
    assert provider.calls == 3
    assert response.trust_report.decision is Decision.ACCEPT


def test_synthesis_schema_validation_retries_short_answer() -> None:
    class ShortAnswerProvider(FakeProvider):
        def chat_json(self, *, system: str, user: str) -> dict[str, object]:
            self.calls += 1
            if self.calls == 1:
                return {
                    "strategies": ["keyword"],
                    "retrieval_query": "Ares mission launch",
                    "rationale": "Find the stated mission launch date.",
                }
            if self.calls == 2:
                return {"answer": "September 2028.", "source_ids": ["DOC-01-C01"]}
            assert "JSON Schema" in system
            return {
                "answer": "The Ares mission will launch in September 2028.",
                "source_ids": ["DOC-01-C01"],
            }

    provider = ShortAnswerProvider()
    response = HybridDocumentRAG(provider=provider).invoke(
        "When does Ares launch?", documents(), top_k=3, mode="llm"
    )
    assert provider.calls == 3
    assert response.trust_report.decision is Decision.ACCEPT


def test_hybrid_runtime_falls_back_when_provider_fails() -> None:
    response = HybridDocumentRAG(provider=FakeProvider(fail=True)).invoke(
        "When does Ares launch?",
        documents(),
        top_k=3,
        mode="hybrid",
    )
    assert response.trust_report.decision is Decision.ACCEPT
    assert response.execution is not None
    assert response.execution.actual_mode == "deterministic"
    assert "failed safely" in (response.execution.fallback_reason or "")


def test_ollama_cloud_provider_uses_native_authenticated_chat(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"message": {"content": '{"status":"ok"}'}}

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            captured["client"] = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def post(self, url, *, headers, json):
            captured.update({"url": url, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr("governed_rag.llm.httpx.Client", FakeClient)
    provider = OllamaChatProvider(
        LLMSettings(
            provider="ollama-cloud",
            base_url="https://ollama.com",
            api_key="secret-key",
            model="gpt-oss:20b",
        )
    )
    assert provider.chat_json(system="Return JSON", user="Test") == {"status": "ok"}
    assert captured["url"] == "https://ollama.com/api/chat"
    assert captured["headers"]["Authorization"] == "Bearer secret-key"
    assert "format" not in captured["json"]


def test_strict_llm_mode_requires_provider() -> None:
    runtime = HybridDocumentRAG(provider=None)
    runtime.provider = None
    with pytest.raises(LLMUnavailableError):
        runtime.invoke(
            "When does Ares launch?",
            documents(),
            top_k=3,
            mode="llm",
        )
