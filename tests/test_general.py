from governed_rag.general import GeneralDocumentRAG
from governed_rag.models import Decision, GeneralDocumentInput


def workspace_documents() -> list[GeneralDocumentInput]:
    return [
        GeneralDocumentInput(
            title="Mars Mission Notes",
            text=(
                "The Ares mission will launch in September 2028. Its primary objective is "
                "to collect ice samples near the Martian north pole. The mission uses the "
                "Helios lander and will operate for ninety days."
            ),
        ),
        GeneralDocumentInput(
            title="Ocean Program",
            text=(
                "The Pelagos research program studies coral reef recovery. Field teams will "
                "survey water temperature and biodiversity across twelve protected sites "
                "during 2027."
            ),
        ),
    ]


def test_general_workspace_answers_from_uploaded_documents() -> None:
    response = GeneralDocumentRAG().invoke(
        "When will the Ares mission launch and what will it collect?",
        workspace_documents(),
    )
    assert response.trust_report.decision is Decision.ACCEPT
    assert set(response.routes) == {"keyword", "semantic", "graph"}
    assert response.answer is not None
    assert "September 2028" in response.answer
    assert "ice samples" in response.answer
    assert response.knowledge_graph is not None
    assert response.knowledge_graph.synthetic is False
    assert response.knowledge_graph.nodes
    assert all(output.citations for output in response.agent_outputs)
    assert [step.node for step in response.trace_steps] == [
        "router",
        "agent:keyword",
        "agent:semantic",
        "agent:graph",
        "aggregation",
        "trust_evaluator",
    ]


def test_general_workspace_supports_cjk_documents() -> None:
    response = GeneralDocumentRAG().invoke(
        "阿瑞斯任务什么时候发射？",
        [
            GeneralDocumentInput(
                title="阿瑞斯任务简报",
                text=(
                    "阿瑞斯任务计划于2028年9月发射。主要目标是在火星北极附近采集冰样本。"
                    "任务将持续九十天，并在着陆后发布科学报告。"
                ),
            )
        ],
    )
    assert response.trust_report.decision is Decision.ACCEPT
    assert response.answer is not None
    assert "2028年9月" in response.answer
    assert response.trust_report.citation_validity == 1.0


def test_general_workspace_rejects_unrelated_question() -> None:
    response = GeneralDocumentRAG().invoke(
        "What is the quarterly revenue of Tesla?",
        workspace_documents(),
    )
    assert response.trust_report.decision is Decision.REJECT
    assert response.routes == []
    assert response.answer is None
    assert response.agent_outputs == []
    assert "No uploaded document" in response.errors[0]
