from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from governed_rag.corpus import PROJECT_ROOT, Corpus
from governed_rag.models import Domain, GraphContext, GraphEdge, GraphNode, GraphPath

TOKEN_PATTERN = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]+")


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())

DEFAULT_GRAPH_PATH = PROJECT_ROOT / "data" / "graph" / "financial_knowledge_graph.json"


class FinancialKnowledgeGraph:
    """Auditable entity graph used for deterministic one-hop retrieval expansion."""

    def __init__(self, nodes: list[GraphNode], edges: list[GraphEdge], corpus: Corpus) -> None:
        self.nodes = nodes
        self.edges = edges
        self.corpus = corpus
        self.by_id = {node.id: node for node in nodes}
        self.adjacency: dict[str, list[GraphEdge]] = defaultdict(list)
        for edge in edges:
            if edge.source not in self.by_id or edge.target not in self.by_id:
                raise ValueError(f"Graph edge references an unknown node: {edge}")
            unknown_sources = set(edge.source_ids) - set(corpus.by_id)
            if unknown_sources:
                raise ValueError(f"Graph edge references unknown documents: {unknown_sources}")
            self.adjacency[edge.source].append(edge)
            self.adjacency[edge.target].append(edge)

    @classmethod
    def from_json(
        cls,
        corpus: Corpus,
        path: str | Path = DEFAULT_GRAPH_PATH,
    ) -> FinancialKnowledgeGraph:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        nodes = [GraphNode.model_validate(item) for item in payload["nodes"]]
        edges = [GraphEdge.model_validate(item) for item in payload["edges"]]
        return cls(nodes, edges, corpus)

    @property
    def supported_organizations(self) -> list[str]:
        return sorted(node.label for node in self.nodes if node.type == "organization")

    def resolve_organizations(self, query: str) -> list[str]:
        """Resolve only organizations explicitly present in the governed graph."""
        query_terms = set(tokenize(query))
        resolved: list[str] = []
        for node in self.nodes:
            if node.type != "organization":
                continue
            phrases = [node.label, *node.aliases]
            if any(
                phrase_terms and phrase_terms <= query_terms
                for phrase in phrases
                if (phrase_terms := set(tokenize(phrase)))
            ):
                resolved.append(node.label)
        return sorted(resolved)

    @staticmethod
    def _entity_score(query_terms: set[str], node: GraphNode) -> float:
        phrases = [node.label, *node.aliases]
        scores: list[float] = []
        for phrase in phrases:
            phrase_terms = set(tokenize(phrase))
            if not phrase_terms:
                continue
            overlap = len(query_terms & phrase_terms)
            scores.append(overlap / len(phrase_terms))
        return max(scores, default=0.0)

    def expand(self, query: str, domain: Domain, max_seeds: int = 5) -> GraphContext:
        """Link the query to seed entities, then traverse one relation hop."""
        query_terms = set(tokenize(query))
        ranked = [
            (node, self._entity_score(query_terms, node))
            for node in self.nodes
        ]
        ranked = [(node, score) for node, score in ranked if score >= 0.5]
        ranked.sort(key=lambda item: (-item[1], item[0].id))
        seeds = ranked[:max_seeds]
        seed_ids = {node.id for node, _ in seeds}
        organization_seeds = [node for node, _ in seeds if node.type == "organization"]
        anchor_source_ids = {
            source_id
            for organization in organization_seeds
            for edge in self.adjacency.get(organization.id, [])
            for source_id in edge.source_ids
            if self.corpus.by_id[source_id].domain == domain
        }

        expanded_scores: dict[str, float] = {}
        paths: list[GraphPath] = []
        document_boosts: dict[str, float] = defaultdict(float)
        seen_edges: set[tuple[str, str, str]] = set()

        for seed, seed_score in seeds:
            for edge in self.adjacency.get(seed.id, []):
                edge_key = (edge.source, edge.relation, edge.target)
                if edge_key in seen_edges:
                    continue
                domain_sources = [
                    source_id
                    for source_id in edge.source_ids
                    if self.corpus.by_id[source_id].domain == domain
                    and (not anchor_source_ids or source_id in anchor_source_ids)
                ]
                if not domain_sources:
                    continue
                seen_edges.add(edge_key)
                neighbor_id = edge.target if edge.source == seed.id else edge.source
                path_score = min(1.0, seed_score * (0.9 if neighbor_id in seed_ids else 0.55))
                if neighbor_id not in seed_ids:
                    expanded_scores[neighbor_id] = max(
                        expanded_scores.get(neighbor_id, 0.0), path_score
                    )
                for source_id in domain_sources:
                    document_boosts[source_id] += path_score
                paths.append(
                    GraphPath(
                        source=edge.source,
                        source_label=self.by_id[edge.source].label,
                        relation=edge.relation,
                        target=edge.target,
                        target_label=self.by_id[edge.target].label,
                        hop=1,
                        score=path_score,
                        source_ids=domain_sources,
                    )
                )

        maximum_boost = max(document_boosts.values(), default=0.0)
        normalized_boosts = {
            source_id: round(score / maximum_boost, 4) if maximum_boost else 0.0
            for source_id, score in document_boosts.items()
        }
        paths.sort(key=lambda path: (-path.score, path.source, path.target))
        expanded = sorted(
            expanded_scores.items(),
            key=lambda item: (-item[1], item[0]),
        )
        return GraphContext(
            seed_entities=[
                {
                    "id": node.id,
                    "label": node.label,
                    "type": node.type,
                    "score": round(score, 4),
                }
                for node, score in seeds
            ],
            expanded_entities=[
                {
                    "id": node_id,
                    "label": self.by_id[node_id].label,
                    "type": self.by_id[node_id].type,
                    "score": round(score, 4),
                }
                for node_id, score in expanded
            ],
            paths=paths[:12],
            document_boosts=normalized_boosts,
        )

    def export(self) -> dict[str, object]:
        return {
            "nodes": [node.model_dump() for node in self.nodes],
            "edges": [edge.model_dump() for edge in self.edges],
        }
