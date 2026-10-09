import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_ROLES,
  extractResult,
  isProcessAlive,
  parseRoles,
  rolePrompt,
} from "../files/blender-team"

const root = join(import.meta.dir, "..")
const script = join(root, "files", "blender-team")
const manifest = JSON.parse(
  readFileSync(join(root, "open-bot.plugin.json"), "utf8"),
) as Record<string, any>

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    env: { ...process.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stderr }
}

test("parseRoles accepts known roles and dedupes, rejects unknown", () => {
  expect(parseRoles("model,materials,lighting,qa")).toEqual([
    "model",
    "materials",
    "lighting",
    "qa",
  ])
  expect(parseRoles("qa,qa")).toEqual(["qa"])
  expect(parseRoles("sculpt")).toBeNull()
  expect(parseRoles("")).toBeNull()
  expect(DEFAULT_ROLES).toEqual(["model", "materials", "lighting", "qa"])
})

test("extractResult returns the last RESULT line", () => {
  expect(
    extractResult(
      "step one done\nRESULT: built the base mesh\nnoise\nRESULT: PASS mesh sound",
    ),
  ).toBe("PASS mesh sound")
  expect(extractResult("no result line")).toBe("")
})

test("isProcessAlive checks pid liveness", () => {
  expect(isProcessAlive(process.pid)).toBe(true)
  expect(isProcessAlive(2_000_000_000)).toBe(false)
  expect(isProcessAlive(0)).toBe(false)
  expect(isProcessAlive(Number.NaN)).toBe(false)
})

test("rolePrompt describes the scene state for fresh, resumed, and retried runs", () => {
  const args = [
    "model",
    "an owl",
    "/tmp/d",
    "/tmp/d/scene.blend",
    "/tmp/o.glb",
  ] as const
  expect(rolePrompt(...args, [])).toContain("factory startup file")
  expect(rolePrompt(...args, [], true)).toContain("previous attempt")
  expect(rolePrompt(...args, [], true)).not.toContain("factory startup file")
  expect(rolePrompt(...args, ["materials: PASS assigned ebony"])).toContain(
    "previous stages did",
  )
})

test("manifest ships the payload files and agent surfaces", () => {
  expect(manifest.id).toBe("blender")
  expect(manifest.files.map((f: any) => f.name)).toEqual([
    "blender-team",
    "blender-up.sh",
    "blender-serve.py",
    "addon.py",
  ])
  for (const file of manifest.files) {
    expect(readFileSync(join(root, file.source), "utf8").length).toBeGreaterThan(0)
  }
  expect(manifest.opencode.agents["blender-worker"].mode).toBe("all")
  expect(manifest.opencode.agentTools.build).toEqual({ "blender_*": false })
  expect(manifest.opencode.mcp.blender.enabled).toBe(true)
  expect(manifest.setup.commands.length).toBeGreaterThan(0)
  expect(manifest.setup.uninstall.length).toBeGreaterThan(0)
})

test("worker sessions carry the worker: title prefix", () => {
  const cli = readFileSync(script, "utf8")
  expect(cli).toContain("worker: blender-team")
  expect(cli).not.toContain("blender-mcp-disabled")
})

test("the service toggle reads the plugin settings file", async () => {
  const home = join(`/tmp/opencode/blender-plugin-test-${Date.now()}`)
  mkdirSync(join(home, ".config", "open-bot"), { recursive: true })
  mkdirSync(join(home, "bin"), { recursive: true })
  const stub = join(home, "bin", "blender")
  writeFileSync(stub, "#!/bin/sh\nexit 0\n")
  chmodSync(stub, 0o755)
  writeFileSync(
    join(home, ".config", "open-bot", "plugin-blender.json"),
    JSON.stringify({ settings: { enabled: "off" } }),
  )
  try {
    const proc = Bun.spawn(["bun", script, "an owl"], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${join(home, "bin")}:${process.env.PATH}`,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, code] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("blender plugin service is set to off")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("a stale lock from a dead run is cleared instead of blocking", async () => {
  const home = join(`/tmp/opencode/blender-team-test-${Date.now()}`)
  mkdirSync(join(home, ".open-bot"), { recursive: true })
  mkdirSync(join(home, "bin"), { recursive: true })
  const stub = join(home, "bin", "blender")
  writeFileSync(stub, "#!/bin/sh\nexit 0\n")
  chmodSync(stub, 0o755)
  // a live listener stands in for the blender MCP socket so the probe reaches the lock
  let listener: ReturnType<typeof Bun.listen> | null = null
  try {
    listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 9876,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
    })
  } catch {
    // port already served: the probe will see the real socket, which is fine
  }
  try {
    mkdirSync(`${home}/.open-bot/blender-team.lock`, { recursive: true })
    writeFileSync(`${home}/.open-bot/blender-team.lock/pid`, "2000000000\n")
    const probe = Bun.spawn(["bun", script, "an owl"], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${join(home, "bin")}:${process.env.PATH}`,
        OPENCODE_ATTACH_PORT: "59999",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, stdout] = await Promise.all([
      new Response(probe.stderr).text(),
      new Response(probe.stdout).text(),
      probe.exited,
    ])
    expect(stderr).not.toContain("another blender-team run holds")
    // getting to the goal line proves the stale lock was cleared and a fresh one acquired
    expect(stdout).toContain("[blender-team] goal:")
  } finally {
    listener?.stop(true)
    rmSync(home, { recursive: true, force: true })
  }
})

test("prints usage without a goal", async () => {
  const result = await run()
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("usage")
})

test("fails cleanly when blender is not installed", async () => {
  const home = join(`/tmp/opencode/blender-team-test-${Date.now()}`)
  mkdirSync(join(home, "bin"), { recursive: true })
  try {
    // absolute bun + a PATH with only the stub dir, so the system blender
    // (installed on real desktops) is never found
    const proc = Bun.spawn([process.execPath, script, "an owl"], {
      env: {
        HOME: home,
        PATH: join(home, "bin"),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, code] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("blender is not installed")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
