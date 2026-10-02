#!/usr/bin/env python3
"""Chuyển DWG → DXF bằng aspose-cad, giữ entity/lớp/block gốc (CONVERT)."""
# pyright: reportMissingModuleSource=false
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

os.environ.setdefault("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", "1")
os.environ.setdefault("PYTHONUTF8", "1")

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

_DROP_OBJECT_TYPES = frozenset(
    {"VISUALSTYLE", "MATERIAL", "ACAD_PROXY_OBJECT"}
)
_ATTRIB_INVISIBLE = 1
_TYPE_ATTDEF = 5
_TYPE_ATTRIB = 6
_TYPE_INSERT = 15
_TYPE_MTEXT = 26
_TYPE_TEXT = 41
_MIF_RE = re.compile(r"\\[Uu]\+([0-9A-Fa-f]{4})")
_SHX_TO_TTF = {
    "txt": "BeVietnamPro-Regular.ttf",
    "txt.shx": "BeVietnamPro-Regular.ttf",
}


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _import_aspose():
    try:
        import aspose.cad as cad
        from aspose.cad.imageoptions import DxfOptions
    except ImportError as error:
        raise RuntimeError(
            "Chưa cài aspose-cad. Chạy: pnpm setup:python"
        ) from error
    return cad, DxfOptions


def _verify_dxf(path: Path) -> dict:
    try:
        import ezdxf

        doc = ezdxf.readfile(str(path))
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


def _strip_dxf_entities(src: Path, drop_types: frozenset[str]) -> int:
    """Remove named OBJECTS that break ezdxf, keep drawing entities intact."""
    raw = src.read_bytes()
    newline = b"\r\n" if b"\r\n" in raw[:80] else b"\n"
    text = raw.decode("latin1")
    lines = text.splitlines()
    out: list[str] = []
    dropped = 0
    i = 0
    skipping = False
    while i < len(lines):
        code = lines[i].strip()
        value = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if skipping:
            if code == "0":
                skipping = False
                continue
            i += 2
            continue
        if code == "0" and value in drop_types:
            skipping = True
            dropped += 1
            i += 2
            continue
        out.append(lines[i])
        if i + 1 < len(lines):
            out.append(lines[i + 1])
        i += 2
    if dropped:
        src.write_bytes((newline.join(line.encode("latin1") for line in out) + newline))
    return dropped


def _native_dxf_options(cad, DxfOptions, image=None):
    options = DxfOptions()
    options.output_mode = cad.imageoptions.CadOutputMode.CONVERT
    options.text_as_lines = False
    options.convert_mesh_to_lines = False
    options.convert_text_beziers = False
    options.merge_lines_inside_contour = False
    options.pretty_formatting = True
    options.render_to_graphics_bound = False
    ascii_fmt = getattr(type(options.dxf_file_format), "ASCII", None)
    if ascii_fmt is not None:
        options.dxf_file_format = ascii_fmt
    layer_names = _layer_names(image) if image is not None else []
    if layer_names:
        options.layers = layer_names
    return options


def _save_dxf(image, dest: Path, cad, DxfOptions) -> None:
    try:
        from aspose.cad import CodePages

        image.specified_encoding = CodePages.UTF8
    except Exception:
        try:
            from aspose.cad import CodePages

            image.specified_encoding = CodePages.VIETNAM
        except Exception:
            pass
    try:
        image.save(str(dest), _native_dxf_options(cad, DxfOptions, image))
    except Exception as error:
        _log(f"CONVERT kèm layers lỗi ({error}); thử lại không lọc layer.")
        image.save(str(dest), _native_dxf_options(cad, DxfOptions, None))
    if not dest.is_file() or dest.stat().st_size < 32:
        raise RuntimeError("aspose-cad CONVERT không tạo được file DXF.")


def _layer_names(image) -> list[str]:
    names: list[str] = []
    layers = getattr(image, "layers", None)
    if layers is None:
        return names
    try:
        seq = list(layers)
    except Exception:
        return names
    for layer in seq:
        name = getattr(layer, "name", None) or getattr(layer, "layer_name", None)
        if name:
            names.append(str(name))
    return names


def _type_code(entity) -> int:
    try:
        return int(entity.type_name)
    except Exception:
        return -1


