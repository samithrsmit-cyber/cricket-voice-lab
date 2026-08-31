"""Local continuous cricket commentary server backed by the existing Qwen model."""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Lock, Thread
from typing import Any
from urllib.parse import urlparse


APP_DIR = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8772
DEFAULT_MODEL_PATH = (
    Path.home()
    / "Documents"
    / "Codex"
    / "2026-08-24"
    / "hay"
    / "outputs"
    / "cricket-stats-rag"
    / "models"
    / "qwen2.5-3b-instruct-q4_k_m.gguf"
)
MODEL_PATH = Path(os.environ.get("CRICKET_LLM_MODEL", str(DEFAULT_MODEL_PATH)))

_MODEL: Any | None = None
_MODEL_LOCK = Lock()
_MODEL_STATE_LOCK = Lock()
_MODEL_STATE = {"phase": "loading", "message": "Loading the local Qwen commentary model…"}


def set_model_state(phase: str, message: str) -> None:
    with _MODEL_STATE_LOCK:
        _MODEL_STATE["phase"] = phase
        _MODEL_STATE["message"] = message


def load_model() -> None:
    global _MODEL
    try:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(f"Local Qwen model not found: {MODEL_PATH}")
        from llama_cpp import Llama

        _MODEL = Llama(
            model_path=str(MODEL_PATH),
            n_ctx=2048,
            n_threads=max(2, (os.cpu_count() or 4) // 2),
            n_threads_batch=max(2, (os.cpu_count() or 4) // 2),
            n_batch=128,
            n_gpu_layers=0,
            verbose=False,
        )
        set_model_state("ready", "Qwen is ready. Start commentary when you are ready.")
        print(f"Loaded local model: {MODEL_PATH.name}", flush=True)
    except Exception as error:
        set_model_state("error", str(error))
        print(f"Model load failed: {error}", flush=True)


def clean_commentary(raw: str) -> str:
    text = raw.strip().replace("\r", " ").replace("\n", " ")
    text = re.sub(r"^(commentary|commentator|output)\s*:\s*", "", text, flags=re.I)
    text = text.strip(" \"'`*")
    text = re.sub(r"\s+", " ", text)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    text = " ".join(sentence for sentence in sentences[:2] if sentence).strip()
    if len(text) > 360:
        text = text[:360].rsplit(" ", 1)[0].rstrip(" ,;:") + "."
    if text and text[-1] not in ".!?":
        text += "."
    return text


def recent_results_text(results: list[Any]) -> str:
    labels = {"0": "dot", "W": "wicket"}
    return ", ".join(labels.get(str(result), str(result)) for result in results) or "none yet"


def spoken_score(runs: Any, wickets: Any) -> str:
    return f"{runs} for no loss" if int(wickets) == 0 else f"{runs} for {wickets}"


def make_source_fact(payload: dict[str, Any]) -> str:
    mode = str(payload.get("mode", "filler"))
    state = payload.get("state", {})
    event = payload.get("event")
    focus = str(payload.get("focus", "match situation"))
    score = spoken_score(state.get("score", 0), state.get("wickets", 0))
    over = state.get("over", "0.0")
    striker = state.get("striker", "the striker")
    non_striker = state.get("non_striker", "the non-striker")
    bowler = state.get("bowler", "the bowler")

    if mode == "event":
        event = event or {}
        batter = event.get("striker_before") or striker
        position = event.get("field_position")
        if event.get("type") == "correction":
            return "A scoring correction has been made."
        if event.get("type") == "wicket":
            return f"{batter} is out."
        result = event.get("description", "the delivery is complete")
        direction = f" towards {position}" if position else ""
        return f"{batter} recorded {result}{direction}."

    partnership = (
        f"The partnership between {striker} and {non_striker} is "
        f"{state.get('partnership_runs', 0)} runs from {state.get('partnership_balls', 0)} balls."
    )
    if "partnership" in focus or "strike rotation" in focus:
        return partnership
    if "striker" in focus:
        return f"{striker} is the striker. The scoreboard reads {score} after {over} overs."
    if "bowler" in focus:
        return f"{bowler} is bowling the current over. The scoreboard reads {score} after {over} overs."
    if "recent" in focus:
        results = recent_results_text(state.get("recent_balls", []))
        return f"The recent recorded results are {results}. The score is {score} after {over} overs."
    return f"The scoreboard reads {score} after {over} overs."


def make_prompt(payload: dict[str, Any], strict: bool = False) -> list[dict[str, str]]:
    source_fact = make_source_fact(payload)
    mode = str(payload.get("mode", "filler"))
    length_rule = "5 to 16 words" if mode == "event" else "8 to 24 words"
    system = (
        "You are a live cricket radio commentator. Paraphrase the supplied SOURCE FACT into one natural "
        f"spoken sentence of {length_rule}. Preserve its meaning and all numbers exactly. Use no fact, "
        "name, number, judgement, or event that is absent from SOURCE FACT. Do not perform arithmetic. "
        "Return only the sentence: no heading, label, quote, bullet, or stage direction."
    )
    if strict:
        system += (
            " Paraphrase literally. Do not characterize any player or situation. Do not add an adjective, "
            "adverb, cause, prediction, tactic, or interpretation."
        )
    required = ""
    if mode == "event":
        event = payload.get("event") or {}
        required_terms = [str(event.get("striker_before") or "").strip()]
        if event.get("field_position"):
            required_terms.append(str(event["field_position"]).strip())
        required_terms = [term for term in required_terms if term]
        if required_terms:
            required = (
                "\n\nREQUIRED EXACT TERMS\n"
                + " | ".join(required_terms)
                + "\nYour output is invalid unless every required term appears exactly."
            )
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": f"SOURCE FACT\n{source_fact}{required}",
        },
    ]


