import pytest
from pydantic import ValidationError

from governed_rag.models import AgentOutput


def test_schema_gate_rejects_missing_citations() -> None:
    with pytest.raises(ValidationError):
        AgentOutput.model_validate(
            {
                "source_agent": "equity",
                "answer": "A sufficiently long but unsupported financial answer.",
                "citations": [],
                "confidence": 0.9,
                "data_quality": 0.9,
            }
        )


def test_schema_gate_rejects_out_of_range_confidence() -> None:
    with pytest.raises(ValidationError):
        AgentOutput.model_validate(
            {
                "source_agent": "equity",
                "answer": "A sufficiently long answer with a citation included.",
                "citations": [
                    {
                        "source_id": "SOURCE-1",
                        "quote": "A sufficiently long quotation.",
                        "relevance_score": 0.8,
                    }
                ],
                "confidence": 1.5,
                "data_quality": 0.9,
            }
        )