def _point_xyz(point) -> tuple[float, float, float] | None:
    if point is None:
        return None
    try:
        return (
            float(point.x),
            float(point.y),
            float(getattr(point, "z", 0.0) or 0.0),
        )
    except Exception:
        return None


def _entity_text(entity) -> str:
    for name in (
        "default_text",
        "default_value",
        "text",
        "additional_text",
    ):
        value = getattr(entity, name, None)
        if isinstance(value, str) and value.strip():
            return value
    extra = getattr(entity, "additional_text_list", None)
    if extra:
        try:
            parts = [str(item) for item in extra if str(item).strip()]
            if parts:
                return "\n".join(parts)
        except Exception:
            pass
    return ""


def _entity_layer(entity) -> str:
    name = getattr(entity, "layer_name", None) or getattr(entity, "layer", None)
    return str(name) if name else "0"


def _entity_style(entity) -> str:
    name = (
        getattr(entity, "style_type", None)
        or getattr(entity, "attribute_text_style_name", None)
        or getattr(entity, "style_name", None)
    )
    return str(name) if name else "Standard"


def _entity_height(entity) -> float:
    for name in ("text_height", "initial_text_height", "height"):
        value = getattr(entity, name, None)
        if value is None:
            continue
        try:
            height = float(value)
        except Exception:
            continue
        if height > 0:
            return height
    return 1.0


def _entity_rotation_deg(entity) -> float:
    rad = getattr(entity, "rotation_angle_rad", None)
    if rad:
        try:
            return float(rad) * 180.0 / math.pi
        except Exception:
            pass
    for name in (
        "text_rotation",
        "attribute_text_rotation",
        "rotation_angle",
        "rotation",
    ):
        value = getattr(entity, name, None)
        if value is None:
            continue
        try:
            return float(value)
        except Exception:
            continue
    return 0.0


def _entity_insert(entity) -> tuple[float, float, float] | None:
    for name in (
        "text_start_point",
        "first_alignment",
        "insertion_point",
        "attrib_alignment_point",
    ):
        xyz = _point_xyz(getattr(entity, name, None))
        if xyz is not None:
            return xyz
    return None


def _iter_block_entities(image):
    blocks = getattr(image, "block_entities", None)
    if blocks is None:
        return
    try:
        names = list(blocks.keys)
        values = list(blocks.values)
    except Exception:
        return
    for name, block in zip(names, values):
        entities = getattr(block, "entities", None)
        if entities is None:
            continue
        try:
            seq = list(entities)
        except Exception:
            continue
        yield str(name or ""), seq


def _is_model_block(name: str) -> bool:
    normalized = name.strip().lower()
    return normalized in {"*model_space", "model_space", "*modelspace"}


def _is_paper_block(name: str) -> bool:
    normalized = name.strip().lower()
    return normalized.startswith("*paper") or normalized in {"paper_space", "*paperspace"}


def _is_visible_attrib(entity) -> bool:
    flags = getattr(entity, "attribute_flags", None)
    try:
        return (int(flags or 0) & _ATTRIB_INVISIBLE) == 0
    except Exception:
        return True


def _text_record(entity, *, kind: str) -> dict[str, Any] | None:
    text = _entity_text(entity).strip()
    if not text:
        return None
    insert = _entity_insert(entity)
    if insert is None:
        return None
    height = _entity_height(entity)
    if height > 1_000_000:
        return None
    return {
        "kind": kind,
        "text": text,
        "x": insert[0],
        "y": insert[1],
        "z": insert[2],
        "height": height,
        "rotation": _entity_rotation_deg(entity),
        "layer": _entity_layer(entity),
        "style": _entity_style(entity),
    }


