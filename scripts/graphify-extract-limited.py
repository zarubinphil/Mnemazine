#!/usr/bin/env python3
"""Run `graphify extract` with a controllable LLM concurrency limit.

Graphify's public CLI currently does not expose `max_concurrency`, while some
API providers enforce low organization concurrency. This wrapper keeps the CLI
surface intact and only patches graphify.llm.extract_corpus_parallel in-process.
"""

import os
import runpy
import sys

import graphify.llm as graphify_llm


def main() -> None:
    raw = os.environ.get("GRAPHIFY_LLM_MAX_CONCURRENCY", "").strip()
    if raw:
        try:
            max_concurrency = max(1, int(raw))
        except ValueError:
            print("GRAPHIFY_LLM_MAX_CONCURRENCY must be an integer", file=sys.stderr)
            sys.exit(2)

        original = graphify_llm.extract_corpus_parallel

        def limited_extract_corpus_parallel(*args, **kwargs):
            kwargs["max_concurrency"] = max_concurrency
            return original(*args, **kwargs)

        graphify_llm.extract_corpus_parallel = limited_extract_corpus_parallel

    sys.argv = ["graphify", *sys.argv[1:]]
    runpy.run_module("graphify.__main__", run_name="__main__")


if __name__ == "__main__":
    main()
