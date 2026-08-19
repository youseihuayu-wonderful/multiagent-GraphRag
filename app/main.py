from __future__ import annotations

import os
import sys
from importlib import import_module
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))
os.environ.setdefault("GOVERNED_RAG_PROJECT_ROOT", str(PROJECT_ROOT))

app = import_module("governed_rag.api").app
