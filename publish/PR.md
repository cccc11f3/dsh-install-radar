## What this adds

One entry file: `data/plugins/__OWNER__/__REPO__.yml` (per `contributing.md`, one file per plugin).

**dsh-install-radar** — 会话安装雷达 / per-session install radar.

It answers a question the existing tools don't: *which conversation installed this, how big is it, where does it live, why was it installed, and what happens if I remove it.*

- **Sidebar panel** (`sidebar.panellist`, above Workspaces): two top-level tabs — `From sessions` (per session / by kind / by month) and `Not from sessions` (1/3/7-day timestamp sweep of temp dirs, Local/Roaming, Downloads, Desktop, C:\ root).
- **Per row**: size, real path (copy / open in Explorer), created time, purpose, `🎯 why it was installed` (agent's own command note → its reasoning sentence → the user prompt), and `🟢🟡🔴 uninstall consequence`.
- **Backtrace**: leftover `cdp-*` / `chrome-profile-*` temp dirs are correlated with the session commands active at their creation time (probability + evidence), then the driver script is located and checked for cleanup logic; a paste-ready cleanup hook is offered when it leaks.
- **Process → disk causal table**: samples `Win32_Process` every 90 s, classifies CDP launches, temp browser profiles, pip/npm installs, model downloads, builds and ffmpeg, groups by launcher, and joins the paths with on-disk size.
- **Cleanup**: two-step confirm, temp-directory whitelist only, 50 MB floor, `danger` classes never one-clickable, multi-select with `🟢 safe` / `🟢🟡 incl. caution` select-all, rows removed in place (no refetch, no scroll jump), optional scheduled auto-clean (off by default, safe items older than N days).
- 10 agent tools (`install_radar_report / sessions / recent / baseline / diff / audit / history / procs / repro / autoclean`) and a standalone CLI.

## Checklist

- [x] `package.json` declares `dsh.bundle.patch` and `dsh.client` (`platform: web`, exports `./client`)
- [x] Host half exports `name` / `inject` / `apply`; client half registers `sidebar.panellist` + `main` keyed slot
- [x] Works on dsh 0.2.2-rc.1 (tested in DSH Desktop on Windows 11)
- [x] MIT licensed, README in zh + en
- [x] No telemetry; reads session logs read-only, writes only under `$DSH_HOME/install-radar/`
- [x] Destructive actions gated: whitelist + two-step confirm + append-only `clean-log.jsonl`
