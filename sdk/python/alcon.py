"""Alcon asset relay — the one line a local Python app adds to join its Space.

    import alcon          # that is the line

On import it announces this process to the relay (name, runtime, host, which
AI providers it has keys for, nothing secret), keeps the asset token it gets
back in .alcon/asset.json so a restart is the same asset, and from then on
reports what the app does:

    alcon.event("closed-books", "Q3 closed", {"fy": 2026})

Process start and stop are reported on their own.

Configuration (environment):
    ALCON_RELAY   the relay URL (…/functions/v1/asset-relay)   required
    ALCON_SPACE   the Space id to announce to                  required on first contact
    ALCON_NAME    the asset's name (default: the folder name)
    ALCON_KIND    app | ai_agent | script | service | other (default app)
    ALCON_STATE   where to keep the token (default ./.alcon/asset.json)
    ALCON_SILENT  set to 1 to suppress the one-line notes

Never raises, never blocks the app: a relay that is down or a token that was
revoked is noted once and the app carries on as if the line were not there.
Standard library only; Python 3.8+.
"""

import atexit
import json
import os
import platform
import socket
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone

_RELAY = (os.environ.get("ALCON_RELAY") or "").rstrip("/")
_SPACE = os.environ.get("ALCON_SPACE") or ""
_STATE_PATH = os.environ.get("ALCON_STATE") or os.path.join(os.getcwd(), ".alcon", "asset.json")
_SILENT = os.environ.get("ALCON_SILENT") == "1"
_FLUSH_SECONDS = 5.0

_AI_PROVIDER_KEYS = {
    "anthropic": ["ANTHROPIC_API_KEY"],
    "openai": ["OPENAI_API_KEY"],
    "google": ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    "mistral": ["MISTRAL_API_KEY"],
    "ollama": ["OLLAMA_HOST"],
    "azure_openai": ["AZURE_OPENAI_API_KEY"],
    "aws_bedrock": ["AWS_BEARER_TOKEN_BEDROCK"],
}

_state = {"token": None, "asset_id": None, "status": None, "down": False}
_queue = []
_lock = threading.Lock()
_timer = None


def _note(msg):
    if not _SILENT:
        print("[alcon] " + msg, file=sys.stderr)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read_state():
    try:
        with open(_STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_state(state):
    try:
        os.makedirs(os.path.dirname(_STATE_PATH), exist_ok=True)
        with open(_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        try:
            os.chmod(_STATE_PATH, 0o600)
        except Exception:
            pass
    except Exception as e:  # noqa: BLE001
        _note("could not keep the asset token at %s: %s" % (_STATE_PATH, e))


def _manifest():
    providers = [name for name, keys in _AI_PROVIDER_KEYS.items() if any(os.environ.get(k) for k in keys)]
    entry = os.path.basename(sys.argv[0]) if sys.argv and sys.argv[0] else None
    return {
        "runtime": "python %s" % platform.python_version(),
        "host": socket.gethostname(),
        "platform": "%s %s" % (platform.system(), platform.release()),
        "cwd": os.path.basename(os.getcwd()),
        "entry": entry,
        "ai_providers": providers,
        "sdk": "alcon-python/0.1",
    }


def _post(path, body, with_token):
    headers = {"content-type": "application/json"}
    if with_token and _state["token"]:
        headers["authorization"] = "Bearer " + _state["token"]
    req = urllib.request.Request(_RELAY + path, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode("utf-8") or "null")
        except Exception:
            data = None
        return e.code, data


def _announce():
    if not _RELAY:
        _note("ALCON_RELAY is not set; not connected")
        _state["down"] = True
        return
    name = os.environ.get("ALCON_NAME") or os.path.basename(os.getcwd())
    kind = os.environ.get("ALCON_KIND") or "app"
    saved = _read_state() or {}
    body = {"name": name, "kind": kind, "manifest": _manifest()}
    if saved.get("token"):
        body["token"] = saved["token"]
    elif _SPACE:
        body["space"] = _SPACE
    else:
        _note("ALCON_SPACE is not set and no asset token is kept; not connected")
        _state["down"] = True
        return
    try:
        status, data = _post("/hello", body, False)
        if status == 401 and saved.get("token"):
            if not _SPACE:
                _note("the kept asset token is unknown and ALCON_SPACE is not set; not connected")
                _state["down"] = True
                return
            status, data = _post("/hello", {"name": name, "kind": kind, "manifest": body["manifest"], "space": _SPACE}, False)
    except Exception as e:  # noqa: BLE001
        _note("relay unreachable (%s); carrying on without it" % e)
        _state["down"] = True
        return
    if status == 403:
        _note("this asset was revoked in Alcon; not reporting")
        _state["down"] = True
        return
    if status >= 300 or not data or not data.get("asset_id"):
        code = (data or {}).get("error", {}).get("code", "") if isinstance(data, dict) else ""
        _note("relay refused the hello (%s %s); carrying on without it" % (status, code))
        _state["down"] = True
        return
    _state["asset_id"] = data["asset_id"]
    _state["status"] = data.get("status")
    if data.get("token"):
        _state["token"] = data["token"]
        _write_state({"token": data["token"], "asset_id": data["asset_id"], "relay": _RELAY})
        _note('announced to Alcon as "%s" — waiting for a Space owner to accept it (Settings › Customize › Connected assets)' % name)
    else:
        _state["token"] = saved["token"]
        _note('connected to Alcon as "%s" (%s)' % (name, _state["status"]))
    event("started", "%s started" % name, {"pid": os.getpid(), "entry": body["manifest"]["entry"]})


def _flush():
    global _timer
    with _lock:
        _timer = None
        if _state["down"] or not _state["token"]:
            del _queue[:]
            return
        batch = _queue[:50]
        del _queue[:50]
    if not batch:
        return
    try:
        status, data = _post("/events", {"events": batch}, True)
        if status == 403:
            _note("this asset was revoked in Alcon; not reporting")
            _state["down"] = True
            return
        if status >= 300:
            _note("relay refused %d event(s) (%s)" % (len(batch), status))
    except Exception as e:  # noqa: BLE001
        _note("relay unreachable (%s); %d event(s) dropped" % (e, len(batch)))
    if _queue:
        _schedule()


def _schedule():
    global _timer
    with _lock:
        if _timer is None:
            _timer = threading.Timer(_FLUSH_SECONDS, _flush)
            _timer.daemon = True
            _timer.start()


def event(kind, summary, payload=None):
    """Say what the app just did. Never raises."""
    if _state["down"]:
        return
    with _lock:
        _queue.append({"kind": str(kind)[:60], "summary": str(summary)[:300], "payload": payload, "occurred_at": _now()})
        if len(_queue) > 500:
            del _queue[: len(_queue) - 500]
    _schedule()


def _stop():
    if _state["down"] or not _state["token"]:
        return
    with _lock:
        batch = _queue[:49]
        del _queue[:]
    batch.append({"kind": "stopped", "summary": "Stopped (exit)", "occurred_at": _now()})
    try:
        _post("/events", {"events": batch}, True)
    except Exception:
        pass


atexit.register(_stop)
threading.Thread(target=_announce, daemon=True).start()
