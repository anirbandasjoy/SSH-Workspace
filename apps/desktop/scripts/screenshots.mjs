// Capture marketing screenshots of the desktop UI with demo data.
//
//   pnpm --filter desktop vite --port 1430 --strictPort   (in another terminal)
//   node apps/desktop/scripts/screenshots.mjs [outputDir]
//
// The Tauri backend is replaced by an in-page mock, so no real keys, hosts or
// emails from this computer appear in the images.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const url = process.env.APP_URL ?? "http://127.0.0.1:1430/";
const out = resolve(process.argv[2] ?? "apps/web/public/screenshots");
const chrome = process.env.CHROME ?? "google-chrome";
const port = 9333;
mkdirSync(out, { recursive: true });

const mock = () => {
  const H = "/home/maya";
  const profiles = [
    { id: "p-acme", name: "Acme Corp", username: "maya-acme", gitName: "Maya Chen", email: "maya@acme.dev", alias: "github-acme", keyPath: `${H}/.ssh/id_ed25519_acme` },
    { id: "p-oss", name: "Open source", username: "mayachen", gitName: "Maya Chen", email: "maya@hey.dev", alias: "github-oss", keyPath: `${H}/.ssh/id_ed25519_oss` },
    { id: "p-teach", name: "Teaching", username: "maya-teaches", gitName: "Maya Chen", email: "class@maya.school", alias: "github-teach", keyPath: `${H}/.ssh/id_ed25519_teach` },
  ];
  const hosts = [{ alias: "build-server", hostname: "build.acme.dev", user: "deploy", port: 22, keyPath: `${H}/.ssh/deploy_build` }];
  const rules = [
    { folder: `${H}/Work/acme`, profileId: "p-acme" },
    { folder: `${H}/Code/oss`, profileId: "p-oss" },
    { folder: `${H}/Teaching`, profileId: "p-teach" },
  ];
  const repositories = [
    `${H}/Work/acme/payments-api`,
    `${H}/Work/acme/web-dashboard`,
    `${H}/Code/oss/vexo`,
    `${H}/Code/oss/dotfiles`,
    `${H}/Teaching/git-101`,
  ];
  const key = (name, fp, loaded, usedBy = []) => ({ path: `${H}/.ssh/${name}`, publicPath: `${H}/.ssh/${name}.pub`, name, fingerprint: fp, type: "ssh-ed25519", loaded, hasPrivate: true, usedBy });
  const keys = [
    key("deploy_build", "SHA256:4kq0Zl6XyT2cJ1wHn8bVf3RsmP9aD7uEoLgK5iQx0Yc", false),
    key("id_ed25519", "SHA256:yR8m2Qe7VwN4pZsK1dHf6TcJ0uLbX3gAoE9iWnM5vBk", true, ["Host github.com"]),
    key("id_ed25519_acme", "SHA256:Pm7Xc2Lq9FzR4nWvK8sYbT1dHg6UoJ3eA0iNwE5tQrM", true),
    key("id_ed25519_oss", "SHA256:Jd3Rk8Vn1QwZ6pLf2Hs9TbY4cXgM7uAeO0iKmE5tWqN", false),
    key("id_ed25519_teach", "SHA256:Wb6Nf1Kp8XzQ3rLm9Ys2TdH7cJgV4uAoE0iRnE5tBqZ", false),
  ];
  const sshHosts = [
    ...profiles.map((p) => ({ alias: p.alias, hostname: "github.com", user: "git", port: 22, keyPath: p.keyPath })),
    ...hosts,
    { alias: "github.com", hostname: "github.com", user: "git", port: 22, keyPath: "~/.ssh/id_ed25519" },
  ];
  const repo = (path) => {
    const name = path.split("/").pop();
    const remotes = {
      "payments-api": ["git@github-acme:acme/payments-api.git", "github-acme"],
      "web-dashboard": ["git@github.com:acme/web-dashboard.git", "github.com"],
      vexo: ["git@github-oss:mayachen/vexo.git", "github-oss"],
      dotfiles: ["git@github-oss:mayachen/dotfiles.git", "github-oss"],
      "git-101": ["git@github-teach:maya-teaches/git-101.git", "github-teach"],
    }[name];
    const p = profiles.find((x) => rules.some((r) => r.profileId === x.id && path.startsWith(r.folder)));
    return {
      path, name, gitName: p.gitName, email: p.email,
      nameSource: `file:${H}/.config/ssh-workspace/identities/${p.id}.gitconfig`,
      emailSource: `file:${H}/.config/ssh-workspace/identities/${p.id}.gitconfig`,
      branch: name === "payments-api" ? "feat/refund-webhooks" : "main",
      remotes: [{ name: "origin", url: remotes[0], pushUrl: remotes[0], alias: remotes[1], testable: true, testReason: "", login: "git" }],
      sshOverride: "",
    };
  };
  const users = { "github-acme": "maya-acme", "github-oss": "mayachen", "github-teach": "maya-teaches", "github.com": "mayachen" };
  const handlers = {
    state: () => ({ profiles, hosts, rules, repositories, canUndo: true, missingKeys: [] }),
    keys: () => keys,
    hosts: () => sshHosts,
    env_info: () => ({ git: "git version 2.47.1", ssh: "OpenSSH_9.9p1", agent: "2 loaded", home: H }),
    inspect: ({ path }) => repo(path),
    test_connection: ({ alias }) => ({ ok: true, username: users[alias] ?? "", message: users[alias] ? `GitHub authenticated @${users[alias]}.` : "Connected to deploy@build.acme.dev." }),
    preview: () => ({
      token: "demo",
      files: [{ path: `${H}/Work/acme/web-dashboard/.git/config`, before: "url = git@github.com:acme/web-dashboard.git", after: "url = git@github-acme:acme/web-dashboard.git" }],
    }),
  };
  globalThis.isTauri = true;
  localStorage.setItem("workspace-theme", "dark");
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => { const id = Math.random(); window["_" + id] = cb; return id; },
    invoke: async (cmd, args) => {
      if (cmd !== "workspace") return null;
      const handler = handlers[args.name];
      if (!handler) throw "Not available in the demo.";
      return structuredClone(handler(args.payload ?? {}));
    },
  };
};