def _collect_cad_texts(image) -> list[dict[str, Any]]:
    """Lấy TEXT/MTEXT/ATTRIB từ CadImage — CONVERT thường bỏ ATTDEF nên viewer mất chữ."""
    try:
        from aspose.pycore import cast
        from aspose.cad.fileformats.cad import CadImage
        from aspose.cad.fileformats.cad.cadobjects import CadInsertObject, CadMText, CadText
        from aspose.cad.fileformats.cad.cadobjects.attentities import CadAttDef, CadAttrib
    except Exception as error:
        _log(f"Không đọc chữ từ CadImage: {error}")
        return []

    try:
        cad_image = cast(CadImage, image)
    except Exception:
        cad_image = image

    collected: list[dict[str, Any]] = []
    seen: set[tuple] = set()

    def add_record(record: dict[str, Any] | None) -> None:
        if record is None:
            return
        key = (
            round(record["x"], 4),
            round(record["y"], 4),
            record["text"],
        )
        if key in seen:
            return
        seen.add(key)
        collected.append(record)

    try:
        blocks = list(_iter_block_entities(cad_image))
    except Exception as error:
        _log(f"Không duyệt block DWG: {error}")
        return []

    for block_name, entities in blocks:
        in_model = _is_model_block(block_name)
        in_layout = in_model or _is_paper_block(block_name)
        for entity in entities:
            code = _type_code(entity)
            try:
                if in_layout and code == _TYPE_TEXT:
                    add_record(_text_record(cast(CadText, entity), kind="TEXT"))
                elif in_layout and code == _TYPE_MTEXT:
                    add_record(_text_record(cast(CadMText, entity), kind="MTEXT"))
                elif in_layout and code == _TYPE_ATTDEF:
                    add_record(_text_record(cast(CadAttDef, entity), kind="ATTDEF"))
                elif in_layout and code == _TYPE_INSERT:
                    insert = cast(CadInsertObject, entity)
                    children = list(getattr(insert, "child_objects", None) or [])
                    for child in children:
                        if _type_code(child) != _TYPE_ATTRIB:
                            continue
                        attrib = cast(CadAttrib, child)
                        if not _is_visible_attrib(attrib):
                            continue
                        add_record(_text_record(attrib, kind="ATTRIB"))
            except Exception:
                continue

    return collected


def _decode_mif(text: str) -> str:
    if not text:
        return text
    return _MIF_RE.sub(lambda match: chr(int(match.group(1), 16)), text)


def _merge_text_records(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple, dict[str, Any]] = {}
    for group in groups:
        for record in group:
            text = str(record.get("text") or "").strip()
            if not text:
                continue
            key = (round(float(record["x"]), 2), round(float(record["y"]), 2))
            previous = merged.get(key)
            if previous is None or len(text) > len(str(previous.get("text") or "")):
                merged[key] = record
    return list(merged.values())


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
    seen: set[tuple] = set()

    def add_from_entity(entity) -> None:
        dxftype = str(getattr(entity, "dxftype", "") or "")
        dxf = getattr(entity, "dxf", None) or {}
        if dxftype == "ATTRIB" and int(dxf.get("attribute_flags") or 0) & _ATTRIB_INVISIBLE:
            return
        raw_text = dxf.get("text") or dxf.get("contents") or ""
        text = _decode_mif(str(raw_text)).replace("\\n", " ").strip()
        if not text:
            return
        insert = dxf.get("insert") or dxf.get("align_point")
        if insert is None:
            return
        try:
            x, y = float(insert[0]), float(insert[1])
            z = float(insert[2]) if len(insert) > 2 else 0.0
        except Exception:
            return
        key = (round(x, 4), round(y, 4), text)
        if key in seen:
            return
        seen.add(key)
        height = dxf.get("height") or dxf.get("char_height") or 1.0
        rotation = dxf.get("rotation") or 0.0
        records.append(
            {
                "kind": dxftype or "TEXT",
                "text": text,
                "x": x,
                "y": y,
                "z": z,
                "height": float(height or 1.0),
                "rotation": float(rotation or 0.0),
                "layer": str(dxf.get("layer") or "0"),
                "style": "Standard",
            }
        )

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
                add_from_entity(entity)
    return records


def _dxf_text_value(text: str) -> str:
    cleaned = (
        _decode_mif(text)
        .replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )
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
        kind = lines[index + 1].strip()
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


