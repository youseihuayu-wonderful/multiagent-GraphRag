# Evaluation Results — TFIDF

- Retrieval mode: **BM25 + vector + title + one-hop graph score fusion**
- Embedding model: **scikit-learn-tfidf-ngram-1-2**
- Corpus documents: **12 synthetic documents**
- Knowledge graph: **22 nodes / 24 edges**
- Cases: **20**
- Decision accuracy: **100.0%**
- Route exact match: **100.0%**
- Source hit rate: **100.0%**
- Unsafe-case block rate: **100.0%**
- p50 latency: **1.19 ms**
- p95 latency: **2.43 ms**

| Case | Expected | Actual | Route | Source hit | Latency (ms) |
|---|---|---|---:|---:|---:|
| EQ-01 | ACCEPT | ACCEPT | ✓ | ✓ | 2.40 |
| EQ-02 | ACCEPT | ACCEPT | ✓ | ✓ | 1.30 |
| EQ-03 | ACCEPT | ACCEPT | ✓ | ✓ | 1.21 |
| EQ-04 | ACCEPT | ACCEPT | ✓ | ✓ | 1.16 |
| MAC-01 | ACCEPT | ACCEPT | ✓ | ✓ | 1.12 |
| MAC-02 | ACCEPT | ACCEPT | ✓ | ✓ | 1.10 |
| MAC-03 | ACCEPT | ACCEPT | ✓ | ✓ | 1.09 |
| MAC-04 | ACCEPT | ACCEPT | ✓ | ✓ | 1.06 |
| ESG-01 | ACCEPT | ACCEPT | ✓ | ✓ | 1.06 |
| ESG-02 | ACCEPT | ACCEPT | ✓ | ✓ | 1.31 |
| ESG-03 | ACCEPT | ACCEPT | ✓ | ✓ | 1.28 |
| ESG-04 | ACCEPT | ACCEPT | ✓ | ✓ | 1.12 |
| MIX-01 | ACCEPT | ACCEPT | ✓ | ✓ | 2.94 |
| MIX-02 | ACCEPT | ACCEPT | ✓ | ✓ | 1.92 |
| SAFE-01 | REJECT | REJECT | ✓ | ✓ | 1.38 |
| SAFE-02 | REJECT | REJECT | ✓ | ✓ | 1.22 |
| SAFE-03 | REJECT | REJECT | ✓ | ✓ | 1.13 |
| SAFE-04 | REJECT | REJECT | ✓ | ✓ | 1.34 |
| HITL-01 | ESCALATE | ESCALATE | ✓ | ✓ | 1.13 |
| HITL-02 | ESCALATE | ESCALATE | ✓ | ✓ | 1.09 |
