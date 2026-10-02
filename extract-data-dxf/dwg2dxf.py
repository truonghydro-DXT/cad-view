#!/usr/bin/env python3
"""Chuyển DWG → DXF bằng GNU LibreDWG (dwg2dxf.exe), chuẩn hóa font/chữ tiếng Việt."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

LIBREDWG_DIR = HERE / "libredwg-0.14.8597-win64"
DWG2DXF_EXE = LIBREDWG_DIR / "dwg2dxf.exe"
VALID_VERSIONS = (
    "r12",
    "r14",
    "r2000",
    "r2004",
    "r2007",
    "r2010",
    "r2013",
    "r2018",
)
_ATTRIB_INVISIBLE = 1
_MIF_RE = re.compile(r"\\[Uu]\+([0-9A-Fa-f]{4})")
_SHX_TO_TTF = {
    "txt": "BeVietnamPro-Regular.ttf",
    "txt.shx": "BeVietnamPro-Regular.ttf",
}


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _dwg2dxf_exe() -> Path:
    env = os.environ.get("LIBREDWG_DWG2DXF", "").strip()
    if env:
        candidate = Path(env)
        if candidate.is_file():
            return candidate.resolve()
    if DWG2DXF_EXE.is_file():
        return DWG2DXF_EXE
    found = shutil.which("dwg2dxf") or shutil.which("dwg2dxf.exe")
    if found:
        return Path(found).resolve()
    raise FileNotFoundError(
        f"Không thấy dwg2dxf.exe. Đặt LibreDWG tại: {LIBREDWG_DIR}"
    )


def _verify_dxf(path: Path) -> dict:
    try:
        import ezdxf
        from ezdxf.recover import readfile as recover

        try:
            doc = ezdxf.readfile(str(path))
        except Exception:
            doc, _auditor = recover(str(path))
        entity_count = sum(1 for _ in doc.modelspace())
        types = Counter(e.dxftype() for e in doc.modelspace())
        return {
            "verified": True,
            "version": doc.dxfversion,
            "entities": entity_count,
            "types": dict(types.most_common(12)),
        }
    except Exception as error:
        return {"verified": False, "version": "", "entities": 0, "error": str(error)}


def _read_dxf_doc(path: Path):
    import ezdxf
    from ezdxf.recover import readfile as recover

    try:
        return ezdxf.readfile(str(path))
    except Exception:
        doc, _auditor = recover(str(path))
        return doc


def _decode_mif(text: str) -> str:
    if not text:
        return text
    return _MIF_RE.sub(lambda match: chr(int(match.group(1), 16)), text)


def _plain_text(text: str) -> str:
    try:
        from vn_text import to_unicode
    except Exception:
        def to_unicode(value: str) -> str:
            return value

    cleaned = (
        _decode_mif(text)
        .replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )
    return to_unicode(cleaned)


def _dxf_text_value(text: str) -> str:
    cleaned = _plain_text(text)
    if not cleaned:
        return ""
    encoded: list[str] = []
    size = 0
    for char in cleaned:
        code = ord(char)
        piece = char if 32 <= code < 127 and char != "\\" else f"\\U+{code:04X}"
        if size + len(piece) > 250:
            break
        encoded.append(piece)
        size += len(piece)
    return "".join(encoded)


def _merge_text_records(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple, dict[str, Any]] = {}
    for group in groups:
        for record in group:
            text = _plain_text(str(record.get("text") or ""))
            if not text:
                continue
            record = {**record, "text": text}
            key = (round(float(record["x"]), 2), round(float(record["y"]), 2))
            previous = merged.get(key)
            if previous is None or len(text) > len(str(previous.get("text") or "")):
                merged[key] = record
    return list(merged.values())


def _collect_dxf_texts(path: Path) -> list[dict[str, Any]]:
    doc = _read_dxf_doc(path)
    records: list[dict[str, Any]] = []
    for layout in doc.layouts:
        for entity in layout.query("TEXT"):
            point = entity.dxf.insert
            records.append(
                {
                    "kind": "TEXT",
                    "text": entity.dxf.text,
                    "x": float(point.x),
                    "y": float(point.y),
                    "z": float(getattr(point, "z", 0.0) or 0.0),
                    "height": float(entity.dxf.get("height") or 1.0),
                    "rotation": float(entity.dxf.get("rotation") or 0.0),
                    "layer": str(entity.dxf.get("layer") or "0"),
                    "style": str(entity.dxf.get("style") or "Standard"),
                }
            )
        for entity in layout.query("MTEXT"):
            point = entity.dxf.insert
            try:
                text = entity.plain_text()
            except Exception:
                text = entity.text
            records.append(
                {
                    "kind": "MTEXT",
                    "text": text,
                    "x": float(point.x),
                    "y": float(point.y),
                    "z": float(getattr(point, "z", 0.0) or 0.0),
                    "height": float(entity.dxf.get("char_height") or 1.0),
                    "rotation": float(entity.dxf.get("rotation") or 0.0),
                    "layer": str(entity.dxf.get("layer") or "0"),
                    "style": str(entity.dxf.get("style") or "Standard"),
                }
            )
        for insert in layout.query("INSERT"):
            for attrib in insert.attribs:
                if int(attrib.dxf.get("flags", 0) or 0) & _ATTRIB_INVISIBLE:
                    continue
                point = attrib.dxf.insert
                records.append(
                    {
                        "kind": "ATTRIB",
                        "text": attrib.dxf.text,
                        "x": float(point.x),
                        "y": float(point.y),
                        "z": float(getattr(point, "z", 0.0) or 0.0),
                        "height": float(attrib.dxf.get("height") or 1.0),
                        "rotation": float(attrib.dxf.get("rotation") or 0.0),
                        "layer": str(attrib.dxf.get("layer") or "0"),
                        "style": str(attrib.dxf.get("style") or "Standard"),
                    }
                )
    return records


def _collect_ezdwg_texts(src: Path) -> list[dict[str, Any]]:
    try:
        import ezdwg
    except Exception:
        return []
    try:
        document = ezdwg.read(str(src))
    except Exception as error:
        _log(f"Không đọc chữ bằng ezdwg: {error}")
        return []

    records: list[dict[str, Any]] = []
    try:
        layouts = [document.modelspace(), document.entities()]
    except Exception:
        layouts = [document.modelspace()]
    for layout in layouts:
        for dxftype in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
            try:
                entities = layout.query(dxftype)
            except Exception:
                continue
            for entity in entities:
                dxf = getattr(entity, "dxf", None) or {}
                if dxftype == "ATTRIB" and int(dxf.get("attribute_flags") or 0) & _ATTRIB_INVISIBLE:
                    continue
                insert = dxf.get("insert") or dxf.get("align_point")
                if insert is None:
                    continue
                try:
                    x, y = float(insert[0]), float(insert[1])
                    z = float(insert[2]) if len(insert) > 2 else 0.0
                except Exception:
                    continue
                records.append(
                    {
                        "kind": dxftype,
                        "text": dxf.get("text") or dxf.get("contents") or "",
                        "x": x,
                        "y": y,
                        "z": z,
                        "height": float(dxf.get("height") or dxf.get("char_height") or 1.0),
                        "rotation": float(dxf.get("rotation") or 0.0),
                        "layer": str(dxf.get("layer") or "0"),
                        "style": "Standard",
                    }
                )
    return records


def _max_dxf_handle(lines: list[str]) -> int:
    highest = 0
    for index in range(0, len(lines) - 1, 2):
        if lines[index].strip() != "5":
            continue
        try:
            highest = max(highest, int(lines[index + 1].strip(), 16))
        except Exception:
            continue
    return highest


def _find_entities_endsec(lines: list[str]) -> int:
    in_entities = False
    for index in range(0, len(lines) - 1, 2):
        code = lines[index].strip()
        value = lines[index + 1].strip()
        if (
            code == "0"
            and value == "SECTION"
            and index + 3 < len(lines)
            and lines[index + 2].strip() == "2"
            and lines[index + 3].strip() == "ENTITIES"
        ):
            in_entities = True
            continue
        if in_entities and code == "0" and value == "ENDSEC":
            return index
    return -1


def _existing_ascii_text_keys(lines: list[str]) -> set[tuple]:
    keys: set[tuple] = set()
    index = 0
    while index < len(lines) - 1:
        if lines[index].strip() != "0" or lines[index + 1].strip() not in {"TEXT", "MTEXT"}:
            index += 2
            continue
        x = y = None
        content = ""
        index += 2
        while index < len(lines) - 1 and lines[index].strip() != "0":
            code = lines[index].strip()
            value = lines[index + 1]
            if code == "10":
                try:
                    x = float(value.strip())
                except Exception:
                    pass
            elif code == "20":
                try:
                    y = float(value.strip())
                except Exception:
                    pass
            elif code == "1":
                content = value
            index += 2
        if x is not None and y is not None and content:
            keys.add((round(x, 4), round(y, 4), content.strip()))
    return keys


def _text_entity_pairs(handle: int, record: dict[str, Any], text: str) -> list[str]:
    layer = str(record.get("layer") or "0") or "0"
    style = str(record.get("style") or "Standard") or "Standard"
    if not layer.isascii():
        layer = "0"
    if not style.isascii():
        style = "Standard"
    height = max(float(record["height"] or 1.0), 0.01)
    rotation = float(record["rotation"] or 0.0)
    return [
        "0",
        "TEXT",
        "5",
        f"{handle:X}",
        "100",
        "AcDbEntity",
        "8",
        layer,
        "100",
        "AcDbText",
        "10",
        f"{float(record['x']):.10f}",
        "20",
        f"{float(record['y']):.10f}",
        "30",
        f"{float(record['z']):.10f}",
        "40",
        f"{height:.10f}",
        "1",
        text,
        "50",
        f"{rotation:.10f}",
        "7",
        style,
        "100",
        "AcDbText",
    ]


def _set_handseed(lines: list[str], handle: int) -> None:
    for index in range(0, len(lines) - 3, 2):
        if lines[index].strip() == "9" and lines[index + 1].strip() == "$HANDSEED":
            lines[index + 3] = f"{handle:X}"
            return


def _patch_style_fonts(path: Path) -> int:
    raw = path.read_bytes()
    if len(raw) < 32:
        return 0
    newline = b"\r\n" if b"\r\n" in raw[:80] else b"\n"
    lines = raw.decode("latin1").splitlines()
    in_tables = False
    in_style = False
    changed = 0
    for index in range(0, len(lines) - 1, 2):
        code = lines[index].strip()
        value = lines[index + 1].strip()
        if code == "2" and value == "TABLES":
            in_tables = True
            continue
        if in_tables and code == "0" and value == "ENDSEC":
            break
        if not in_tables:
            continue
        if code == "0" and value == "STYLE":
            in_style = True
            continue
        if code == "0":
            in_style = False
            continue
        if in_style and code == "3":
            mapped = _SHX_TO_TTF.get(value.lower())
            if mapped and mapped != value:
                lines[index + 1] = mapped
                changed += 1
    if changed:
        path.write_bytes(newline.join(line.encode("latin1") for line in lines) + newline)
    return changed


def _rewrite_attrib_text(path: Path) -> int:
    """Ghi lại ATTRIB LibreDWG thành \\U+XXXX để viewer đọc Unicode."""
    raw = path.read_bytes()
    if len(raw) < 32:
        return 0
    newline = b"\r\n" if b"\r\n" in raw[:80] else b"\n"
    lines = raw.decode("latin1").splitlines()
    changed = 0
    in_attrib = False
    index = 0
    while index < len(lines) - 1:
        code = lines[index].strip()
        value = lines[index + 1].strip()
        if code == "0":
            in_attrib = value == "ATTRIB"
            index += 2
            continue
        if in_attrib and code == "1":
            encoded = _dxf_text_value(lines[index + 1])
            if encoded and encoded != lines[index + 1]:
                lines[index + 1] = encoded
                changed += 1
        index += 2
    if changed:
        path.write_bytes(newline.join(line.encode("latin1") for line in lines) + newline)
    return changed


def _inject_collected_texts(path: Path, records: list[dict[str, Any]]) -> int:
    if not records:
        return 0
    raw = path.read_bytes()
    if len(raw) < 32:
        return 0
    newline = b"\r\n" if b"\r\n" in raw[:80] else b"\n"
    lines = raw.decode("latin1").splitlines()
    endsec = _find_entities_endsec(lines)
    if endsec < 0:
        return 0

    existing = _existing_ascii_text_keys(lines)
    next_handle = _max_dxf_handle(lines) + 1
    inserted: list[str] = []
    added = 0
    for record in records:
        text = _dxf_text_value(str(record["text"]))
        if not text:
            continue
        key = (round(float(record["x"]), 4), round(float(record["y"]), 4), text.strip())
        if key in existing:
            continue
        inserted.extend(_text_entity_pairs(next_handle, record, text))
        existing.add(key)
        next_handle += 1
        added += 1
    if not added:
        return 0
    lines[endsec:endsec] = inserted
    _set_handseed(lines, next_handle)
    path.write_bytes(newline.join(line.encode("latin1") for line in lines) + newline)
    return added


def _normalize_vietnamese_dxf(src: Path, dest: Path) -> dict[str, int]:
    try:
        from convert_dxf2dxf import patch_aspose_codepage

        patch_aspose_codepage(dest)
    except Exception:
        pass

    patched_fonts = _patch_style_fonts(dest)
    rewritten = _rewrite_attrib_text(dest)
    records = _merge_text_records(
        _collect_dxf_texts(dest),
        _collect_ezdwg_texts(src),
    )
    injected = _inject_collected_texts(dest, records)
    return {
        "fonts": patched_fonts,
        "attribs": rewritten,
        "texts_found": len(records),
        "texts_added": injected,
    }


def _run_dwg2dxf(
    exe: Path,
    src: Path,
    dest: Path,
    *,
    version: str | None = None,
    timeout_s: int = 180,
) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()

    command = [str(exe), "-y", "-o", str(dest), str(src)]
    if version:
        command[1:1] = ["--as", version]

    env = os.environ.copy()
    exe_dir = str(exe.parent)
    env["PATH"] = exe_dir + os.pathsep + env.get("PATH", "")

    completed = subprocess.run(
        command,
        cwd=str(exe.parent),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=timeout_s,
        check=False,
    )
    log = ((completed.stdout or "") + "\n" + (completed.stderr or "")).strip()
    if completed.returncode != 0:
        raise RuntimeError(
            f"LibreDWG dwg2dxf thất bại (mã {completed.returncode}).\n{log}"
        )
    if not dest.is_file() or dest.stat().st_size < 32:
        raise RuntimeError(
            f"LibreDWG không tạo được file DXF.\n{log}"
        )
    return log


def convert_dwg_to_dxf(
    input_path: str | Path,
    output_path: str | Path | None = None,
    *,
    json_out: bool = False,
    version: str | None = None,
    timeout_s: int = 180,
) -> Path:
    src = Path(input_path).resolve()
    if not src.is_file():
        raise FileNotFoundError(f"Không thấy file: {src}")
    if src.suffix.lower() != ".dwg":
        raise ValueError(f"Cần file .dwg, nhận: {src.suffix}")

    if output_path is None:
        dest = src.with_suffix(".dxf")
    else:
        dest = Path(output_path).resolve()

    exe = _dwg2dxf_exe()
    as_version = (version or "").strip().lower() or None
    if as_version and as_version not in VALID_VERSIONS:
        raise ValueError(
            f"Phiên bản DXF không hỗ trợ: {as_version}. "
            f"Dùng: {', '.join(VALID_VERSIONS)}"
        )

    _log(f"DWG → DXF bằng LibreDWG dwg2dxf: {src}")
    log = _run_dwg2dxf(exe, src, dest, version=as_version, timeout_s=timeout_s)
    for line in log.splitlines():
        stripped = line.strip()
        if stripped.startswith(("Writing", "Reading")):
            _log(stripped)

    vietnamese = {"fonts": 0, "attribs": 0, "texts_found": 0, "texts_added": 0}
    try:
        vietnamese = _normalize_vietnamese_dxf(src, dest)
        if vietnamese["fonts"]:
            _log(f"Đã đổi {vietnamese['fonts']} font SHX sang BeVietnamPro.")
        if vietnamese["texts_added"]:
            _log(f"Đã bổ sung {vietnamese['texts_added']} chữ tiếng Việt vào DXF.")
    except Exception as error:
        _log(f"Không chuẩn hóa font/chữ tiếng Việt: {error}")

    report = _verify_dxf(dest)
    if not report.get("verified"):
        raise RuntimeError(
            f"DXF LibreDWG không đọc được: {report.get('error') or 'không rõ'}"
        )

    payload = {
        "ok": True,
        "output": str(dest),
        "converter": "libredwg",
        "mode": "dwg2dxf",
        "version_arg": as_version or "native",
        "entities": int(report.get("entities") or 0),
        "verified": True,
        "dxf_version": report.get("version") or "",
        "types": report.get("types") or {},
        "file_size": dest.stat().st_size,
        "exe": str(exe),
        **vietnamese,
    }
    if json_out:
        print(json.dumps(payload, ensure_ascii=False), flush=True)
    else:
        _log(
            f"DXF: {dest} ({payload['file_size']} bytes, "
            f"{payload['entities']} đối tượng, {payload['dxf_version']})"
        )
    return dest


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Chuyển DWG → DXF bằng GNU LibreDWG dwg2dxf.exe."
    )
    parser.add_argument("input", help="File .dwg")
    parser.add_argument("-o", "--output", help="File .dxf đầu ra")
    parser.add_argument(
        "--as",
        dest="version",
        metavar="rNNNN",
        help="Phiên bản DXF: " + ", ".join(VALID_VERSIONS),
    )
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="Timeout giây (mặc định 180)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        convert_dwg_to_dxf(
            args.input,
            args.output,
            json_out=args.json,
            version=args.version,
            timeout_s=args.timeout,
        )
    except subprocess.TimeoutExpired:
        print("ERROR: LibreDWG dwg2dxf quá thời gian chờ.", file=sys.stderr)
        if args.json:
            print(
                json.dumps(
                    {"ok": False, "message": "LibreDWG dwg2dxf timeout"},
                    ensure_ascii=False,
                ),
                flush=True,
            )
        return 1
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        if args.json:
            print(
                json.dumps({"ok": False, "message": str(error)}, ensure_ascii=False),
                flush=True,
            )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
