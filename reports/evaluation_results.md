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
- p50 latency: **1.40 ms**
- p95 latency: **2.81 ms**

| Case | Expected | Actual | Route | Source hit | Latency (ms) |
|---|---|---|---:|---:|---:|
| EQ-01 | ACCEPT | ACCEPT | ✓ | ✓ | 2.47 |
| EQ-02 | ACCEPT | ACCEPT | ✓ | ✓ | 2.22 |
| EQ-03 | ACCEPT | ACCEPT | ✓ | ✓ | 1.80 |
| EQ-04 | ACCEPT | ACCEPT | ✓ | ✓ | 1.37 |
| MAC-01 | ACCEPT | ACCEPT | ✓ | ✓ | 1.20 |
| MAC-02 | ACCEPT | ACCEPT | ✓ | ✓ | 1.17 |
| MAC-03 | ACCEPT | ACCEPT | ✓ | ✓ | 1.38 |
| MAC-04 | ACCEPT | ACCEPT | ✓ | ✓ | 1.43 |
| ESG-01 | ACCEPT | ACCEPT | ✓ | ✓ | 1.58 |
| ESG-02 | ACCEPT | ACCEPT | ✓ | ✓ | 1.63 |
| ESG-03 | ACCEPT | ACCEPT | ✓ | ✓ | 1.36 |
| ESG-04 | ACCEPT | ACCEPT | ✓ | ✓ | 1.27 |
| MIX-01 | ACCEPT | ACCEPT | ✓ | ✓ | 3.85 |
| MIX-02 | ACCEPT | ACCEPT | ✓ | ✓ | 2.76 |
| SAFE-01 | REJECT | REJECT | ✓ | ✓ | 1.61 |
| SAFE-02 | REJECT | REJECT | ✓ | ✓ | 1.49 |
| SAFE-03 | REJECT | REJECT | ✓ | ✓ | 1.19 |
| SAFE-04 | REJECT | REJECT | ✓ | ✓ | 1.21 |
| HITL-01 | ESCALATE | ESCALATE | ✓ | ✓ | 1.19 |
| HITL-02 | ESCALATE | ESCALATE | ✓ | ✓ | 1.15 |
