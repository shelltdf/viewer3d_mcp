import base64
import pathlib
import sys


ROOT = pathlib.Path(
    r"e:\ai_dev\ai_rules_template_3dviewer\ai-software-engineering\00-concept\mayaUI\downloads\www.cg.com.tw_Maya-UI\images"
)
OUT = ROOT / "svg"


def mime_for(path: pathlib.Path) -> str:
    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".gif":
        return "image/gif"
    if ext == ".webp":
        return "image/webp"
    if ext == ".bmp":
        return "image/bmp"
    if ext == ".avif":
        return "image/avif"
    return "application/octet-stream"


def png_size(data: bytes):
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        w = int.from_bytes(data[16:20], "big")
        h = int.from_bytes(data[20:24], "big")
        return w, h
    return None


def main():
    if not ROOT.exists():
        print(f"[ERROR] source dir not found: {ROOT}")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"}
    files = [p for p in ROOT.iterdir() if p.is_file() and p.suffix.lower() in exts]
    print(f"[INFO] found {len(files)} image file(s)")
    ok = 0
    for i, p in enumerate(sorted(files), start=1):
        data = p.read_bytes()
        mime = mime_for(p)
        b64 = base64.b64encode(data).decode("ascii")
        size = png_size(data)
        if size:
            w, h = size
            svg = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
                f'  <image href="data:{mime};base64,{b64}" x="0" y="0" width="{w}" height="{h}" />\n'
                "</svg>\n"
            )
        else:
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">\n'
                f'  <image href="data:{mime};base64,{b64}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" />\n'
                "</svg>\n"
            )
        out = OUT / f"{p.stem}.svg"
        out.write_text(svg, encoding="utf-8")
        ok += 1
        print(f"[{i}/{len(files)}] [OK] {out.name}")
    print(f"[DONE] wrote {ok} svg file(s) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

