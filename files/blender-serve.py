import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import addon

addon.register()

import bpy

port = int(os.environ.get("BLENDER_MCP_PORT", "9876"))
bpy.context.scene.blendermcp_port = port
bpy.context.scene.blendermcp_auto_start_server = True

if not getattr(bpy.context.scene, "blendermcp_server_running", False):
    bpy.ops.blendermcp.start_server()

print(f"blender-mcp serve started on 127.0.0.1:{port}; entering main loop", flush=True)
