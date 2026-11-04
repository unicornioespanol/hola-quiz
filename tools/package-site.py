"""Package only browser assets for GitHub Pages; optionally require configured live play."""
import argparse
import base64
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def validate_config(content):
    def field(name):
        match = re.search(r"\b" + name + r"['\"]?\s*:\s*(['\"])([^'\"\r\n]*)\1", content)
        return match.group(2).strip() if match else ""

    url = field("supabaseUrl")
    key = field("supabasePublishableKey") or field("supabaseAnonKey")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co") or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Set a valid HTTPS Supabase Project URL in config.js before publishing.")
    if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        try:
            payload = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if claims.get("role") != "anon":
                raise ValueError("Only a publishable or legacy anon key is allowed.")
        except (ValueError, IndexError, KeyError) as error:
            raise ValueError("Set a public publishable key in config.js. Secret and service_role keys must never be published.") from error


def package(require_live=False):
    config = (ROOT / "config.js").read_text(encoding="utf-8")
    if require_live:
        validate_config(config)
    elif "sb_secret_" in config:
        raise ValueError("Secret keys cannot be included in browser assets.")
    target = ROOT / "dist"
    # No recursive deletion: overwrite known browser files only.
    target.mkdir(exist_ok=True)
    for name in ("index.html", "config.js", ".nojekyll"):
        shutil.copy2(ROOT / name, target / name)
    for name in ("assets", "js"):
        shutil.copytree(ROOT / name, target / name, dirs_exist_ok=True)
    print("Static site prepared in dist/." + (" Live configuration checked." if require_live else " Practice preview; live configuration not required."))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-live", action="store_true")
    arguments = parser.parse_args()
    try:
        package(arguments.require_live)
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
