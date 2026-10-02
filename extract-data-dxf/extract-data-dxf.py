import ezdxf

def extract_dwg_data(file_path):
    try:
        # Leer el archivo DXF
        doc = ezdxf.readfile(file_path)
    except IOError:
        print(f"No se puede leer el archivo: {file_path}")
        return None
    except ezdxf.DXFStructureError:
        print(f"Archivo DXF no válido: {file_path}")
        return None

    # Obtener el espacio de modelo
    modelspace = doc.modelspace()

    def extract_entities(entities):
        extracted_data = []
        for entity in entities:
            entity_data = {"type": entity.dxftype()}
            if entity.dxftype() == 'LINE':
                entity_data["start_point"] = entity.dxf.start
                entity_data["end_point"] = entity.dxf.end
            elif entity.dxftype() == 'CIRCLE':
                entity_data["center_point"] = entity.dxf.center
                entity_data["radius"] = entity.dxf.radius
            elif entity.dxftype() == 'ARC':
                entity_data["center_point"] = entity.dxf.center
                entity_data["radius"] = entity.dxf.radius
                entity_data["start_angle"] = entity.dxf.start_angle
                entity_data["end_angle"] = entity.dxf.end_angle
            elif entity.dxftype() == 'LWPOLYLINE':
                entity_data["points"] = entity.get_points()
            elif entity.dxftype() == 'POLYLINE':
                entity_data["points"] = [v.dxf.location for v in entity.vertices]
            elif entity.dxftype() == 'ELLIPSE':
                entity_data["center_point"] = entity.dxf.center
                entity_data["major_axis"] = entity.dxf.major_axis
                entity_data["ratio"] = entity.dxf.ratio
                entity_data["start_param"] = entity.dxf.start_param
                entity_data["end_param"] = entity.dxf.end_param
            elif entity.dxftype() == 'TEXT':
                entity_data["text"] = entity.dxf.text
                entity_data["insert_point"] = entity.dxf.insert
            elif entity.dxftype() == 'MTEXT':
                entity_data["text"] = entity.text
                entity_data["insert_point"] = entity.dxf.insert
            elif entity.dxftype() == 'HATCH':
                entity_data["pattern_name"] = entity.dxf.pattern_name
                entity_data["solid_fill"] = entity.dxf.solid_fill
                entity_data["associative"] = entity.dxf.associative
                entity_data["paths"] = [path.vertices for path in entity.paths]
            elif entity.dxftype() == 'SOLID':
                entity_data["points"] = entity.get_points()
            elif entity.dxftype() == 'POINT':
                entity_data["location"] = entity.dxf.location
            elif entity.dxftype() == 'DIMENSION':
                entity_data = extract_dimension_data(entity)
            elif entity.dxftype() == 'INSERT':
                block_data = extract_entities(doc.blocks[entity.dxf.name])
                for attrib in getattr(entity, "attribs", None) or []:
                    flags = int(attrib.dxf.get("flags", 0) or 0)
                    text = attrib.dxf.get("text", "")
                    if not text or flags & 1:
                        continue
                    block_data.append({
                        "type": "TEXT",
                        "text": text,
                        "insert_point": attrib.dxf.insert,
                    })
                entity_data["block_name"] = entity.dxf.name
                entity_data["block_data"] = block_data
            elif entity.dxftype() in ("ATTRIB", "ATTDEF"):
                flags = int(entity.dxf.get("flags", 0) or 0)
                if flags & 1:
                    continue
                entity_data["type"] = "TEXT"
                entity_data["text"] = entity.dxf.text
                entity_data["insert_point"] = entity.dxf.insert
            elif entity.dxftype() == 'LEADER':
                entity_data["vertices"] = entity.vertices
                entity_data["has_arrowhead"] = entity.dxf.has_arrowhead
            elif entity.dxftype() == 'MLINE':
                entity_data["vertices"] = entity.vertices
                entity_data["style"] = entity.dxf.style_name
            elif entity.dxftype() == 'SPLINE':
                entity_data["degree"] = entity.dxf.degree
                entity_data["fit_points"] = entity.fit_points
                entity_data["control_points"] = entity.control_points
            elif entity.dxftype() == '3DFACE':
                entity_data["points"] = entity.get_points()
            elif entity.dxftype() == 'IMAGE':
                entity_data["image_def"] = entity.dxf.image_def
                entity_data["insert_point"] = entity.dxf.insert
                entity_data["u_vector"] = entity.dxf.u_vector
                entity_data["v_vector"] = entity.dxf.v_vector
                entity_data["size"] = entity.dxf.image_size
                entity_data["clipping_boundary"] = entity.clip_boundary
            elif entity.dxftype() == 'UNDERLAY':
                entity_data["underlay_def"] = entity.dxf.underlay_def
                entity_data["insert_point"] = entity.dxf.insert
                entity_data["scale_x"] = entity.dxf.scale_x
                entity_data["scale_y"] = entity.dxf.scale_y
                entity_data["scale_z"] = entity.dxf.scale_z
                entity_data["rotation"] = entity.dxf.rotation
                entity_data["clip_boundary"] = entity.clip_boundary
            elif entity.dxftype() == 'WIPEOUT':
                entity_data["points"] = entity.get_points()
                entity_data["image_def"] = entity.dxf.image_def
            elif entity.dxftype() == 'XLINE':
                entity_data["start_point"] = entity.dxf.start
                entity_data["unit_direction"] = entity.dxf.unit_direction
            elif entity.dxftype() == 'RAY':
                entity_data["start_point"] = entity.dxf.start
                entity_data["unit_direction"] = entity.dxf.unit_direction
            elif entity.dxftype() == 'HELIX':
                entity_data["base_point"] = entity.dxf.base_point
                entity_data["top_point"] = entity.dxf.top_point
                entity_data["radius"] = entity.dxf.radius
                entity_data["turns"] = entity.dxf.turns
            elif entity.dxftype() == 'LIGHT':
                entity_data["light_type"] = entity.dxf.light_type
                entity_data["position"] = entity.dxf.position
                entity_data["target"] = entity.dxf.target
                entity_data["color"] = entity.dxf.color
                entity_data["intensity"] = entity.dxf.intensity
                entity_data["status"] = entity.dxf.status
            elif entity.dxftype() == 'SECTION':
                entity_data["name"] = entity.dxf.name
                entity_data["flags"] = entity.dxf.flags
                entity_data["entities"] = extract_entities(entity)
            elif entity.dxftype() == 'MLEADER':
                entity_data["content"] = entity.dxf.content
                entity_data["style"] = entity.dxf.style
                entity_data["leader_line_positions"] = entity.dxf.leader_line_positions
                entity_data["leader_direction"] = entity.dxf.leader_direction
            elif entity.dxftype() == 'TOLERANCE':
                entity_data["insert_point"] = entity.dxf.insert
                entity_data["x_axis"] = entity.dxf.x_axis
                entity_data["y_axis"] = entity.dxf.y_axis
                entity_data["height"] = entity.dxf.height
                entity_data["content"] = entity.dxf.content
            elif entity.dxftype() == 'MESH':
                entity_data["vertices"] = entity.vertices
                entity_data["faces"] = entity.faces
            elif entity.dxftype() == 'SURFACE':
                entity_data["control_points"] = entity.control_points
                entity_data["knots_u"] = entity.knots_u
                entity_data["knots_v"] = entity.knots_v
                entity_data["degree_u"] = entity.dxf.degree_u
                entity_data["degree_v"] = entity.dxf.degree_v
            elif entity.dxftype() == 'CONTOUR':
                entity_data["vertices"] = entity.vertices
                entity_data["flags"] = entity.dxf.flags
            elif entity.dxftype() == 'VIEWPORT':
                entity_data["view_center_point"] = entity.dxf.view_center_point
                entity_data["snap_base_point"] = entity.dxf.snap_base_point
                entity_data["view_height"] = entity.dxf.view_height
                entity_data["view_aspect_ratio"] = entity.dxf.view_aspect_ratio
            else:
                entity_data["data"] = str(entity)  # para entidades no reconocidas

            extracted_data.append(entity_data)
        return extracted_data

    def extract_dimension_data(entity):
        dim_data = {
            "dimtype": entity.dimtype,
            "text": entity.dxf.text,
            "insert_point": entity.dxf.insert,
        }
        dim_type = entity.dimtype

        if dim_type == 0:  # Rotated, horizontal, or vertical linear dimension
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2]
        elif dim_type == 1:  # Aligned linear dimension
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2]
        elif dim_type == 2:  # Angular dimension (2 lines)
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2, entity.dxf.defpoint3, entity.dxf.defpoint4]
        elif dim_type == 3:  # Diameter dimension
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2]
        elif dim_type == 4:  # Radius dimension
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2]
        elif dim_type == 5:  # Angular dimension (3 points)
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2, entity.dxf.defpoint3]
        elif dim_type == 6:  # Angular dimension (4 points)
            dim_data["defpoints"] = [entity.dxf.defpoint, entity.dxf.defpoint2, entity.dxf.defpoint3, entity.dxf.defpoint4]
        return dim_data

    data = extract_entities(modelspace)

    return data

