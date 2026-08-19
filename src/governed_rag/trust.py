from __future__ import annotations

from statistics import mean

from governed_rag.corpus import Corpus
from governed_rag.models import AgentOutput, Decision, Domain, TrustReport
from governed_rag.retrieval import tokenize


def token_support(answer: str, quotes: list[str]) -> float:
    answer_tokens = set(tokenize(answer))
    evidence_tokens = set(tokenize(" ".join(quotes)))
    if not answer_tokens:
        return 0.0
    return min(1.0, len(answer_tokens & evidence_tokens) / len(answer_tokens))


class TrustEvaluator:
    def __init__(self, corpus: Corpus) -> None:
        self.corpus = corpus

    def evaluate(
        self,
        routes: list[Domain],
        outputs: list[AgentOutput],
        errors: list[str],
    ) -> TrustReport:
        if not outputs:
            return TrustReport(
                decision=Decision.REJECT,
                routing_validity=0.0,
                citation_coverage=0.0,
                citation_validity=0.0,
                support_score=0.0,
                average_confidence=0.0,
                average_data_quality=0.0,
                reasons=["No valid agent outputs remained after boundary validation.", *errors],
            )

        routing_validity = sum(output.source_agent in routes for output in outputs) / len(outputs)
        citation_coverage = sum(bool(output.citations) for output in outputs) / max(1, len(routes))
        citations = [citation for output in outputs for citation in output.citations]
        valid_citations = [
            citation
            for citation in citations
            if self.corpus.validate_quote(citation.source_id, citation.quote)
        ]
        citation_validity = len(valid_citations) / len(citations) if citations else 0.0
        support_score = mean(
            token_support(output.answer, [citation.quote for citation in output.citations])
            for output in outputs
        )
        average_confidence = mean(output.confidence for output in outputs)
        average_data_quality = mean(output.data_quality for output in outputs)

        reasons: list[str] = []
        decision = Decision.ACCEPT
        if errors:
            decision = Decision.REJECT
            reasons.append("At least one agent failed its schema boundary.")
        if routing_validity < 1.0:
            decision = Decision.REJECT
            reasons.append("An output came from an agent outside the approved route.")
        if citation_coverage < 1.0:
            decision = Decision.REJECT
            reasons.append("Not every routed agent produced a citation-backed output.")
        if citation_validity < 1.0:
            decision = Decision.REJECT
            reasons.append("One or more citations could not be verified against the corpus.")
        if decision is Decision.ACCEPT and (
            average_confidence < 0.35 or average_data_quality < 0.50 or support_score < 0.25
        ):
            decision = Decision.ESCALATE
            reasons.append("Evidence quality is borderline and requires human review.")
        if decision is Decision.ACCEPT:
            reasons.append("All boundary, citation, routing, and evidence-support checks passed.")

        return TrustReport(
            decision=decision,
            routing_validity=routing_validity,
            citation_coverage=min(1.0, citation_coverage),
            citation_validity=citation_validity,
            support_score=support_score,
            average_confidence=average_confidence,
            average_data_quality=average_data_quality,
            reasons=reasons,
        )
