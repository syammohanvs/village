# Models

This directory holds downloaded models. Its contents are **not committed**.

## Whisper (speech to text)

Required file:

```
models/whisper/ggml-base.bin
```

Use the **multilingual** `ggml-base.bin`, not `ggml-base.en.bin` (English
only). Download with:

```bash
./scripts/download_models.sh
```

or manually:

```bash
curl -L -o models/whisper/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

Expected SHA-256 (recorded 2026-11-07):

```
60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe
```

The file is about 142 MB.

## Waste classifier (Teachable Machine)

Export a Teachable Machine **Image Project** as TensorFlow.js and copy these
three files into:

```
models/waste/model.json
models/waste/metadata.json
models/waste/weights.bin
```

Expected class names (case-insensitive, in any order):

- `Organic`
- `Plastic`
- `Paper`
- `Background` (or `Unknown`)

The app reports “Recognition model not installed” when any file is missing. It
never substitutes random predictions. See `docs/waste-model.md`.

## Optional voice response recordings

Prepared reply audio is optional. See `web/frontend/public/audio/README.md`.
