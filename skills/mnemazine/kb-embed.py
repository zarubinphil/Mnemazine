#!/usr/bin/env python3
"""kb-embed — локальный семантический индекс vault для дедупа Мнемозины.

Без Ollama/облака: fastembed (onnxruntime) + multilingual-e5-small, CPU.
Ловит смысловые дубли, которые hash-cache (байтовый) пропускает —
пере-скриншот/пере-сейв того же знания с другим хэшем.

Запуск:
  python skills/mnemazine/kb-embed.py <cmd> ...

Команды:
  build  <vault> <out.json>                 — эмбеддит все ноты → индекс
  add    <out.json> <note.md> [note.md...]  — дозаписать ноты в индекс
  query  <idx.json> <text> [topk] [thr]     — топ-похожих нот (cosine)

Все ответы — одна строка JSON (для парсинга агентом).
"""
import sys
import os
import json
import glob
import math
import warnings

warnings.filterwarnings("ignore")  # чистый JSON-выхлоп для парсинга агентом

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"  # 384d, ~220MB, мультиязык RU
MAX_CHARS = 2000                          # хвост ноты не нужен для темы


def _emb(texts, prefix):
    from fastembed import TextEmbedding
    model = TextEmbedding(MODEL)
    return [v.tolist() for v in model.embed([prefix + t for t in texts])]


def _strip_fm(text):
    """Убрать YAML-frontmatter, оставить тело."""
    t = text
    if t.startswith("---"):
        end = t.find("\n---", 3)
        if end != -1:
            t = t[end + 4:]
    return t.strip()


def _is_content_note(p):
    bad = ("/graphify-out/", "/.git/", "/.obsidian/")
    if any(b in p for b in bad):
        return False
    return not os.path.basename(p).startswith("_")


def _read_body(p):
    try:
        return _strip_fm(open(p, encoding="utf-8").read())[:MAX_CHARS]
    except Exception:
        return ""


def _cos(a, b):
    d = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return d / (na * nb) if na and nb else 0.0


def cmd_build(vault, out):
    notes = [p for p in glob.glob(vault + "/**/*.md", recursive=True) if _is_content_note(p)]
    bodies = [_read_body(p) for p in notes]
    pairs = [(p, b) for p, b in zip(notes, bodies) if b]
    vecs = _emb([b for _, b in pairs], "") if pairs else []
    idx = {p: v for (p, _), v in zip(pairs, vecs)}
    json.dump(idx, open(out, "w"), ensure_ascii=False)
    print(json.dumps({"indexed": len(idx), "out": out}))


def cmd_add(out, notes):
    idx = json.load(open(out)) if os.path.exists(out) else {}
    bodies = [_read_body(p) for p in notes]
    pairs = [(p, b) for p, b in zip(notes, bodies) if b]
    if pairs:
        vecs = _emb([b for _, b in pairs], "")
        for (p, _), v in zip(pairs, vecs):
            idx[p] = v
    json.dump(idx, open(out, "w"), ensure_ascii=False)
    print(json.dumps({"added": len(pairs), "total": len(idx)}))


def cmd_query(idxfile, text, topk=3, thr=0.0):
    idx = json.load(open(idxfile)) if os.path.exists(idxfile) else {}
    if not idx:
        print(json.dumps({"matches": [], "top": 0.0, "note": "index empty"}))
        return
    qv = _emb([text[:MAX_CHARS]], "")[0]
    scored = sorted(((_cos(qv, v), p) for p, v in idx.items()), reverse=True)[:topk]
    matches = [{"note": p, "score": round(s, 4)} for s, p in scored if s >= thr]
    print(json.dumps({"matches": matches, "top": round(scored[0][0], 4) if scored else 0.0},
                     ensure_ascii=False))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: build|add|query"}))
        sys.exit(1)
    cmd = sys.argv[1]
    try:
        if cmd == "build":
            cmd_build(sys.argv[2], sys.argv[3])
        elif cmd == "add":
            cmd_add(sys.argv[2], sys.argv[3:])
        elif cmd == "query":
            topk = int(sys.argv[4]) if len(sys.argv) > 4 else 3
            thr = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
            cmd_query(sys.argv[2], sys.argv[3], topk, thr)
        else:
            print(json.dumps({"error": "unknown cmd: " + cmd}))
            sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