def is_supported_commentary(
    text: str, source_fact: str, mode: str, payload: dict[str, Any]
) -> bool:
    allowed_numbers = set(re.findall(r"\d+(?:\.\d+)?", source_fact))
    used_numbers = set(re.findall(r"\d+(?:\.\d+)?", text))
    if not used_numbers.issubset(allowed_numbers):
        return False
    if mode == "filler":
        unsupported_judgement = re.compile(
            r"\b(struggl\w*|dominat\w*|comfort\w*|pressure|excellent|brilliant|poor|bad|"
            r"aggress\w*|defens\w*|attack\w*|danger\w*|well|momentum|new ball|form)\b",
            re.I,
        )
        if unsupported_judgement.search(text):
            return False
    if mode == "event":
        event = payload.get("event") or {}
        position = str(event.get("field_position") or "").lower()
        batter = str(event.get("striker_before") or "").lower()
        if position and position not in text.lower():
            return False
        if batter and batter not in text.lower():
            return False
    return True


def generate_commentary(payload: dict[str, Any]) -> str:
    if _MODEL is None:
        raise RuntimeError("The local Qwen model is not ready yet.")
    mode = str(payload.get("mode", "filler"))
    source_fact = make_source_fact(payload)
    commentary = ""
    for strict, temperature in ((True, 0.28), (True, 0.05), (True, 0.0)):
        with _MODEL_LOCK:
            result = _MODEL.create_chat_completion(
                messages=make_prompt(payload, strict=strict),
                temperature=temperature,
                top_p=0.86,
                repeat_penalty=1.14,
                max_tokens=48,
            )
        raw = str(result["choices"][0]["message"]["content"])
        commentary = clean_commentary(raw)
        if commentary and is_supported_commentary(commentary, source_fact, mode, payload):
            break
        print(f"Rejected unsafe commentary: {commentary!r} from {source_fact!r}", flush=True)
        commentary = ""
    if not commentary:
        raise RuntimeError("Qwen did not produce a fact-safe commentary line. Trying again.")
    if mode == "event":
        state = payload.get("state", {})
        event = payload.get("event") or {}
        score = spoken_score(state.get("score", 0), state.get("wickets", 0))
        over = event.get("over_after", state.get("over", "0.0"))
        commentary = f"{commentary} The score is now {score} after {over} overs."
    return commentary


class CommentaryHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/status":
            with _MODEL_STATE_LOCK:
                phase = _MODEL_STATE["phase"]
                message = _MODEL_STATE["message"]
            self.send_json(
                {
                    "ready": phase == "ready",
                    "phase": phase,
                    "message": message,
                    "model": MODEL_PATH.name,
                }
            )
            return
        if path in {"/", "/index.html"}:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/shutdown":
            self.send_json({"message": "Continuous Commentary is stopping."})
            Thread(target=self.server.shutdown, daemon=True).start()
            return
        if path != "/api/commentary":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                self.send_json({"error": "Invalid commentary request."}, 400)
                return
            payload = json.loads(self.rfile.read(length))
            with _MODEL_STATE_LOCK:
                phase = _MODEL_STATE["phase"]
                message = _MODEL_STATE["message"]
            if phase != "ready":
                self.send_json({"error": message}, 503)
                return
            self.send_json({"commentary": generate_commentary(payload)})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        except Exception as error:
            self.send_json({"error": str(error)}, 500)

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


class CommentaryServer(ThreadingHTTPServer):
    allow_reuse_address = True


def main() -> None:
    Thread(target=load_model, daemon=True).start()
    server = CommentaryServer((HOST, PORT), CommentaryHandler)
    print(f"Continuous Commentary is available at http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nContinuous Commentary stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
