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
- `files/blender-team` — orchestrator CLI (bun): stage workers,
  materials+lighting in parallel, cheap QA (bmesh + Clef judge) with
  escalation to the LLM qa worker, fix rounds re-checked deterministically
- `files/qa_checks.py` — headless deterministic QA on a scene copy: bmesh
  report, two 16-sample JPEG previews, and the model export in one process
- `files/blender-up.sh` — service supervisor (config-driven on/off)
- `files/blender-serve.py`, `files/addon.py` — vendored blender-mcp bridge
  (upstream: https://github.com/ahujames/blender-mcp), loaded via symlinks
  the setup commands place under `/home/agent/.open-bot/plugin-blender/`

## QA judge

QA does not burn an LLM session by default: the orchestrator snapshots the
live scene over the bridge socket, runs `qa_checks.py` headless (bmesh
ground truth + previews + export, ~1 s of compute), and asks the Clef
decision model (Cloudflare Workers AI, `@cf/cloudflare/clef`) to judge the
previews against the goal. Pass p >= 0.7 passes; p < 0.3 fails into fix
rounds re-checked the same way (~10 s each); the band between escalates to
the legacy LLM qa worker. Credentials come from `CLOUDFLARE_ACCOUNT_ID` /
`CLOUDFLARE_API_TOKEN` or the open-bot image auth file; the dashboard
config `qa_judge` (on/off) disables the judge. Geometry ground truth stays
in bmesh — the vision judge is for appearance only.

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