const shots = [
  { file: "repositories", steps: [["text", "Test connection"]] },
  { file: "repository-mismatch", steps: [["click", 'button[title$="web-dashboard"]']] },
  { file: "review-fix", steps: [["click", 'button[title$="web-dashboard"]'], ["text", "Preview fix"], ["text", "Preview change"]] },
  { file: "profiles", steps: [["nav", "#profiles"], ["text", "Test connection"]] },
  { file: "ssh-keys", steps: [["nav", "#ssh-keys"], ["text", "id_ed25519_acme"]] },
  { file: "hosts", steps: [["nav", "#hosts"]] },
  { file: "folder-rules", steps: [["nav", "#folder-rules"]] },
];

const profileDir = mkdtempSync(join(tmpdir(), "vexo-shots-"));
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const run = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${mock})()` });

for (const shot of shots) {
  await send("Page.navigate", { url });
  await sleep(1500);
  for (const [kind, value] of shot.steps) {
    const ok = await run(`(() => {
      const kind = ${JSON.stringify(kind)}, value = ${JSON.stringify(value)};
      let el;
      if (kind === "nav") el = document.querySelector('a[href="' + value + '"]');
      else if (kind === "click") el = document.querySelector(value);
      else el = [...document.querySelectorAll("button")].reverse().find((b) => b.textContent.trim().includes(value));
      if (!el) return false;
      el.click(); el.blur?.();
      return true;
    })()`);
    if (!ok) throw new Error(`${shot.file}: could not find ${value}`);
    await sleep(900);
  }
  await run("document.activeElement?.blur?.()");
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${shot.file}.png`), Buffer.from(data, "base64"));
  console.log("saved", shot.file);
}
ws.close();
browser.kill();
