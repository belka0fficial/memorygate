#!/usr/bin/env python3
"""Minimal stdio MCP server exposing MemoryGate's read-only context tool."""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


TOOL = {
    "name": "memorygate_context",
    "description": "Retrieve bounded, evidence-aware personal memory context. Read-only; use it before answering personal questions.",
    "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "include_evidence": {"type": "boolean"}}, "required": ["query"]},
}


def context(arguments: dict) -> dict:
    base = os.getenv("MEMORYGATE_URL", "http://127.0.0.1:8020").rstrip("/")
    key = os.getenv("MEMORYGATE_KEY", "")
    agent_id = os.getenv("MEMORYGATE_AGENT_ID", "default")
    if not key:
        raise RuntimeError("MEMORYGATE_KEY is required")
    payload = json.dumps({"query": arguments["query"], "max_items": 12, "include_evidence": bool(arguments.get("include_evidence", False))}).encode()
    request = Request(f"{base}/runtime/context", data=payload, method="POST", headers={"Content-Type": "application/json", "X-MemoryGate-Key": key, "X-Agent-Id": agent_id})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def respond(message_id, result=None, error=None):
    body = {"jsonrpc": "2.0", "id": message_id}
    body["result" if error is None else "error"] = result if error is None else {"code": -32000, "message": str(error)}
    print(json.dumps(body), flush=True)


for line in sys.stdin:
    try:
        request = json.loads(line)
        method = request.get("method")
        params = request.get("params", {})
        if method == "initialize":
            respond(request.get("id"), {"protocolVersion": params.get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}}, "serverInfo": {"name": "memorygate", "version": "0.1.0"}})
        elif method == "tools/list":
            respond(request.get("id"), {"tools": [TOOL]})
        elif method == "tools/call":
            if params.get("name") != TOOL["name"]:
                raise RuntimeError("unknown tool")
            value = context(params.get("arguments", {}))
            respond(request.get("id"), {"content": [{"type": "text", "text": json.dumps(value)}]})
        elif "id" in request:
            respond(request.get("id"), {})
    except Exception as exc:
        respond(request.get("id") if 'request' in locals() else None, error=exc)
