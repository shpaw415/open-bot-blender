# qa_checks.py — QA déterministe headless pour blender-team (plugin blender).
# Tourne sur une COPIE de scene.blend via blender --background ; ne touche jamais
# la scène vivante. Produit le rapport bmesh + 2 previews JPEG à samples réduits
# (+ export optionnel), le tout en un seul process (~1 s hors rendu).
#
# Configuration par variables d'environnement :
#   QC_DIR        répertoire de travail (préviews écrites ici)          [requis]
#   QC_EXPORT     chemin d'export du modèle (.glb ou .stl)              [option]
#   QC_SAMPLES    samples Cycles des previews d'itération               [défaut 16]
#   QC_WIDTH/H    résolution des previews                               [défaut 960x540]
#
# Sortie : une ligne "QA_REPORT_JSON {...}" sur stdout.

import bpy, bmesh, json, os, math, time
from mathutils import Vector

t0 = time.time()
qc_dir = os.environ["QC_DIR"]
qc_export = os.environ.get("QC_EXPORT", "").strip()
samples = int(os.environ.get("QC_SAMPLES", "16"))
width = int(os.environ.get("QC_WIDTH", "960"))
height = int(os.environ.get("QC_HEIGHT", "540"))

# ---------- rapport bmesh (vérité terrain géométrie) ----------
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
objects = []
total_nm = 0
for o in objs:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    loose = sum(1 for v in bm.verts if v.is_wire)
    # composantes connexes (flood fill simple ; les meshes ici sont petits)
    seen = set()
    islands = 0
    for v in bm.verts:
        if v.index in seen:
            continue
        islands += 1
        stack = [v]
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                ov = e.other_vert(cur)
                if ov.index not in seen:
                    seen.add(ov.index)
                    stack.append(ov)
    sx, sy, sz = o.matrix_world.to_scale()
    unapplied = abs(sx - 1) > 1e-4 or abs(sy - 1) > 1e-4 or abs(sz - 1) > 1e-4
    objects.append({
        "name": o.name,
        "verts": len(bm.verts),
        "faces": len(bm.faces),
        "non_manifold_edges": nm,
        "loose_verts": loose,
        "islands": islands,
        "scale": [round(sx, 4), round(sy, 4), round(sz, 4)],
        "transforms_applied": not unapplied,
        "dims_m": [round(d, 4) for d in o.dimensions],
    })
    total_nm += nm
    bm.free()

report = {
    "mesh_objects": len(objs),
    "total_non_manifold_edges": total_nm,
    "watertight": total_nm == 0,
    "transforms_all_applied": all(o["transforms_applied"] for o in objects),
    "objects": objects,
    "counts": {
        k: len([o for o in objs if k in o.name.lower()])
        for k in ("tread", "step", "leg", "wheel", "tooth", "cube")
        if any(k in o.name.lower() for o in objs)
    },
}

# ---------- caméra/lumières auto si la scène n'en a pas ----------
scene = bpy.context.scene
made_temp = []

def scene_bbox():
    pts = []
    for o in objs:
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    if not pts:
        return Vector((0, 0, 0)), 1.0
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, max((hi - lo).length, 0.05)

if not any(o.type == "CAMERA" for o in scene.objects):
    cam_data = bpy.data.cameras.new("QC_Cam")
    cam = bpy.data.objects.new("QC_Cam", cam_data)
    scene.collection.objects.link(cam)
    made_temp.append(cam)
if not any(o.type == "LIGHT" for o in scene.objects):
    sun_data = bpy.data.lights.new("QC_Sun", type="SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("QC_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    made_temp.append(sun)
    world = scene.world or bpy.data.worlds.new("QC_World")
    if scene.world is None:
        scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.9, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

center, radius = scene_bbox()
cam = next(o for o in scene.objects if o.type == "CAMERA")
scene.camera = cam

def frame(azimuth_deg):
    d = radius * 1.9
    a = math.radians(azimuth_deg)
    cam.location = center + Vector((d * math.cos(a), d * math.sin(a), radius * 0.55))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

# ---------- rendu des 2 previews d'itération (JPEG, samples réduits) ----------
scene.render.engine = "CYCLES"
scene.cycles.samples = samples
try:
    scene.cycles.use_denoising = False
except Exception:
    pass
scene.render.resolution_x = width
scene.render.resolution_y = height
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 75

previews = []
for name, az in (("preview-qa.jpg", 35), ("preview-qa-2.jpg", 215)):
    frame(az)
    path = os.path.join(qc_dir, name)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    previews.append(path)

# ---------- export optionnel depuis la copie (état final sauvegardé) ----------
exported = None
if qc_export:
    os.makedirs(os.path.dirname(qc_export) or ".", exist_ok=True)
    if qc_export.lower().endswith(".stl"):
        try:
            bpy.ops.export_mesh.stl(filepath=qc_export)
        except AttributeError:
            bpy.ops.wm.stl_export(filepath=qc_export)
    else:
        bpy.ops.export_scene.gltf(filepath=qc_export, export_format="GLB")
    exported = qc_export

report["previews"] = previews
report["exported"] = exported
report["duration_s"] = round(time.time() - t0, 3)
print("QA_REPORT_JSON " + json.dumps(report))
