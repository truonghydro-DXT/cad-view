"""Đọc DXF kể cả khi LibreDWG/dxfOut ghi trùng handle."""
from __future__ import annotations

import logging
from pathlib import Path

_LOGGER_READY = False


def _quiet_ezdxf() -> None:
    global _LOGGER_READY
    if _LOGGER_READY:
        return
    logging.getLogger("ezdxf").setLevel(logging.ERROR)
    _LOGGER_READY = True


def load_dxf(path: str | Path):
    from ezdxf import recover
    import ezdxf

    _quiet_ezdxf()
    try:
        doc, _auditor = recover.readfile(str(path))
        return doc
    except Exception:
        return ezdxf.readfile(str(path))
