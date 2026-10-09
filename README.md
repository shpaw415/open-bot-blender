# Blender 3D (open-bot plugin)

Headless Blender for open-bot desktops, shipped as a marketplace plugin
instead of a built-in image feature. A single Blender instance runs headless
on `127.0.0.1:9876` with the blender-mcp addon socket server; a
`blender-team` CLI orchestrates role workers (`model` → `materials` →
`lighting` → `qa`) that drive the live scene through the blender MCP tools
and export `.glb`/`.stl` models with rendered previews into the workspace.

## Install

Search for `blender` on the open-bot marketplace (`ob-plugin search blender`)
and install it (`ob-plugin install blender`). First install runs, as root in
the desktop:

- `apt-get install blender xauth` and the glTF exporter `np.bool` patch
- a python venv with `blender-mcp` under
  `/home/agent/.open-bot/plugin-blender/venv`
- a `blender-team` symlink in `/usr/local/bin`
- the service supervisor (`ob-plugin-blender-blender-up.sh`), which keeps one
  Blender alive and honors the plugin's `enabled` setting

## Layout

- `open-bot.plugin.json` — the manifest (files, setup, skill, opencode mcp +
  `blender-worker` agent + build-agent `blender_*` tool deny)
- `files/blender-team` — orchestrator CLI (bun)
- `files/blender-up.sh` — service supervisor (config-driven on/off)
- `files/blender-serve.py`, `files/addon.py` — vendored blender-mcp bridge
  (upstream: https://github.com/ahujames/blender-mcp), loaded via symlinks
  the setup commands place under `/home/agent/.open-bot/plugin-blender/`

## On/off

Dashboard → Plugins → blender → settings → `enabled` (`on`/`off`). The
supervisor stops Blender within seconds of `off` and restarts it on `on`.

## Development

```sh
bun test            # unit tests (manifest contract + CLI behavior)
```

Releases: bump `version` in the manifest, tag `v<version>`, publish the
release on GitHub, then `ob-plugin publish`. The marketplace security review
stores the release tarball; installs pull payload files from that reviewed
artifact.
