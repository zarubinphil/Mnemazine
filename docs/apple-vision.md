# Apple Vision OCR

On macOS, Mnemazine can use Apple's Vision framework for local OCR.

Compile:

```bash
swiftc -O skills/mnemazine/vision-ocr.swift -o .mnemazine/bin/vision-ocr
```

Run:

```bash
.mnemazine/bin/vision-ocr path/to/image.png
```

The OCR output is raw material. It should be refined before entering the vault.
