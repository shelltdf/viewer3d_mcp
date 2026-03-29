import os
import re
import sys
import json
import hashlib
import pathlib
import urllib.parse
import urllib.request
from html.parser import HTMLParser


ROOT = pathlib.Path(__file__).resolve().parent
URL_FILE = ROOT / "URL.txt"
OUT_DIR = ROOT / "downloads"
TIMEOUT = 30
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


class ImgParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "img":
            src = attrs.get("src")
            if src:
                self.sources.append(src)
            srcset = attrs.get("srcset")
            if srcset:
                for part in srcset.split(","):
                    item = part.strip().split(" ")[0].strip()
                    if item:
                        self.sources.append(item)
        if tag.lower() == "meta":
            prop = (attrs.get("property") or attrs.get("name") or "").lower()
            if prop in {"og:image", "twitter:image"} and attrs.get("content"):
                self.sources.append(attrs["content"])


def read_urls(path: pathlib.Path):
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        lines.append(s)
    return lines


def safe_name(url: str):
    parsed = urllib.parse.urlparse(url)
    suffix = pathlib.Path(parsed.path).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}:
        suffix = ".bin"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    tail = pathlib.Path(parsed.path).name or "image"
    tail = re.sub(r"[^a-zA-Z0-9._-]", "_", tail)
    if "." not in tail:
        tail = tail + suffix
    return f"{digest}_{tail}"


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = resp.read()
        ctype = resp.headers.get("Content-Type", "")
        return data, ctype


def main():
    if not URL_FILE.exists():
        print(f"[ERROR] URL file not found: {URL_FILE}")
        return 1

    urls = read_urls(URL_FILE)
    if not urls:
        print("[ERROR] No URLs found in URL.txt")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"pages": []}

    print(f"[INFO] Found {len(urls)} URL(s).")
    for idx, page_url in enumerate(urls, start=1):
        print(f"\n[{idx}/{len(urls)}] Page: {page_url}")
        page_rec = {
            "url": page_url,
            "html_saved": None,
            "images_total": 0,
            "images_saved": 0,
            "errors": [],
        }
        manifest["pages"].append(page_rec)

        parsed = urllib.parse.urlparse(page_url)
        page_dir_name = f"{parsed.netloc}{parsed.path}".strip("/").replace("/", "_")
        if not page_dir_name:
            page_dir_name = parsed.netloc
        page_dir_name = re.sub(r"[^a-zA-Z0-9._-]", "_", page_dir_name)
        page_dir = OUT_DIR / page_dir_name
        img_dir = page_dir / "images"
        img_dir.mkdir(parents=True, exist_ok=True)

        try:
            html_bytes, ctype = fetch(page_url)
            html_path = page_dir / "index.html"
            html_path.write_bytes(html_bytes)
            page_rec["html_saved"] = str(html_path)
            print(f"  [OK] HTML saved -> {html_path} ({len(html_bytes)} bytes, {ctype})")
        except Exception as e:
            msg = f"  [ERR] HTML fetch failed: {e}"
            page_rec["errors"].append(msg)
            print(msg)
            continue

        text = html_bytes.decode("utf-8", errors="ignore")
        parser = ImgParser()
        parser.feed(text)

        candidates = []
        seen = set()
        for src in parser.sources:
            abs_url = urllib.parse.urljoin(page_url, src)
            p = urllib.parse.urlparse(abs_url)
            if p.scheme not in {"http", "https"}:
                continue
            if abs_url in seen:
                continue
            seen.add(abs_url)
            candidates.append(abs_url)

        page_rec["images_total"] = len(candidates)
        print(f"  [INFO] Found {len(candidates)} image candidate(s).")

        for i, img_url in enumerate(candidates, start=1):
            try:
                data, ctype = fetch(img_url)
                lower_ct = ctype.lower()
                if "image/" not in lower_ct and pathlib.Path(urllib.parse.urlparse(img_url).path).suffix.lower() not in {
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".gif",
                    ".webp",
                    ".svg",
                    ".bmp",
                    ".avif",
                }:
                    print(f"    [{i}/{len(candidates)}] [SKIP] Not image content-type: {img_url} ({ctype})")
                    continue
                fname = safe_name(img_url)
                out = img_dir / fname
                out.write_bytes(data)
                page_rec["images_saved"] += 1
                print(f"    [{i}/{len(candidates)}] [OK] {out.name} ({len(data)} bytes)")
            except Exception as e:
                print(f"    [{i}/{len(candidates)}] [ERR] {img_url} -> {e}")

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[DONE] Manifest saved -> {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