def create_dwg_file(output_path, data):
    doc = ezdxf.new(dxfversion="R2010")
    modelspace = doc.modelspace()

    for entity in data:
        entity_type = entity.get("type")
        if entity_type == "LINE":
            modelspace.add_line(entity["start_point"], entity["end_point"])
        elif entity_type == "CIRCLE":
            modelspace.add_circle(entity["center_point"], entity["radius"])
        elif entity_type == "ARC":
            modelspace.add_arc(entity["center_point"], entity["radius"], entity["start_angle"], entity["end_angle"])
        elif entity_type == "LWPOLYLINE":
            modelspace.add_lwpolyline(entity["points"])
        elif entity_type == "POLYLINE":
            polyline = modelspace.add_polyline3d()
            for point in entity["points"]:
                polyline.append_vertices(point)
        elif entity_type == "ELLIPSE":
            modelspace.add_ellipse(entity["center_point"], entity["major_axis"], entity["ratio"], entity["start_param"], entity["end_param"])
        elif entity_type == "TEXT":
            modelspace.add_text(entity["text"], dxfattribs={'insert': entity["insert_point"]})
        elif entity_type == "MTEXT":
            modelspace.add_mtext(entity["text"], dxfattribs={'insert': entity["insert_point"]})
        elif entity_type == "HATCH":
            hatch = modelspace.add_hatch()
            hatch.set_pattern_fill(entity["pattern_name"], scale=1)
            hatch.paths.add_polyline_path(entity["paths"], is_closed=True)
        elif entity_type == "SOLID":
            modelspace.add_solid(entity["points"])
        elif entity_type == "POINT":
            modelspace.add_point(entity["location"])
        elif entity_type == "DIMENSION":
            dim_data = entity
            dim_type = dim_data["dimtype"]
            if dim_type == 0:  # Linear dimension
                modelspace.add_linear_dim(base=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
            elif dim_type == 1:  # Aligned dimension
                modelspace.add_aligned_dim(base=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
            elif dim_type == 2:  # Angular dimension (2 lines)
                modelspace.add_angular_dim(base=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
            elif dim_type == 3:  # Diameter dimension
                modelspace.add_diameter_dim(center=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
            elif dim_type == 4:  # Radius dimension
                modelspace.add_radius_dim(center=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
            elif dim_type == 5:  # Angular dimension (3 points)
                modelspace.add_angular_dim(base=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
            elif dim_type == 6:  # Angular dimension (4 points)
                modelspace.add_angular_dim(base=dim_data["defpoints"][0], p1=dim_data["defpoints"][1], text=dim_data["text"])
        elif entity_type == "INSERT":
            modelspace.add_blockref(entity["block_name"], insert=entity["block_data"][0].get("insert_point", (0,0,0)))
        elif entity_type == "LEADER":
            modelspace.add_leader(entity["vertices"], dxfattribs={'has_arrowhead': entity["has_arrowhead"]})
        elif entity_type == "MLINE":
            modelspace.add_mline(entity["vertices"], dxfattribs={'style': entity["style"]})
        elif entity_type == "SPLINE":
            modelspace.add_spline(fit_points=entity["fit_points"], degree=entity["degree"], dxfattribs={'control_points': entity["control_points"]})
        elif entity_type == "3DFACE":
            modelspace.add_3dface(entity["points"])
        elif entity_type == "IMAGE":
            modelspace.add_image(entity["image_def"], insert=entity["insert_point"], size=entity["size"], u_vector=entity["u_vector"], v_vector=entity["v_vector"], dxfattribs={'clipping_boundary': entity["clipping_boundary"]})
        elif entity_type == "UNDERLAY":
            modelspace.add_underlay(entity["underlay_def"], insert=entity["insert_point"], scale=(entity["scale_x"], entity["scale_y"], entity["scale_z"]), rotation=entity["rotation"], dxfattribs={'clip_boundary': entity["clip_boundary"]})
        elif entity_type == "WIPEOUT":
            modelspace.add_wipeout(entity["points"], dxfattribs={'image_def': entity["image_def"]})
        elif entity_type == "XLINE":
            modelspace.add_xline(entity["start_point"], entity["unit_direction"])
        elif entity_type == "RAY":
            modelspace.add_ray(entity["start_point"], entity["unit_direction"])
        elif entity_type == "HELIX":
            modelspace.add_helix(entity["base_point"], entity["top_point"], entity["radius"], entity["turns"])
        elif entity_type == "LIGHT":
            modelspace.add_light(entity["light_type"], entity["position"], target=entity["target"], dxfattribs={'color': entity["color"], 'intensity': entity["intensity"], 'status': entity["status"]})
        elif entity_type == "SECTION":
            section = modelspace.add_section(entity["name"], dxfattribs={'flags': entity["flags"]})
            section_entities = entity["entities"]
            for section_entity in section_entities:
                section.add_entity(section_entity)
        elif entity_type == "MLEADER":
            modelspace.add_mleader(entity["content"], dxfattribs={'style': entity["style"], 'leader_line_positions': entity["leader_line_positions"], 'leader_direction': entity["leader_direction"]})
        elif entity_type == "TOLERANCE":
            modelspace.add_tolerance(entity["content"], dxfattribs={'insert': entity["insert_point"], 'x_axis': entity["x_axis"], 'y_axis': entity["y_axis"], 'height': entity["height"]})
        elif entity_type == "MESH":
            mesh = modelspace.add_mesh()
            mesh.vertices = entity["vertices"]
            mesh.faces = entity["faces"]
        elif entity_type == "SURFACE":
            modelspace.add_surface(entity["control_points"], degree=(entity["degree_u"], entity["degree_v"]), dxfattribs={'knots_u': entity["knots_u"], 'knots_v': entity["knots_v"]})
        elif entity_type == "CONTOUR":
            modelspace.add_contour(entity["vertices"], dxfattribs={'flags': entity["flags"]})
        elif entity_type == "VIEWPORT":
            modelspace.add_viewport(entity["view_center_point"], view_height=entity["view_height"], dxfattribs={'snap_base_point': entity["snap_base_point"], 'view_aspect_ratio': entity["view_aspect_ratio"]})
        # Agregar lógica para otros tipos de entidades según sea necesario

    doc.saveas(output_path)


VALID_LINEWEIGHTS = (
    -3, -2, -1, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211
)


def _valid_lineweight(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number in VALID_LINEWEIGHTS:
        return number
    return min(VALID_LINEWEIGHTS, key=lambda item: abs(item - number))


def _hex_to_rgb(value):
    if not value:
        return None
    text = str(value).strip().lstrip("#")
    if len(text) != 6:
        return None
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return None


def _as_point(value, dims=3):
    if value is None:
        return None
    if hasattr(value, "x"):
        coords = [float(value.x), float(value.y), float(getattr(value, "z", 0.0))]
    else:
        coords = [float(item) for item in value]
    while len(coords) < dims:
        coords.append(0.0)
    return tuple(coords[:dims])


def _load_dxf(path):
    from dxf_load import load_dxf

    return load_dxf(path)


def _load_cad_document(path):
    suffix = str(path).lower()
    if suffix.endswith(".dwg"):
        import shutil
        import tempfile
        from pathlib import Path

        work_dir = Path(tempfile.mkdtemp(prefix="cad-dwg2dxf-"))
        dxf_path = work_dir / "source.dxf"
        try:
            from importlib.machinery import SourceFileLoader

            converter = SourceFileLoader(
                "dwg_to_dxf",
                str(Path(__file__).resolve().with_name("dwg-to-dxf.py")),
            ).load_module()
            converter.convert_dwg_to_dxf(path, dxf_path)
            return _load_dxf(dxf_path)
        except Exception as error:
            raise RuntimeError(f"Không đọc được DWG bằng aspose-cad. {error}") from error
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
    return _load_dxf(path)


def _ensure_linetype(doc, name):
    name = (name or "Continuous").strip() or "Continuous"
    if name in doc.linetypes:
        return name
    patterns = {
        "DASHED": [0.75, 0.5, -0.25],
        "DOT": [0.25, 0.0, -0.25],
        "DASHDOT": [1.0, 0.5, -0.25, 0.0, -0.25],
        "CENTER": [2.0, 1.25, -0.25, 0.25, -0.25],
        "HIDDEN": [0.375, 0.25, -0.125],
    }
    pattern = patterns.get(name.upper())
    if pattern:
        doc.linetypes.add(name, pattern=pattern, description=name)
        return name
    return "Continuous"


def _ensure_layer(doc, name, color=None, linetype="Continuous", off=None, frozen=None, plot=None):
    layer_name = (name or "0").strip() or "0"
    linetype_name = _ensure_linetype(doc, linetype)
    if layer_name not in doc.layers:
        doc.layers.add(layer_name, linetype=linetype_name)
    layer = doc.layers.get(layer_name)
    rgb = _hex_to_rgb(color)
    if rgb is not None:
        layer.rgb = rgb
    if off is True:
        layer.off()
    elif off is False:
        layer.on()
    if frozen is True:
        layer.freeze()
    elif frozen is False:
        layer.thaw()
    if plot is not None:
        try:
            layer.dxf.plot = bool(plot)
        except Exception:
            pass
    return layer_name


def _apply_style(entity, item, doc):
    layer = _ensure_layer(doc, item.get("layer"), item.get("color"), item.get("linetype"))
    entity.dxf.layer = layer
    if item.get("linetype"):
        entity.dxf.linetype = _ensure_linetype(doc, item.get("linetype"))
    if item.get("lineweight") is not None:
        weight = _valid_lineweight(item.get("lineweight"))
        if weight is not None:
            try:
                entity.dxf.lineweight = weight
            except Exception:
                pass
    rgb = _hex_to_rgb(item.get("color"))
    if rgb is not None:
        entity.rgb = rgb
    return entity


def _add_payload_entity(modelspace, item, doc):
    entity_type = (item.get("type") or "").upper()
    attribs = {}
    layer = item.get("layer")
    if layer:
        attribs["layer"] = _ensure_layer(doc, layer, item.get("color"), item.get("linetype"))
    if item.get("linetype"):
        attribs["linetype"] = _ensure_linetype(doc, item.get("linetype"))
    weight = _valid_lineweight(item.get("lineweight"))
    if weight is not None:
        attribs["lineweight"] = weight

    created = None
    if entity_type == "LINE":
        created = modelspace.add_line(
            _as_point(item.get("start_point") or item.get("points", [[0, 0], [0, 0]])[0]),
            _as_point(item.get("end_point") or item.get("points", [[0, 0], [0, 0]])[-1]),
            dxfattribs=attribs,
        )
    elif entity_type == "LWPOLYLINE":
        created = modelspace.add_lwpolyline(
            item.get("points") or [],
            close=bool(item.get("closed")),
            dxfattribs=attribs,
        )
    elif entity_type == "POLYLINE":
        created = modelspace.add_polyline2d(item.get("points") or [], dxfattribs=attribs)
    elif entity_type == "CIRCLE":
        created = modelspace.add_circle(item["center_point"], item["radius"], dxfattribs=attribs)
    elif entity_type == "ARC":
        created = modelspace.add_arc(
            item["center_point"],
            item["radius"],
            item["start_angle"],
            item["end_angle"],
            dxfattribs=attribs,
        )
    elif entity_type == "TEXT":
        created = modelspace.add_text(
            item.get("text") or "",
            dxfattribs={**attribs, "insert": _as_point(item.get("insert_point")), "height": item.get("height") or 1},
        )
        if item.get("rotation") is not None:
            created.dxf.rotation = float(item["rotation"])
    elif entity_type == "MTEXT":
        created = modelspace.add_mtext(
            item.get("text") or "",
            dxfattribs={
                **attribs,
                "insert": _as_point(item.get("insert_point")),
                "char_height": item.get("height") or 1,
            },
        )
        if item.get("width"):
            created.dxf.width = float(item["width"])
        if item.get("rotation") is not None:
            created.dxf.rotation = float(item["rotation"])
        if item.get("attachment_point"):
            created.dxf.attachment_point = int(item["attachment_point"])
    elif entity_type == "HATCH":
        created = modelspace.add_hatch(dxfattribs=attribs)
        if item.get("solid_fill") or (item.get("pattern_name") or "").upper() == "SOLID":
            created.set_solid_fill()
        else:
            created.set_pattern_fill(item.get("pattern_name") or "ANSI31", scale=item.get("pattern_scale") or 1)
        paths = item.get("paths") or []
        if paths and isinstance(paths[0][0], (int, float)):
            paths = [paths]
        for path in paths:
            created.paths.add_polyline_path(path, is_closed=True)
    elif entity_type == "POINT":
        created = modelspace.add_point(_as_point(item.get("location") or item.get("insert_point")), dxfattribs=attribs)
    elif entity_type == "SOLID":
        created = modelspace.add_solid(item.get("points") or [], dxfattribs=attribs)
    else:
        return None

    if created is not None:
        _apply_style(created, item, doc)
    return created


def _entity_by_handle(doc, handle):
    if not handle:
        return None
    wanted = str(handle).strip().upper()
    try:
        entity = doc.entitydb.get(wanted)
        if entity is not None:
            return entity
    except Exception:
        pass
    for key in doc.entitydb.keys():
        if str(key).upper().lstrip("0") == wanted.lstrip("0"):
            return doc.entitydb.get(key)
    return None


def _update_entity(entity, item):
    entity_type = entity.dxftype()
    if entity_type == "LWPOLYLINE" and item.get("points"):
        entity.set_points(item["points"])
        if item.get("closed") is not None:
            entity.closed = bool(item["closed"])
    elif entity_type == "LINE":
        if item.get("start_point"):
            entity.dxf.start = _as_point(item["start_point"])
        if item.get("end_point"):
            entity.dxf.end = _as_point(item["end_point"])
        points = item.get("points") or []
        if len(points) >= 2:
            entity.dxf.start = _as_point(points[0])
            entity.dxf.end = _as_point(points[-1])
    elif entity_type in {"MTEXT", "TEXT"}:
        if item.get("text") is not None:
            if entity_type == "MTEXT":
                entity.text = item["text"]
            else:
                entity.dxf.text = item["text"]
        if item.get("insert_point"):
            entity.dxf.insert = _as_point(item["insert_point"])
        if item.get("rotation") is not None:
            entity.dxf.rotation = float(item["rotation"])
        if item.get("height") and entity_type == "TEXT":
            entity.dxf.height = float(item["height"])
    elif entity_type == "HATCH" and item.get("paths"):
        entity.paths.clear()
        paths = item["paths"]
        if paths and isinstance(paths[0][0], (int, float)):
            paths = [paths]
        for path in paths:
            entity.paths.add_polyline_path(path, is_closed=True)


def _write_payload_entities(doc, payload):
    modelspace = doc.modelspace()
    for layer in payload.get("layers") or []:
        _ensure_layer(
            doc,
            layer.get("name"),
            layer.get("color"),
            layer.get("linetype"),
            layer.get("off"),
            layer.get("frozen"),
            layer.get("plot"),
        )

    for handle in payload.get("removed_handles") or []:
        entity = _entity_by_handle(doc, handle)
        if entity is not None:
            entity.destroy()

    updated = 0
    for item in payload.get("updates") or []:
        entity = _entity_by_handle(doc, item.get("handle"))
        if entity is None:
            continue
        _update_entity(entity, item)
        _apply_style(entity, item, doc)
        updated += 1

    added = 0
    for item in payload.get("entities") or []:
        try:
            if _add_payload_entity(modelspace, item, doc) is not None:
                added += 1
        except Exception:
            continue
    return {"added": added, "updated": updated}


def _clear_modelspace(doc):
    modelspace = doc.modelspace()
    for entity in list(modelspace):
        try:
            entity.destroy()
        except Exception:
            continue


def _update_extents(doc):
    try:
        from ezdxf import bbox, zoom

        extents = bbox.extents(doc.modelspace())
        if getattr(extents, "has_data", False):
            doc.header["$EXTMIN"] = extents.extmin
            doc.header["$EXTMAX"] = extents.extmax
        zoom.extents(doc.modelspace())
    except Exception:
        pass


def export_sheet_drawing(input_path, output_path, payload):
    """Xuất chỉ khung mẫu nhưng giữ nguyên hệ tọa độ/đơn vị của file gốc."""
    doc = _load_cad_document(input_path)
    _clear_modelspace(doc)
    result = _write_payload_entities(doc, payload)
    _update_extents(doc)
    doc.saveas(output_path)
    return result


def export_payload_drawing(output_path, payload):
    """Tạo DXF mới chỉ từ payload (không đọc file gốc)."""
    doc = ezdxf.new(dxfversion="R2010")
    result = _write_payload_entities(doc, payload)
    _update_extents(doc)
    doc.saveas(output_path)
    return result


def export_merged_drawing(input_path, output_path, payload):
    """Giữ nguyên file gốc bằng ezdxf.readfile, rồi thêm/sửa thực thể mới."""
    doc = _load_cad_document(input_path)
    result = _write_payload_entities(doc, payload)
    doc.saveas(output_path)
    return result


def export_main(argv=None):
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Xuất DXF bằng ezdxf")
    parser.add_argument("--export", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output", required=True)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--payload-only", action="store_true")
    parser.add_argument("--sheet-only", action="store_true")
    args = parser.parse_args(argv)

    with open(args.payload, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if args.payload_only:
        result = export_payload_drawing(args.output, payload)
    elif args.sheet_only:
        if not args.input:
            raise SystemExit("--input bắt buộc khi xuất khung mẫu để giữ hệ tọa độ")
        result = export_sheet_drawing(args.input, args.output, payload)
    else:
        if not args.input:
            raise SystemExit("--input bắt buộc trừ khi dùng --payload-only")
        result = export_merged_drawing(args.input, args.output, payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    import sys

    if "--export" in sys.argv:
        export_main(sys.argv[1:])
    else:
        dwg_file = r"C:\\Users\\xhito\\Desktop\\DATA SCIENCE\\eDocument\\data\\Weld-Neck-Flange-2-Inch-Class-300.dxf"
        output_file = r"C:\\Users\\xhito\\Desktop\\DATA SCIENCE\\eDocument\\data\\extracted_data.dxf"
        extracted_data = extract_dwg_data(dwg_file)
        if extracted_data:
            create_dwg_file(output_file, extracted_data)
            print(",\n".join(str(entity) for entity in extracted_data))
