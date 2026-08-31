"""Local Chatterbox commentary server. It never sends text or audio online."""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
from threading import Lock, Thread
from typing import Any
from urllib.parse import urlparse


APP_DIR = Path(__file__).resolve().parent
WORKSPACE = APP_DIR.parent.parent
MODEL_DIR = Path.home() / "Downloads"
OUTPUT_DIR = WORKSPACE / "work" / "generated-audio"
HF_CACHE_DIR = WORKSPACE / "work" / "huggingface-cache"
HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(HF_CACHE_DIR))
os.environ.setdefault("PKUSEG_HOME", str(HF_CACHE_DIR / "pkuseg"))
os.environ.setdefault("TORCH_HOME", str(HF_CACHE_DIR / "torch"))
os.environ.setdefault("XDG_CACHE_HOME", str(HF_CACHE_DIR))
os.environ.setdefault("NUMBA_CACHE_DIR", str(HF_CACHE_DIR / "numba"))
os.environ.setdefault("MPLCONFIGDIR", str(HF_CACHE_DIR / "matplotlib"))
HOST = "127.0.0.1"
PORT = 8771
_MODEL: Any | None = None
_MODEL_LOCK = Lock()


class VoiceTesterHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        if request_path == "/api/status":
            return self.send_json(self.setup_status())
        if request_path == "/generated-audio/commentary.wav":
            output = OUTPUT_DIR / "commentary.wav"
            if output.is_file():
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(output.stat().st_size))
                self.end_headers()
                self.wfile.write(output.read_bytes())
            else:
                self.send_error(404)
            return
        if self.path in {"/", "/index.html"}:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        if request_path == "/api/shutdown":
            self.send_json({"message": "Cricket Voice Lab is stopping."})
            Thread(target=self.server.shutdown, daemon=True).start()
            return
        if request_path != "/api/generate":
            self.send_error(404)
            return
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            status = self.setup_status()
            if not status["ready"]:
                self.send_json({"error": status["message"]}, 503)
                return
            text = str(payload.get("text", "")).strip()
            if not text:
                self.send_json({"error": "Enter commentary text first."}, 400)
                return
            self.generate(payload, text)
        except Exception as error:  # keep model errors visible in the local UI
            if getattr(error, "winerror", None) == 1455 or "paging file is too small" in str(error).lower():
                message = "Windows is out of available memory. Close old Voice Lab servers and try again."
            else:
                message = str(error)
            self.send_json({"error": message}, 500)

    def setup_status(self) -> dict[str, Any]:
        needed = ["t3_mtl23ls_v3.safetensors", "s3gen.pt", "ve.pt", "conds.pt", "grapheme_mtl_merged_expanded_v1.json"]
        missing = [name for name in needed if not (MODEL_DIR / name).is_file()]
        installed = importlib.util.find_spec("chatterbox") is not None
        if missing:
            return {"ready": False, "message": f"Missing model file: {missing[0]}"}
        if not installed:
            return {"ready": False, "message": "Chatterbox Python runtime is not installed yet."}
        return {"ready": True, "message": "Chatterbox is ready locally."}

    def generate(self, payload: dict[str, Any], text: str) -> None:
        import torch
        import torchaudio
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        global _MODEL
        seed = payload.get("seed")
        if seed not in (None, ""):
            torch.manual_seed(int(seed))
        with _MODEL_LOCK:
            if _MODEL is None:
                _MODEL = ChatterboxMultilingualTTS.from_local(
                    str(MODEL_DIR),
                    device="cpu",
                    t3_model="t3_mtl23ls_v3.safetensors",
                )
        model = _MODEL
        wav = model.generate(
            text,
            language_id=str(payload.get("language", "en")),
            exaggeration=float(payload.get("exaggeration", 0.45)),
            cfg_weight=float(payload.get("cfg_weight", 0.5)),
            temperature=float(payload.get("temperature", 0.8)),
            repetition_penalty=float(payload.get("repetition_penalty", 1.2)),
        )
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output = OUTPUT_DIR / "commentary.wav"
        torchaudio.save(str(output), wav, model.sr)
        self.send_json({"audio": "/generated-audio/commentary.wav", "message": "Audio generated locally."})

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), VoiceTesterHandler)
    print(f"Cricket Voice Lab is ready at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop it.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCricket Voice Lab stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
