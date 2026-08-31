# Continuous Cricket Commentary

A local prototype for testing uninterrupted AI cricket commentary. Manual scoring and a clickable field map update the match state; the existing local Qwen model generates every spoken line dynamically, and Windows Microsoft Ravi reads it aloud.

## Start

Double-click `start_voice_tester.bat`. It loads the existing Qwen model and opens `http://127.0.0.1:8772` when the model is ready.

## Test flow

1. Press **Start commentary**. Qwen continues generating short between-ball analysis until stopped.
2. Select a score result.
3. Optionally select a position on the field map.
4. Press **Confirm delivery**.
5. Press **Stop** at any time to cancel speech and generation immediately.

Normal deliveries wait for the current short sentence to finish. A four, six, or wicket interrupts filler and receives immediate priority. **Undo last ball** restores the complete previous scoring state.

## Local components

- Qwen2.5-3B-Instruct Q4_K_M through `llama-cpp-python`
- Microsoft Ravi through the browser Speech Synthesis API
- `match.json` for match facts only; it contains no prepared commentary sentences
- `server.py` for static files and dynamic Qwen commentary generation

No match API, cloud AI, Chatterbox, generated audio file, or database is used in this version.

The launcher currently reuses the model and Python environment from the earlier `cricket-stats-rag` project. Set `CRICKET_LLM_MODEL` before starting `server.py` if the GGUF model is moved.