def _text_entity_pairs(
    handle: int,
    record: dict[str, Any],
    text: str,
) -> list[str]:
    layer = _dxf_text_value(str(record.get("layer") or "0")) or "0"
    style = _dxf_text_value(str(record.get("style") or "Standard")) or "Standard"
    height = max(float(record["height"] or 1.0), 0.01)
    rotation = float(record["rotation"] or 0.0)
    x = float(record["x"])
    y = float(record["y"])
    z = float(record["z"])
    handle_hex = f"{handle:X}"
    return [
        "0",
        "TEXT",
        "5",
        handle_hex,
        "100",
        "AcDbEntity",
        "8",
        layer,
        "100",
        "AcDbText",
        "10",
        f"{x:.10f}",
        "20",
        f"{y:.10f}",
        "30",
        f"{z:.10f}",
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
    """Đổi font SHX latin (txt) sang TTF tiếng Việt, không ghi lại cả DXF."""
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


def _inject_collected_texts(path: Path, records: list[dict[str, Any]]) -> int:
    """Gắn TEXT vào section ENTITIES, không ghi lại cả DXF bằng ezdxf."""
    if not records:
        return 0
    try:
        from vn_text import to_unicode
    except Exception:
        def to_unicode(text: str) -> str:
            return text

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
        text = _dxf_text_value(to_unicode(str(record["text"])))
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


def convert_dwg_to_dxf(
    input_path: str | Path,
    output_path: str | Path | None = None,
    *,
    json_out: bool = False,
) -> Path:
    cad, DxfOptions = _import_aspose()

    src = Path(input_path).resolve()
    if not src.is_file():
        raise FileNotFoundError(f"Không thấy file: {src}")
    if src.suffix.lower() != ".dwg":
        raise ValueError(f"Cần file .dwg, nhận: {src.suffix}")

    if output_path is None:
        dest = src.with_suffix(".dxf")
    else:
        dest = Path(output_path).resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)

    _log(f"DWG → DXF bằng aspose-cad CONVERT: {src}")
    image = cad.Image.load(str(src))
    collected_texts: list[dict[str, Any]] = []
    try:
        collected_texts = _merge_text_records(
            _collect_cad_texts(image),
            _collect_ezdwg_texts(src),
        )
        _save_dxf(image, dest, cad, DxfOptions)
    finally:
        dispose = getattr(image, "dispose", None)
        if callable(dispose):
            dispose()

    dropped = _strip_dxf_entities(dest, _DROP_OBJECT_TYPES)
    if dropped:
        _log(f"Đã gỡ {dropped} object Aspose (VISUALSTYLE/MATERIAL) để đọc được DXF.")

    try:
        from convert_dxf2dxf import ensure_epsg_3857, patch_aspose_codepage

        patch_aspose_codepage(dest)
        ensured = ensure_epsg_3857(dest)
        if ensured.get("changed"):
            _log("Đã đưa điểm VN2000 còn sót về EPSG:3857, giữ nguyên điểm Web Mercator.")
    except Exception as error:
        _log(f"Không chuẩn hóa EPSG:3857: {error}")

    try:
        patched_fonts = _patch_style_fonts(dest)
        if patched_fonts:
            _log(f"Đã đổi {patched_fonts} font SHX sang BeVietnamPro.")
    except Exception as error:
        _log(f"Không đổi font STYLE: {error}")

    injected = 0
    try:
        injected = _inject_collected_texts(dest, collected_texts)
        if injected:
            _log(f"Đã bổ sung {injected} chữ từ DWG (TEXT/MTEXT/ATTRIB) vào DXF.")
        elif collected_texts:
            _log(f"Giữ {len(collected_texts)} chữ đã có trong DXF.")
    except Exception as error:
        _log(f"Không bổ sung chữ từ DWG: {error}")

    report = _verify_dxf(dest)
    if not dest.is_file() or dest.stat().st_size < 32:
        raise RuntimeError("aspose-cad không tạo được file DXF hợp lệ.")
    if not report.get("verified"):
        raise RuntimeError(
            f"DXF CONVERT không đọc được: {report.get('error') or 'không rõ'}"
        )

    payload = {
        "ok": True,
        "output": str(dest),
        "converter": "aspose-cad",
        "mode": "convert",
        "entities": int(report.get("entities") or 0),
        "verified": True,
        "dxf_version": report.get("version") or "",
        "types": report.get("types") or {},
        "file_size": dest.stat().st_size,
        "texts_found": len(collected_texts),
        "texts_added": injected,
        "kept_crs": True,
        "source": "EPSG:3857",
        "target": "EPSG:3857",
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
        description="Chuyển DWG → DXF bằng aspose-cad, giữ định dạng entity gốc."
    )
    parser.add_argument("input", help="File .dwg")
    parser.add_argument("-o", "--output", help="File .dxf đầu ra")
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        convert_dwg_to_dxf(args.input, args.output, json_out=args.json)
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
