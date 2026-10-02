import argparse
import pathlib
import re
import sys
from collections import defaultdict, deque

import ezdxf
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout, pymupdf
from ezdxf.addons.drawing.config import (
    BackgroundPolicy,
    ColorPolicy,
    Configuration,
    LineweightPolicy,
)
from ezdxf.fonts import fonts as ezdxf_fonts
from ezdxf.math import BoundingBox2d

_SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from vn_text import normalize_document_text

PAPER_MM = {
    "A4": (210.0, 297.0),
    "A3": (297.0, 420.0),
    "A2": (420.0, 594.0),
    "Letter": (215.9, 279.4),
    "Legal": (215.9, 355.6),
}


def _load_dxf(dxf_path):
    from dxf_load import load_dxf

    return load_dxf(dxf_path)


_FONT_ALIASES = (
    "txt",
    "txt.shx",
    "romans",
    "romans.shx",
    "simplex",
    "simplex.shx",
    "italic",
    "italic.shx",
    "complex",
    "complex.shx",
    "vn_vni",
    "vn_vni.shx",
    "vn_vni.ttf",
    "tcvn3",
    "tcvn3txt",
    "tcvn3txt.shx",
    "vntime",
    "vntime.ttf",
    ".vntime",
    "vni-times",
    "vni-helve",
    "vnarial",
    ".vnarial",
    "timesi",
    "bevietnampro",
    "bevietnampro-regular.ttf",
    "noto sans",
    "notosans-regular.ttf",
    "noto serif",
    "notoserif-regular.ttf",
)


def _is_plot_visible(entity, layers):
    try:
        layer = layers.get(entity.dxf.layer)
    except Exception:
        return True
    try:
        return layer.is_on() and not layer.is_frozen() and bool(layer.dxf.plot)
    except Exception:
        return True


_MTEXT_FONT_RE = re.compile(r"\\f([^|;]+)\|([^;]*);", re.I)
_ARIAL_FAMILIES = {"arial", "arial mt", "arial unicode ms"}


def _fix_mtext_font_code(text):
    # Arial Bold thiếu nét tiếng Việt khi ezdxf vẽ glyph kép (Ả, Ồ, Ư, Ờ, Ị).
    def replace(match):
        family = match.group(1)
        flags = match.group(2)
        if family.strip().lower() in _ARIAL_FAMILIES:
            flags = re.sub(r"b1", "b0", flags, flags=re.I)
            return f"\\fArial|{flags};"
        return match.group(0)

    return _MTEXT_FONT_RE.sub(replace, text)


def _setup_fonts(doc):
    manager = ezdxf_fonts.font_manager
    if not manager.has_font("arial.ttf"):
        manager.build()

    fallback = "arial.ttf" if manager.has_font("arial.ttf") else ""
    if not fallback:
        return

    for alias in (*_FONT_ALIASES, "Arial"):
        if not manager.has_font(alias):
            manager.add_synonyms({fallback: alias}, reverse=False)

    for style in doc.styles:
        font_name = (style.dxf.font or "").strip()
        if font_name and not manager.has_font(font_name):
            style.dxf.font = fallback

    for entity in doc.chain_layouts_and_blocks():
        if entity.dxftype() == "MTEXT":
            fixed = _fix_mtext_font_code(entity.text)
            if fixed != entity.text:
                entity.text = fixed


def _prepare_document(doc):
    _setup_fonts(doc)
    normalize_document_text(doc)


def _entity_boxes(layout_space):
    layers = layout_space.doc.layers if getattr(layout_space, "doc", None) else None
    boxes = []
    for entity in layout_space:
        if layers is not None and not _is_plot_visible(entity, layers):
            continue
        try:
            extents = bbox.extents([entity], fast=True)
        except Exception:
            continue
        if extents.has_data:
            boxes.append(BoundingBox2d((extents.extmin, extents.extmax)))
    return boxes


def _union_boxes(boxes):
    merged = BoundingBox2d()
    for box in boxes:
        merged.extend((box.extmin, box.extmax))
    return merged if merged.has_data else None


def _connected_cluster(clusters, start):
    seen = {start}
    queue = deque([start])
    while queue:
        x, y = queue.popleft()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                key = (x + dx, y + dy)
                if key in clusters and key not in seen:
                    seen.add(key)
                    queue.append(key)
    boxes = []
    for key in seen:
        boxes.extend(clusters[key])
    return boxes


def _pad_box(box):
    if box is None or not box.has_data:
        return None
    width, height = box.size
    pad_x = 1.0 if width <= 0 else width * 0.02
    pad_y = 1.0 if height <= 0 else height * 0.02
    return BoundingBox2d((
        (box.extmin.x - pad_x, box.extmin.y - pad_y),
        (box.extmax.x + pad_x, box.extmax.y + pad_y),
    ))


