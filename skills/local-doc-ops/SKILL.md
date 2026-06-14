---
name: local-doc-ops
description: Use when extracting, inspecting, splitting, or converting local PDFs, documents, and image-based files before they enter a knowledge pipeline.
---

# Local Document Operations

Use local deterministic tools before spending model context.

Preferred order:

1. Use structured parsers for PDFs and office documents.
2. Use Apple Vision OCR for images on macOS.
3. Use transcription for audio or video.
4. Only then ask a model to interpret unclear content.

Keep raw extracted text in cache or inbox. Write only refined knowledge into the vault.

Bundled helper:

```bash
python skills/local-doc-ops/pdf-kit.py --help
```
