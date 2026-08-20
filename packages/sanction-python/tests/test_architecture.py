from __future__ import annotations

import ast
import importlib.metadata
from pathlib import Path


def test_runtime_dependency_is_only_httpx() -> None:
    requires = importlib.metadata.requires("sanction-sdk") or []
    runtime = [line.split(";")[0].strip() for line in requires if line]
    assert runtime == ["httpx>=0.28.1,<0.29.0"]


def test_package_has_no_langchain_or_litellm_imports() -> None:
    root = Path(__file__).resolve().parents[1] / "src" / "sanction_sdk"
    forbidden = {"langchain", "litellm", "openai", "anthropic"}
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top = alias.name.split(".")[0]
                    assert top not in forbidden, f"{path.name} imports {alias.name}"
            if isinstance(node, ast.ImportFrom) and node.module:
                top = node.module.split(".")[0]
                assert top not in forbidden, f"{path.name} imports from {node.module}"
