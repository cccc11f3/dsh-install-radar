# dsh-install-radar

Per-session install radar for DeepSeek Harness (dsh): track **what every conversation installed on this machine** — Python packages, global npm packages, git clones, winget/choco programs — with **size, real path, created time, purpose, uninstall consequence and the reason it was installed**.

Three complementary evidence sources (miss any one and you get "C: lost 20 GB and the plugin sees nothing"):

| Source | Answers | Limits |
| --- | --- | --- |
| **Session logs** (`$DSH_HOME/sessions/**/session.v*.jsonl.zstd`, `tool/call`) | which session, which turn, which command installed X; where it landed, how big, why | only sees command evidence; `$var` targets and remote scripts stay invisible |
| **Snapshot diff** (baseline vs now) | new entries in the watched roots, directories that grew | needs a baseline; roots outside the watch list are blind |
| **Timestamp sweep** (`Device` tab) | "which folder ate the disk in the last N days" including temp dirs and other tools | time window only, no judgement of intent |

## Features

- **Left sidebar panel** (`sidebar.panellist`, above Workspaces) with two top-level tabs: **From sessions** (blue) and **Not from sessions** (orange), each with sub-views (per session / by kind / by month, and a 1/3/7-day sweep).
- **Every row** carries: size, path (copy / open in Explorer), created time, purpose, **🎯 why it was installed** (agent's own note → its reasoning sentence → your prompt), and **🟢🟡🔴 uninstall consequence**.
- **Process → disk causal table**: samples `Win32_Process` every 90 s, classifies Chrome/CDP launches, temp browser profiles, pip/npm installs, model downloads, builds, ffmpeg; groups by launcher and joins with on-disk size.
- **Backtrace** for directories left behind: correlates leftover `cdp-*` dirs with the session commands active at their creation time (probability + evidence), then finds the driver script and tells you whether it cleans up, with a ready-to-paste cleanup hook.
- **Cleanup** with two-step confirm, a temp-directory whitelist, a 50 MB floor, `danger` classes excluded, multi-select with 🟢/🟢🟡 select-all, in-place row removal (no refetch, no scroll jump) and an auto-clean switch (off by default, safe items older than N days only).
- **6 agent tools**: `install_radar_report / sessions / recent / baseline / diff / audit / history / procs / repro / autoclean`.
- **CLI** (`node bin/radar.mjs …`) works without dsh.

## Install

```powershell
dsh plugin --profile desktop add dsh-install-radar
```

Restart dsh (or hot-enable the plugin). An icon appears in the left sidebar above Workspaces.

## Agent tools

| Tool | Use |
| --- | --- |
| `install_radar_report` | full per-session report + writes `$DSH_HOME/install-radar/report.md` |
| `install_radar_sessions` | session command evidence only, filterable |
| `install_radar_recent` | "who ate the disk in the last N days", aggregated by owner folder |
| `install_radar_baseline` / `install_radar_diff` | take a baseline / diff since baseline |
| `install_radar_audit` | index `sessions/` and record vanished session dirs |
| `install_radar_history` | backtrace leftover temp dirs against session commands (probability) |
| `install_radar_procs` | process command-line causal table (CDP / pip / npm / models / builds) |
| `install_radar_repro` | find the driver script behind leftover dirs + cleanup hook |
| `install_radar_autoclean` | toggle / preview scheduled safe cleanup |

## CLI

```powershell
node bin/radar.mjs roots                     # which roots are watched
node bin/radar.mjs baseline                  # take a baseline
node bin/radar.mjs scan                      # current snapshot, top 15
node bin/radar.mjs sessions                  # what history sessions installed
node bin/radar.mjs recent --days 3           # disk growth by owner
node bin/radar.mjs diff                      # new / grown since baseline
node bin/radar.mjs report --out report.md
```

## Safety

- Cleanup only ever touches the temp-directory whitelist (`%SystemRoot%\Temp`, `%LOCALAPPDATA%\Temp`, `C:\Temp`, `TMP`); the roots themselves are refused.
- `danger` classes (`.pnpm-store`, `Windows\Installer`, `site-packages`, `node_modules`, browser `User Data`) never get a one-click delete.
- Nothing is deleted without a second confirmation; every removal is appended to `$DSH_HOME/install-radar/clean-log.jsonl`.
- Read-only with respect to session logs: the plugin never writes under `sessions/`.

## License

MIT
