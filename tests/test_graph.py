from governed_rag.graph import GovernedRAG
from governed_rag.models import Decision


def test_grounded_query_is_accepted() -> None:
    response = GovernedRAG().invoke("What drove Northstar cloud revenue growth?")
    assert response.routes == ["equity"]
    assert response.trust_report.decision is Decision.ACCEPT
    assert response.trust_report.citation_validity == 1.0
    assert response.agent_outputs
    assert [step.node for step in response.trace_steps] == [
        "router",
        "agent:equity",
        "aggregation",
        "trust_evaluator",
    ]
    assert response.retrieval_mode == "graphrag-hybrid"
    assert response.trace_steps[1].output["candidates"]
    assert response.trace_steps[1].output["graph_context"]["paths"]
    assert response.trace_steps[1].output["score_fusion"]["graph"] == 0.18


def test_unsupported_company_query_fails_closed_before_retrieval() -> None:
    response = GovernedRAG().invoke(
        "What drove Tesla growth and what risks could affect margin?"
    )
    assert response.trust_report.decision is Decision.REJECT
    assert response.routes == []
    assert response.answer is None
    assert response.agent_outputs == []
    assert any("No indexed organization" in error for error in response.errors)
    assert [step.node for step in response.trace_steps] == [
        "router",
        "aggregation",
        "trust_evaluator",
    ]
    scope = response.trace_steps[0].output["scope_validation"]
    assert scope["passed"] is False
    assert scope["resolved_organizations"] == []


def test_known_company_query_without_relevant_evidence_is_rejected() -> None:
    response = GovernedRAG().invoke("What is Northstar CEO birthday?")
    assert response.trust_report.decision is Decision.REJECT
    assert response.answer is None
    assert any("relevance gate blocked" in error for error in response.errors)
    agent_trace = next(step for step in response.trace_steps if step.node == "agent:equity")
    assert agent_trace.output["relevance_gate"]["passed"] is False


def test_citation_free_output_is_rejected_at_boundary() -> None:
    response = GovernedRAG().invoke(
        "What was Northstar revenue?", fault="no_citation"
    )
    assert response.trust_report.decision is Decision.REJECT
    assert not response.agent_outputs
    assert any("schema gate" in error for error in response.errors)
    agent_trace = next(step for step in response.trace_steps if step.node == "agent:equity")
    assert agent_trace.output["schema_gate"]["passed"] is False


def test_invalid_citation_is_rejected_by_trust_evaluator() -> None:
    response = GovernedRAG().invoke(
        "What was the CPI inflation trend?", fault="invalid_citation"
    )
    assert response.trust_report.decision is Decision.REJECT
    assert response.trust_report.citation_validity < 1.0


def test_low_confidence_output_escalates_to_human() -> None:
    response = GovernedRAG().invoke(
        "Assess uncertainty in CPI inflation.", fault="low_confidence"
    )
    assert response.trust_report.decision is Decision.ESCALATE
