# open-bot-blender

The open-bot marketplace plugin `blender` — headless Blender 3D modeling
(`blender-team` worker pipeline over the blender MCP bridge) for open-bot
desktops. Lives at the custom domain marketplace; publish base URL is
`https://market.open-bot.app`.

## Layout

- `open-bot.plugin.json` — the manifest (files, setup, skill, opencode mcp +
  blender-worker agent + build-agent `blender_*` deny, configs)
- `files/` — payload files shipped in the release tarball: `blender-team`
  (bun CLI), `blender-up.sh` (service supervisor, honors the plugin
  `enabled` setting), `blender-serve.py` + `addon.py` (vendored blender-mcp)
- `test/` — bun tests (manifest contract + CLI behavior + toggle read)

## Workflow

```sh
bun test                                        # always green before release
# bump version in open-bot.plugin.json, then:
git commit && git push
gh release create v<version> -R shpaw415/open-bot-blender --notes "..."
# publish (review is slow/flaky — expect 524s, retry):
curl -s -m 290 -X POST https://market.open-bot.app/api/publish \
  -H "Authorization: Bearer $(grep '^OP_API_KEY=' ../open-bot/.env | cut -d= -f2-)" \
  -H "content-type: application/json" \
  -d "$(jq -n --slurpfile m open-bot.plugin.json '{manifest: $m[0]}')"
```

- Publish auth: marketplace user API key `OP_API_KEY` in the open-bot
  project's root `.env` (or instance token `OPEN_BOT_MARKETPLACE_TOKEN` in
  `../open-bot/deploy/.env`).
- Each publish re-runs the GLM security review; only a `pass` stores the
  release tarball in R2 and flips the version to `approved`.
- Install/upgrade on a desktop: `ob-plugin install blender --yes`.
- The guard cron `plugin:blender:guard` (created 2026-10-09 on the live
  instance) maintains this repo: issues, PRs, marketplace discussion,
  releases. Plugin projects on desktops live in `~/plugins-create/blender`.

## Platform notes

- Payload `files[]` are text only; installed as
  `/usr/local/bin/ob-plugin-blender-*` (persistent volume).
- Agent surfaces (`opencode.agents`, `opencode.agentTools`) are deep-merged
  into the desktop's `opencode.json` and reversed on uninstall/disable.
- Helper sessions must be titled with the `worker:` prefix (hidden from the
  dashboard thread list).
- Service toggle: dashboard → Plugins → blender → settings → `enabled`.
