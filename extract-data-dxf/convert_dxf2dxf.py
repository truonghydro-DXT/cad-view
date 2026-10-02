#!/usr/bin/env python3
"""
Chuyển DXF VN2000 (mét) → WGS 84 / Web Mercator EPSG:3857 (vẫn mét).

Giữ nguyên cấu trúc CAD: layer, block definition local, INSERT (tên, scale, góc),
chiều cao chữ, bán kính, độ rộng nét. Chỉ đổi XY của đối tượng tọa độ thế giới
(modelspace + block vẽ sẵn theo VN2000).

Không chuyển sang EPSG:4326 (độ) — lon/lat phá block/scale/kích thước trong DXF.

Usage:
    python convert-shapefile/convert_dxf2dxf.py projects/data/DC8.dxf
    python convert-shapefile/convert_dxf2dxf.py projects/data/DC8.dxf -o DC8_wgs84.dxf
    python convert-shapefile/convert_dxf2dxf.py projects/data/DC8.dxf --prj convert-shapefile/VN2000_TM/HaNoi_34Tinh_VN2000_TM_10500.prj
    python convert-shapefile/convert_dxf2dxf.py projects/data/DC8.dxf --cm 105.00
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Iterable

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

TARGET_CRS = "EPSG:3857"


def _vn2000_dir() -> Path:
    for candidate in (HERE / "VN2000_TM", HERE.parent / "VN2000_TM"):
        if candidate.is_dir():
            return candidate
    return HERE.parent / "VN2000_TM"


VN2000_DIR = _vn2000_dir()


def _crs_from_user(crs_value: str | Path):
    from pyproj import CRS

    raw = str(crs_value)
    if os.path.isfile(raw):
        return CRS.from_wkt(Path(raw).read_text(encoding="utf-8").strip())
    return CRS.from_user_input(raw.strip())


def _load_vn2000_helpers():
    try:
        from proj_convert import (  # type: ignore
            _build_cm_index,
            _build_vn2000_wkt,
            _find_nearest_cm,
        )

        return _build_cm_index, _build_vn2000_wkt, _find_nearest_cm
    except Exception:
        return None, None, None


def _detect_cm_from_xy(xs: list[float], ys: list[float]) -> tuple[float | None, Path | None]:
    if not xs or not ys:
        return None, None
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    if -180 <= min_x <= 180 and -180 <= max_x <= 180 and -90 <= min_y <= 90 and -90 <= max_y <= 90:
        return None, None
    if max(abs(min_x), abs(max_x)) > 2_000_000:
        return None, None

    # Bỏ điểm lệch (một số DXF có entity ở gốc / X âm) rồi lấy trung vị.
    paired = [
        (x, y)
        for x, y in zip(xs, ys)
        if 100_000 <= x <= 900_000 and 0 <= y <= 3_500_000
    ]
    if len(paired) < max(8, len(xs) // 20):
        return None, None
    px = sorted(p[0] for p in paired)
    py = sorted(p[1] for p in paired)
    median_x = px[len(px) // 2]
    median_y = py[len(py) // 2]
    avg_y = sum(py) / len(py)
    if not (0 <= avg_y <= 3_500_000):
        return None, None

    estimated_cm = 105.0 + ((median_x - 500000.0) / 6_120_000.0) * (180.0 / math.pi)
    estimated_cm = round(estimated_cm * 4) / 4.0
    # Bắc Bộ (Hà Nội ~21°N, northing ~2.1–2.4 triệu): ưu tiên kinh tuyến 105.00
    if 2_050_000 <= median_y <= 2_450_000 and 520_000 <= median_x <= 650_000:
        estimated_cm = 105.00
        hanoi = VN2000_DIR / "HaNoi_34Tinh_VN2000_TM_10500.prj"
        if hanoi.is_file():
            return 105.00, hanoi

    _build_index, _wkt, find_nearest = _load_vn2000_helpers()
    if find_nearest:
        cm, prj_path = find_nearest(estimated_cm)
        if cm is not None:
            return float(cm), Path(prj_path) if prj_path else None
    return estimated_cm, None


def _resolve_source_crs(
    xs: list[float],
    ys: list[float],
    *,
    prj: str | None,
    cm: float | None,
) -> tuple[Any, dict[str, Any]]:
    from pyproj import CRS

    info: dict[str, Any] = {
        "detected_vn2000": False,
        "central_meridian": None,
        "prj_file": None,
        "province": None,
        "already_wgs84": False,
        "already_mercator": False,
    }

    if prj:
        src = _crs_from_user(prj)
        info["detected_vn2000"] = True
        info["prj_file"] = str(prj)
        return src, info

    if cm is not None:
        build_index, build_wkt, find_nearest = _load_vn2000_helpers()
        prj_path = None
        if find_nearest:
            nearest, prj_path = find_nearest(float(cm))
            if nearest is not None:
                cm = float(nearest)
        info["detected_vn2000"] = True
        info["central_meridian"] = cm
        if prj_path and os.path.isfile(str(prj_path)):
            info["prj_file"] = str(prj_path)
            src = _crs_from_user(prj_path)
        elif build_wkt:
            src = CRS.from_wkt(build_wkt(cm))
        else:
            src = CRS.from_wkt(_fallback_vn2000_wkt(cm))
        return src, info

    detected_cm, prj_path = _detect_cm_from_xy(xs, ys)
    if detected_cm is None:
        mercator_n = sum(1 for x, y in zip(xs, ys) if _looks_mercator_xy(x, y))
        if mercator_n >= max(8, len(xs) // 2):
            info["already_mercator"] = True
            return CRS.from_user_input("EPSG:3857"), info
        if xs and -180 <= min(xs) <= 180 and max(xs) <= 180 and -90 <= min(ys) <= 90:
            info["already_wgs84"] = True
        return None, info

    info["detected_vn2000"] = True
    info["central_meridian"] = detected_cm
    if prj_path and prj_path.is_file():
        info["prj_file"] = str(prj_path)
        fname = prj_path.name
        m = re.match(r"(.+?)_34Tinh", fname)
        if m:
            info["province"] = m.group(1)
        return _crs_from_user(prj_path), info

    build_index, build_wkt, find_nearest = _load_vn2000_helpers()
    if find_nearest:
        nearest, found = find_nearest(detected_cm)
        if found and os.path.isfile(str(found)):
            info["prj_file"] = str(found)
            info["central_meridian"] = nearest
            fname = os.path.basename(str(found))
            m = re.match(r"(.+?)_34Tinh", fname)
            if m:
                info["province"] = m.group(1)
            return _crs_from_user(found), info
    wkt_fn = build_wkt or _fallback_vn2000_wkt
    return CRS.from_wkt(wkt_fn(detected_cm)), info


def _fallback_vn2000_wkt(central_meridian: float) -> str:
    cm_str = f"{float(central_meridian):.2f}"
    return (
        f'PROJCS["VN2000_TM_{cm_str}",'
        'GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",'
        'SPHEROID["WGS_1984",6378137.0,298.257223563]],'
        'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
        'PROJECTION["Transverse_Mercator"],'
        'PARAMETER["False_Easting",500000.0],'
        'PARAMETER["False_Northing",0.0],'
        f'PARAMETER["Central_Meridian",{cm_str}],'
        'PARAMETER["Scale_Factor",0.9999],'
        'PARAMETER["Latitude_Of_Origin",0.0],'
        'UNIT["Meter",1.0]]'
    )


def _read_dxf(path: Path):
    from dxf_load import load_dxf

    return load_dxf(path)


def patch_aspose_codepage(path: str | Path) -> None:
    src = Path(path)
    data = src.read_bytes()
    updated = data
    for old in (b"ANSI_1251", b"ANSI_1252", b"ansi_1251", b"ansi_1252"):
        updated = updated.replace(old, b"ANSI_1258")
    if updated != data:
        src.write_bytes(updated)


def export_unicode_dxf(doc, path: str | Path) -> None:
    """Ghi lại DXF, giữ font/phiên bản gốc; chỉ chuẩn hóa TCVN3/VNI nếu có."""
    from vn_text import normalize_document_text

    normalize_document_text(doc)
    if getattr(doc, "encoding", "") in {"cp1251", "cp1252"}:
        doc.encoding = "cp1258"
    doc.saveas(str(path))


def _get_xy(point) -> tuple[float, float, float]:
    if hasattr(point, "x"):
        z = float(getattr(point, "z", 0.0) or 0.0)
        return float(point.x), float(point.y), z
    return float(point[0]), float(point[1]), float(point[2]) if len(point) > 2 else 0.0


def _sample_modelspace_xy(msp, limit: int = 4000) -> tuple[list[float], list[float]]:
    xs: list[float] = []
    ys: list[float] = []

    def add(x: float, y: float) -> None:
        if math.isfinite(x) and math.isfinite(y):
            xs.append(x)
            ys.append(y)

    for entity in msp:
        if len(xs) >= limit:
            break
        try:
            etype = entity.dxftype()
        except Exception:
            continue
        try:
            if etype == "LINE":
                x, y, _ = _get_xy(entity.dxf.start)
                add(x, y)
                x, y, _ = _get_xy(entity.dxf.end)
                add(x, y)
            elif etype in ("LWPOLYLINE", "POLYLINE"):
                pts = entity.vertices() if hasattr(entity, "vertices") else []
                for p in pts:
                    x, y, _ = _get_xy(p)
                    add(x, y)
                    if len(xs) >= limit:
                        break
            elif etype in ("POINT",):
                x, y, _ = _get_xy(entity.dxf.location)
                add(x, y)
            elif etype in ("INSERT", "TEXT", "MTEXT", "CIRCLE", "ARC"):
                loc = getattr(entity.dxf, "insert", None) or getattr(
                    entity.dxf, "center", None
                )
                if loc is not None:
                    x, y, _ = _get_xy(loc)
                    add(x, y)
        except Exception:
            continue
    return xs, ys


def _tf_xy(transformer, x: float, y: float) -> tuple[float, float]:
    lon, lat = transformer.transform(x, y)
    if not (math.isfinite(lon) and math.isfinite(lat)):
        return x, y
    return float(lon), float(lat)


def _set_vec3(entity, attr: str, x: float, y: float, z: float | None = None) -> None:
    from ezdxf.math import Vec3

    old = getattr(entity.dxf, attr, None)
    z0 = float(old.z) if old is not None and hasattr(old, "z") else 0.0
    setattr(entity.dxf, attr, Vec3(x, y, z0 if z is None else z))


def _is_world_xy(x: float, y: float) -> bool:
    return 100_000 <= x <= 900_000 and 0 <= y <= 3_500_000


def _looks_mercator_xy(x: float, y: float) -> bool:
    return abs(x) > 2_000_000 and abs(y) < 20_000_000


def _block_is_world(block) -> bool:
    xs: list[float] = []
    ys: list[float] = []
    for entity in block:
        try:
            etype = entity.dxftype()
        except Exception:
            continue
        try:
            if etype == "LINE":
                x, y, _ = _get_xy(entity.dxf.start)
                xs.append(x)
                ys.append(y)
            elif etype == "LWPOLYLINE":
                for p in entity.vertices():
                    x, y, _ = _get_xy(p)
                    xs.append(x)
                    ys.append(y)
                    if len(xs) >= 40:
                        break
            elif etype in ("TEXT", "MTEXT", "INSERT", "CIRCLE", "ARC"):
                loc = getattr(entity.dxf, "insert", None) or getattr(
                    entity.dxf, "center", None
                )
                if loc is not None:
                    x, y, _ = _get_xy(loc)
                    xs.append(x)
                    ys.append(y)
        except Exception:
            continue
        if len(xs) >= 40:
            break
    if len(xs) < 2:
        return False
    mid_x = sorted(xs)[len(xs) // 2]
    mid_y = sorted(ys)[len(ys) // 2]
    return _is_world_xy(mid_x, mid_y)


def _transform_hatch_paths(entity, map_xy) -> None:
    from ezdxf.math import Vec2

    paths = getattr(entity, "paths", None)
    if not paths:
        return
    for path in paths:
        verts = getattr(path, "vertices", None)
        if verts:
            new_verts = []
            for item in verts:
                x, y = float(item[0]), float(item[1])
                bulge = float(item[2]) if len(item) > 2 else 0.0
                nx, ny = map_xy(x, y)
                new_verts.append((nx, ny, bulge))
            path.vertices = new_verts
            continue
        for edge in getattr(path, "edges", None) or []:
            if hasattr(edge, "start") and hasattr(edge, "end"):
                x, y = float(edge.start.x), float(edge.start.y)
                nx, ny = map_xy(x, y)
                edge.start = Vec2(nx, ny)
                x, y = float(edge.end.x), float(edge.end.y)
                nx, ny = map_xy(x, y)
                edge.end = Vec2(nx, ny)
            if hasattr(edge, "center"):
                x, y = float(edge.center.x), float(edge.center.y)
                nx, ny = map_xy(x, y)
                edge.center = Vec2(nx, ny)


def _transform_entity(entity, map_xy) -> bool:
    """Chỉ đổi XY world. Không đổi scale INSERT, height, radius, width."""
    from ezdxf.math import Vec3

    try:
        etype = entity.dxftype()
    except Exception:
        return False

    def xy(x: float, y: float) -> tuple[float, float]:
        return map_xy(x, y)

    try:
        if etype == "LINE":
            x, y, z = _get_xy(entity.dxf.start)
            nx, ny = xy(x, y)
            _set_vec3(entity, "start", nx, ny, z)
            x, y, z = _get_xy(entity.dxf.end)
            nx, ny = xy(x, y)
            _set_vec3(entity, "end", nx, ny, z)
            return True

        if etype == "POINT":
            x, y, z = _get_xy(entity.dxf.location)
            nx, ny = xy(x, y)
            _set_vec3(entity, "location", nx, ny, z)
            return True

        if etype == "LWPOLYLINE":
            pts = list(entity.get_points(format="xyseb"))
            if not pts:
                return False
            new_pts = []
            for x, y, start_w, end_w, bulge in pts:
                nx, ny = xy(float(x), float(y))
                new_pts.append((nx, ny, start_w, end_w, bulge))
            entity.set_points(new_pts, format="xyseb")
            return True

        if etype == "POLYLINE":
            for v in entity.vertices:
                loc = v.dxf.location
                nx, ny = xy(float(loc.x), float(loc.y))
                v.dxf.location = Vec3(nx, ny, loc.z)
            return True

        if etype in ("CIRCLE", "ARC"):
            c = entity.dxf.center
            nx, ny = xy(float(c.x), float(c.y))
            _set_vec3(entity, "center", nx, ny, float(c.z))
            return True

        if etype == "ELLIPSE":
            c = entity.dxf.center
            maj = entity.dxf.major_axis
            end = Vec3(c) + Vec3(maj)
            nc = Vec3(*xy(float(c.x), float(c.y)), float(c.z))
            ne = Vec3(*xy(float(end.x), float(end.y)), float(end.z))
            entity.dxf.center = nc
            entity.dxf.major_axis = ne - nc
            return True

        if etype == "SPLINE":
            if entity.control_points:
                entity.control_points = [
                    Vec3(*xy(float(p.x), float(p.y)), float(p.z)) for p in entity.control_points
                ]
            if getattr(entity, "fit_points", None):
                try:
                    entity.fit_points = [
                        Vec3(*xy(float(p.x), float(p.y)), float(p.z)) for p in entity.fit_points
                    ]
                except Exception:
                    pass
            return True

        if etype in ("SOLID", "TRACE", "3DFACE"):
            for name in ("vtx0", "vtx1", "vtx2", "vtx3"):
                if not hasattr(entity.dxf, name):
                    continue
                p = getattr(entity.dxf, name)
                nx, ny = xy(float(p.x), float(p.y))
                _set_vec3(entity, name, nx, ny, float(p.z))
            return True

        if etype in ("TEXT", "ATTRIB", "ATTDEF"):
            p = entity.dxf.insert
            nx, ny = xy(float(p.x), float(p.y))
            _set_vec3(entity, "insert", nx, ny, float(p.z))
            if etype == "TEXT" and hasattr(entity.dxf, "align_point"):
                try:
                    ap = entity.dxf.align_point
                    if ap is not None:
                        ax, ay = xy(float(ap.x), float(ap.y))
                        _set_vec3(entity, "align_point", ax, ay, float(ap.z))
                except Exception:
                    pass
            return True

        if etype == "MTEXT":
            p = entity.dxf.insert
            nx, ny = xy(float(p.x), float(p.y))
            _set_vec3(entity, "insert", nx, ny, float(p.z))
            return True

        if etype in ("INSERT", "MINSERT"):
            p = entity.dxf.insert
            x, y, z = _get_xy(p)
            if _is_world_xy(x, y) or _looks_mercator_xy(x, y):
                nx, ny = xy(x, y)
                _set_vec3(entity, "insert", nx, ny, z)
            return True

        if etype in ("HATCH", "MPOLYGON"):
            _transform_hatch_paths(entity, map_xy)
            return True

        if etype == "LEADER":
            raw = list(getattr(entity, "vertices", None) or [])
            new_verts = []
            for v in raw:
                x, y, z = _get_xy(v)
                nx, ny = xy(x, y)
                new_verts.append(Vec3(nx, ny, z))
            if new_verts:
                try:
                    entity.set_vertices(new_verts)
                except Exception:
                    entity.vertices = new_verts
            return True

        if etype in (
            "DIMENSION",
            "ALIGNED_DIMENSION",
            "LINEAR_DIMENSION",
            "RADIAL_DIMENSION",
            "DIAMETER_DIMENSION",
            "ANGULAR_DIMENSION",
            "ORDINATE_DIMENSION",
            "ARC_DIMENSION",
        ) or etype.startswith("DIMENSION"):
            for name in (
                "defpoint",
                "defpoint2",
                "defpoint3",
                "defpoint4",
                "text_midpoint",
                "insert",
            ):
                if not hasattr(entity.dxf, name):
                    continue
                try:
                    p = getattr(entity.dxf, name)
                    if p is None:
                        continue
                    nx, ny = xy(float(p.x), float(p.y))
                    _set_vec3(entity, name, nx, ny, float(getattr(p, "z", 0.0) or 0.0))
                except Exception:
                    pass
            return True

        if etype in ("XLINE", "RAY"):
            p = entity.dxf.start
            d = entity.dxf.unit_vector
            p2 = Vec3(p) + Vec3(d) * 1000.0
            np = Vec3(*xy(float(p.x), float(p.y)), float(p.z))
            np2 = Vec3(*xy(float(p2.x), float(p2.y)), float(p2.z))
            entity.dxf.start = np
            vec = np2 - np
            if vec.magnitude > 0:
                entity.dxf.unit_vector = vec.normalize()
            return True

        if etype == "IMAGE":
            p = entity.dxf.insert
            nx, ny = xy(float(p.x), float(p.y))
            u = entity.dxf.u_pixel
            v = entity.dxf.v_pixel
            pu = Vec3(p) + Vec3(u)
            pv = Vec3(p) + Vec3(v)
            nu = Vec3(*xy(float(pu.x), float(pu.y)), float(pu.z)) - Vec3(nx, ny, p.z)
            nv = Vec3(*xy(float(pv.x), float(pv.y)), float(pv.z)) - Vec3(nx, ny, p.z)
            _set_vec3(entity, "insert", nx, ny, float(p.z))
            entity.dxf.u_pixel = nu
            entity.dxf.v_pixel = nv
            return True

        if etype == "MLINE":
            verts = getattr(entity, "vertices", None)
            if verts:
                for mv in verts:
                    loc = mv.location
                    nx, ny = xy(float(loc.x), float(loc.y))
                    mv.location = Vec3(nx, ny, loc.z)
            return True
    except Exception:
        return False
    return False


def _update_header_extents(doc, transformer) -> None:
    from ezdxf.math import Vec3

    for key in ("$EXTMIN", "$EXTMAX", "$LIMMIN", "$LIMMAX"):
        try:
            p = doc.header.get(key)
            if p is None:
                continue
            x, y, z = _get_xy(p)
            if abs(x) > 1e12 or abs(y) > 1e12:
                continue
            nx, ny = _tf_xy(transformer, x, y)
            doc.header[key] = Vec3(nx, ny, z)
        except Exception:
            pass


def convert_dxf_vn2000_to_wgs84(
    input_path: str | Path,
    output_path: str | Path | None = None,
    *,
    prj: str | None = None,
    cm: float | None = None,
    target_crs: str = TARGET_CRS,
    force: bool = False,
    json_out: bool = False,
) -> Path | None:
    """
    Đọc DXF, đổi VN2000 → WGS 84, ghi DXF mới (cùng cấu trúc entity/block/layer).
    """
    from pyproj import Transformer

    src_path = Path(input_path).resolve()
    if not src_path.is_file():
        print(f"❌ Không thấy file: {src_path}")
        return None
    if src_path.suffix.lower() != ".dxf":
        print(f"❌ Cần file .dxf, nhận: {src_path.suffix}")
        return None

    if output_path is None:
        output_path = src_path.with_name(src_path.stem + "_wgs84.dxf")
    out_path = Path(output_path).resolve()
    if out_path == src_path:
        print("❌ File ra trùng file vào — hãy chỉ định -o")
        return None
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"📂 Đọc: {src_path}")
    doc = _read_dxf(src_path)
    msp = doc.modelspace()

    xs, ys = _sample_modelspace_xy(msp)
    src_crs, info = _resolve_source_crs(xs, ys, prj=prj, cm=cm)

    if info.get("already_wgs84") and not force:
        shutil.copy2(src_path, out_path)
        print("📐 Tọa độ đã giống WGS 84 — copy nguyên file")
        print(f"✅ {out_path}")
        if json_out:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "output": str(out_path),
                        "entities": 0,
                        "copied": True,
                        "target": target_crs,
                    },
                    ensure_ascii=False,
                )
            )
        return out_path

    if info.get("already_mercator"):
        shutil.copy2(src_path, out_path)
        ensured = ensure_epsg_3857(out_path)
        print("📐 File đã là EPSG:3857 — giữ nguyên tọa độ Web Mercator")
        print(f"✅ {out_path}")
        if json_out:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "output": str(out_path),
                        "entities": len(msp),
                        "copied": True,
                        "already_mercator": True,
                        "ensured": bool(ensured.get("changed")),
                        "source": "EPSG:3857",
                        "target": target_crs,
                    },
                    ensure_ascii=False,
                )
            )
        return out_path

    if src_crs is None:
        print("❌ Không nhận ra VN2000. Chỉ định --prj file.prj hoặc --cm 105.00")
        return None

    dst_crs = _crs_from_user(target_crs)
    if dst_crs.is_geographic:
        print(
            "⚠️  CRS đích là kinh/vĩ độ — block/scale CAD sẽ lệch. "
            "Mặc định EPSG:3857 (mét) mới giữ được cấu trúc."
        )
    if src_crs.equals(dst_crs) and not force:
        shutil.copy2(src_path, out_path)
        print("📐 CRS nguồn = đích — copy nguyên file")
        print(f"✅ {out_path}")
        if json_out:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "output": str(out_path),
                        "entities": 0,
                        "copied": True,
                        "target": target_crs,
                    },
                    ensure_ascii=False,
                )
            )
        return out_path

    transformer = Transformer.from_crs(src_crs, dst_crs, always_xy=True)

    src_label = (
        os.path.basename(info["prj_file"])
        if info.get("prj_file")
        else f"VN2000 CM={info.get('central_meridian')}"
    )
    extra = f" ({info['province']})" if info.get("province") else ""
    print(f"🔍 Nguồn: {src_label}{extra}  →  {target_crs} (mét, giữ block/scale)")

    def world_xy(x: float, y: float) -> tuple[float, float]:
        if not _is_world_xy(x, y):
            return x, y
        return _tf_xy(transformer, x, y)

    ok = 0
    skip = 0
    by_type: dict[str, int] = {}
    n_world = 0
    n_local_skip = 0

    for block in doc.blocks:
        try:
            if block.block_record.is_any_layout:
                continue
        except Exception:
            name = (block.name or "").upper()
            if name.startswith("*MODEL") or name.startswith("*PAPER"):
                continue
        if not _block_is_world(block):
            n_local_skip += 1
            continue
        n_world += 1
        for entity in list(block):
            etype = entity.dxftype() if hasattr(entity, "dxftype") else "?"
            if _transform_entity(entity, world_xy):
                ok += 1
                by_type[etype] = by_type.get(etype, 0) + 1
            else:
                skip += 1

    for entity in msp:
        etype = entity.dxftype() if hasattr(entity, "dxftype") else "?"
        if _transform_entity(entity, world_xy):
            ok += 1
            by_type[etype] = by_type.get(etype, 0) + 1
        else:
            skip += 1

    _update_header_extents(doc, transformer)

    try:
        export_unicode_dxf(doc, out_path)
    except Exception as exc:
        print(f"❌ Không ghi được DXF: {exc}")
        return None

    print(
        f"🔄 Đã đổi XY world: {ok} entity; block local giữ nguyên: {n_local_skip}; "
        f"block world: {n_world}; bỏ qua {skip}."
    )
    top = sorted(by_type.items(), key=lambda kv: -kv[1])[:8]
    if top:
        print("   Loại:", ", ".join(f"{k}={v}" for k, v in top))
    print(f"✅ DXF WGS 84: {out_path}")
    if json_out:
        print(
            json.dumps(
                {
                    "ok": True,
                    "output": str(out_path),
                    "entities": ok,
                    "skipped": skip,
                    "source": src_label,
                    "target": target_crs,
                    "province": info.get("province"),
                    "central_meridian": info.get("central_meridian"),
                    "prj_file": info.get("prj_file"),
                },
                ensure_ascii=False,
            )
        )
    return out_path


def ensure_epsg_3857(dxf_path: str | Path) -> dict[str, Any]:
    """Keep existing Web Mercator points; only reproject leftover VN2000 to EPSG:3857."""
    from pyproj import Transformer

    path = Path(dxf_path)
    doc = _read_dxf(path)
    msp = doc.modelspace()
    xs, ys = _sample_modelspace_xy(msp, limit=8000)
    vn2000 = [(x, y) for x, y in zip(xs, ys) if _is_world_xy(x, y)]
    if len(vn2000) < 1:
        return {"changed": False, "target": "EPSG:3857"}

    hint_xs = [p[0] for p in vn2000] * 8
    hint_ys = [p[1] for p in vn2000] * 8
    src_crs, info = _resolve_source_crs(hint_xs, hint_ys, prj=None, cm=None)
    if src_crs is None:
        return {"changed": False, "reason": "no-vn2000-crs", "target": "EPSG:3857"}

    transformer = Transformer.from_crs(src_crs, "EPSG:3857", always_xy=True)

    def map_xy(x: float, y: float) -> tuple[float, float]:
        if not _is_world_xy(x, y):
            return x, y
        return _tf_xy(transformer, x, y)

    for entity in list(msp):
        _transform_entity(entity, map_xy)
        if entity.dxftype() == "INSERT":
            for attrib in getattr(entity, "attribs", []) or []:
                _transform_entity(attrib, map_xy)
    doc.saveas(str(path))
    return {
        "changed": True,
        "source": "mixed",
        "target": "EPSG:3857",
        "central_meridian": info.get("central_meridian"),
    }


def convert_dxf_keep_crs(
    input_path: str | Path,
    output_path: str | Path | None = None,
    *,
    json_out: bool = False,
) -> Path | None:
    src_path = Path(input_path).resolve()
    if not src_path.is_file():
        print(f"❌ Không thấy file: {src_path}")
        return None
    if src_path.suffix.lower() != ".dxf":
        print(f"❌ Cần file .dxf, nhận: {src_path.suffix}")
        return None

    if output_path is None:
        output_path = src_path.with_name(src_path.stem + "_dxf.dxf")
    out_path = Path(output_path).resolve()
    if out_path == src_path:
        print("❌ File ra trùng file vào — hãy chỉ định -o")
        return None
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"📂 Đọc (giữ hệ tọa độ): {src_path}")
    try:
        doc = _read_dxf(src_path)
        try:
            entities = len(doc.modelspace())
        except Exception:
            entities = 0
        shutil.copy2(src_path, out_path)
    except Exception:
        shutil.copy2(src_path, out_path)
        entities = 0
    print(f"✅ DXF giữ nguyên tọa độ: {out_path}")
    if json_out:
        print(
            json.dumps(
                {
                    "ok": True,
                    "output": str(out_path),
                    "entities": entities,
                    "copied": True,
                    "kept_crs": True,
                    "source": "original",
                    "target": "original",
                },
                ensure_ascii=False,
            )
        )
    return out_path


def _iter_inputs(path: Path) -> Iterable[Path]:
    if path.is_dir():
        yield from sorted(path.glob("*.dxf"))
        yield from sorted(path.glob("*.DXF"))
        return
    yield path


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Chuyển DXF VN2000 → WGS 84 Web Mercator (EPSG:3857), giữ block/INSERT/scale."
    )
    p.add_argument("input", nargs="?", default=".", help="File .dxf hoặc thư mục")
    p.add_argument("-o", "--output", help="File DXF đầu ra (chỉ khi 1 file vào)")
    p.add_argument(
        "--prj",
        help="File .prj VN2000 (mặc định tự dò theo tọa độ + thư mục VN2000_TM/)",
    )
    p.add_argument("--cm", type=float, help="Kinh tuyến trục VN2000, ví dụ 105.00")
    p.add_argument(
        "--crs",
        default=TARGET_CRS,
        help="CRS đích (mặc định EPSG:3857, mét). Không dùng EPSG:4326 cho DXF CAD.",
    )
    p.add_argument("--force", action="store_true", help="Ép chuyển dù tọa độ đã giống WGS 84")
    p.add_argument(
        "--keep-crs",
        action="store_true",
        help="Giữ nguyên hệ quy chiếu gốc: chỉ đọc/ghi DXF, không đổi tọa độ.",
    )
    p.add_argument("--json", action="store_true", help="In thêm một dòng JSON kết quả")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    src = Path(args.input)
    files = [p for p in _iter_inputs(src) if p.is_file() and p.suffix.lower() == ".dxf"]
    if not files:
        print(f"❌ Không có file .dxf: {src}")
        return 1
    if args.output and len(files) > 1:
        print("❌ -o chỉ dùng khi chuyển một file")
        return 1

    failed = 0
    for path in files:
        out = Path(args.output) if args.output else None
        result = (
            convert_dxf_keep_crs(path, out, json_out=args.json)
            if args.keep_crs
            else convert_dxf_vn2000_to_wgs84(
                path,
                out,
                prj=args.prj,
                cm=args.cm,
                target_crs=args.crs,
                force=args.force,
                json_out=args.json,
            )
        )
        if result is None:
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
