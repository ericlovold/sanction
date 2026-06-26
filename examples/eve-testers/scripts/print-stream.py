#!/usr/bin/env python3
"""Best-effort pretty-printer for eve's NDJSON session stream.

eve serves session events as `application/x-ndjson`. Event shapes may evolve, so
this is defensive: it prints assistant text and tool activity from the common
fields and ignores anything it doesn't recognize. Falls back to raw lines if
SANCTION_STREAM_RAW=1.
"""
import json
import os
import sys

RAW = os.environ.get("SANCTION_STREAM_RAW") == "1"


def text_from(ev):
    for k in ("delta", "text", "content", "message", "summary", "output"):
        v = ev.get(k)
        if isinstance(v, str) and v.strip():
            return v, k
        if isinstance(v, dict):
            t = v.get("text") or v.get("content")
            if isinstance(t, str) and t.strip():
                return t, k
    return None, None


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if RAW:
            print(line)
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = ev.get("type", ev.get("event", ""))
        txt, k = text_from(ev)
        if txt:
            end = "" if k == "delta" else "\n"
            print(txt, end=end, flush=True)
        elif "tool" in etype.lower() or etype.startswith("actions"):
            name = ev.get("name") or ev.get("tool") or ""
            print(f"\n  · {etype} {name}".rstrip(), flush=True)
        elif etype in ("message.completed", "session.completed", "session.ended"):
            print(f"\n[{etype}]", flush=True)
            if etype in ("session.completed", "session.ended"):
                break


if __name__ == "__main__":
    main()