def _content_box(layout_space):
    boxes = _entity_boxes(layout_space)
    overall = _union_boxes(boxes)
    if overall is None:
        return None

    span = max(overall.size.x, overall.size.y)
    if span <= 0 or len(boxes) < 2:
        return _pad_box(overall)

    # Một vài thực thể lệch hệ tọa độ sẽ làm fit-page thu cả bản vẽ thành một chấm.
    cell = max(span * 0.02, 1.0)
    clusters = defaultdict(list)
    for box in boxes:
        key = (int(box.center.x // cell), int(box.center.y // cell))
        clusters[key].append(box)

    start = max(clusters, key=lambda key: len(clusters[key]))
    robust = _union_boxes(_connected_cluster(clusters, start))
    if robust is None:
        return _pad_box(overall)
    return _pad_box(robust)


def _page_size(render_box, paper="A4", orientation="auto"):
    width, height = PAPER_MM.get(paper, PAPER_MM["A4"])
    portrait = (min(width, height), max(width, height))
    landscape = (max(width, height), min(width, height))

    if orientation == "landscape":
        return landscape
    if orientation == "portrait":
        return portrait
    if render_box is not None and render_box.size.x >= render_box.size.y:
        return landscape
    return portrait


def _lineweight_scaling(page_width, page_height):
    # DXF lw 140 = 1.4mm dành khổ A1. Fit A4 thì nét khung lấp khe và đè số lưới/tiêu đề.
    short = min(float(page_width), float(page_height))
    return max(0.25, min(1.0, short / 594.0))


def _drawing_config(page_width, page_height):
    return Configuration(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.COLOR,
        lineweight_policy=LineweightPolicy.ABSOLUTE,
        lineweight_scaling=_lineweight_scaling(page_width, page_height),
        pdsize=1,
    )


def _render_pdf_bytes(doc, output_layout, scale=1, paper="A4", orientation="auto"):
    _prepare_document(doc)
    render_box = _content_box(output_layout)
    page_width, page_height = _page_size(render_box, paper, orientation)
    ezdxf_page = layout.Page(
        page_width,
        page_height,
        layout.Units.mm,
        layout.Margins.all(8),
        max_width=1189,
        max_height=841,
    )
    settings = layout.Settings(
        scale=scale,
        fit_page=True,
        output_layers=True,
    )
    backend = pymupdf.PyMuPdfBackend()
    # Nền trắng: ACI 7 (trắng/đen) đã được ezdxf đổi thành đen.
    # COLOR_SWAP_BW sẽ đảo ngược thành trắng trên giấy trắng → trang PDF trống.
    config = _drawing_config(page_width, page_height)
    Frontend(RenderContext(doc, export_mode=True), backend, config=config).draw_layout(output_layout)
    return backend.get_pdf_bytes(ezdxf_page, settings=settings, render_box=render_box)


# Strategy 1: export the modelspace
def export_pdf(dxf_path, scale=1, output_path="output.pdf", paper="A4", orientation="auto"):
    doc = _load_dxf(dxf_path)
    pdf_bytes = _render_pdf_bytes(doc, doc.modelspace(), scale, paper, orientation)
    pathlib.Path(output_path).write_bytes(pdf_bytes)
    return output_path


# Strategy 2: seperate the layer to different layout and export
def export_pdf_by_layer(dxf_path, scale=1, output_path="output.pdf", paper="A4", orientation="auto"):
    doc = _load_dxf(dxf_path)
    msp = doc.modelspace()
    _prepare_document(doc)
    render_box = _content_box(msp)
    page_width, page_height = _page_size(render_box, paper, orientation)
    ezdxf_page = layout.Page(
        page_width,
        page_height,
        layout.Units.mm,
        layout.Margins.all(8),
        max_width=1189,
        max_height=841,
    )
    settings = layout.Settings(scale=scale, fit_page=True, output_layers=True)
    backend = pymupdf.PyMuPdfBackend()
    config = _drawing_config(page_width, page_height)

    for layer in doc.layers:
        layer_name = layer.dxf.name
        new_layout = doc.new_layout(name=layer_name)
        for entity in msp.query(f'*[layer=="{layer_name}"]'):
            new_layout.add_entity(entity)
        Frontend(RenderContext(doc, export_mode=True), backend, config=config).draw_layout(new_layout)

    pdf_bytes = backend.get_pdf_bytes(ezdxf_page, settings=settings, render_box=render_box)
    pathlib.Path(output_path).write_bytes(pdf_bytes)
    return output_path


def main(argv=None):
    parser = argparse.ArgumentParser(description="Xuất PDF từ DXF bằng ezdxf + PyMuPDF")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=float, default=1)
    parser.add_argument("--paper", default="A4", choices=list(PAPER_MM))
    parser.add_argument("--orientation", default="auto", choices=["auto", "portrait", "landscape"])
    parser.add_argument("--by-layer", action="store_true")
    args = parser.parse_args(argv)

    if args.by_layer:
        export_pdf_by_layer(args.input, args.scale, args.output, args.paper, args.orientation)
    else:
        export_pdf(args.input, args.scale, args.output, args.paper, args.orientation)
    print(args.output)


if __name__ == "__main__":
    main()
