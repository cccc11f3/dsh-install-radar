/**
 * dsh-install-radar —— 浏览器半部分
 *
 * 两个入口：
 *   1. `sidebar.panellist`（root 作用域的 list 槽）：左侧栏「新建会话」下面的图标行，
 *      按 order 排在工作区（sidebar.workspaces）之上。
 *   2. `main`（root 作用域的 keyed 槽，key = 'install-radar'）：点左边栏图标后占满主面板的报告页。
 *
 * 数据全部走宿主注册的 /api/install-radar/* 路由（ctx.connection.rpc.call）。
 * 不渲染 JSON、不读文件，宿主返回什么就画什么。
 */
window.__ModuleLoader__.load({
  id: 'dsh-install-radar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'install-radar'
    const NS = 'install-radar'

    const STRINGS = {
      zh: {
        panel: '装了什么',
        title: '装了什么 · 会话安装雷达',
        subtitle: '每个会话往这台电脑里装了什么：体积、位置、创建时间、用途',
        refresh: '重扫',
        baseline: '立基线',
        search: '搜索包名 / 路径 / 用途…',
        sessions: '个会话有安装动作',
        items: '个条目',
        total: '合计',
        baselineAt: '基线',
        noBaseline: '未建立（只能看到命令证据）',
        scanning: '正在扫描…',
        empty: '还没有数据，点「重扫」开始。',
        unattributed: '基线以来新出现（无命令证据）',
        evidence: '证据',
        whyInstalled: '为什么装',
        createdAt: '创建于',
        notFound: '未找到产物',
        guessed: '推测',
        size: '体积',
        purpose: '用途',
        copy: '复制路径',
        copied: '已复制',
        uninstall: '卸载命令',
        openFolder: '打开文件夹',
        tabSessions: '按会话',
        tabEco: '按类型',
        tabMonth: '按时间',
        tabRecent: '今天',
        catSession: '会话安装',
        catDevice: '非会话新增',
        procSect: '谁在拉起 CDP / Chrome（进程命令行审计）',
        procNone: '还没有采样记录，宿主运行后每 90 秒自动采一次',
        historySect: '历史侧写：这些目录是谁留下的（按时间与会话命令对表，只给概率）',
        historyNone: '没有遗留目录可回溯。',
        historySummary: '能对上会话',
        unmatched: '对不上任何会话',
        causalSect: '因果表：进程 → 磁盘',
        uninstallRisk: '卸载后果',
        reproBtn: '找复现线索',
        reproBusy: '正在翻会话命令…',
        reproNone: '这个会话里没找到带 CDP 特征的脚本。',
        cleanable: '可清理',
        selectAll: '全选可清理',
        selectSafe: '🟢 只选安全',
        selectAllWarn: '🟢🟡 全选（含需注意）',
        clearSel: '清空',
        deleteSelected: '删除选中',
        confirmBatch: '确认删除以下',
        autoCleanLabel: '定时自动清理',
        autoCleanHint: '只清 🟢 安全项 · 超过',
        autoCleanDays: '天的',
        autoCleanOn: '开',
        autoCleanOff: '关',
        trendTitle: '增长趋势（近 14 天，按文件时间戳）',
        trendEmpty: '近 14 天没有新写入。',
        clean: '清理',
        confirmClean: '确认删除？',
        doClean: '删除',
        cancelClean: '取消',
        freed: '已释放',
        noTime: '未知时间',
        recentHead: '今天零点以来新增/写入的东西（不看基线，直接按时间戳扫）',
        recentEmpty: '今天没有扫到新增文件。',
        error: '出错了',
      },
      en: {
        panel: 'Installs',
        title: 'Installs · per-session install radar',
        subtitle: 'What each session installed on this machine: size, path, created time, purpose',
        refresh: 'Rescan',
        baseline: 'Set baseline',
        search: 'Search package / path / purpose…',
        sessions: 'sessions installed something',
        items: 'items',
        total: 'total',
        baselineAt: 'baseline',
        noBaseline: 'not set (command evidence only)',
        scanning: 'Scanning…',
        empty: 'No data yet — hit Rescan.',
        unattributed: 'New since baseline (no command evidence)',
        evidence: 'Evidence',
        whyInstalled: 'Why',
        createdAt: 'created',
        notFound: 'artifacts not found',
        guessed: 'guess',
        size: 'size',
        purpose: 'purpose',
        copy: 'Copy path',
        copied: 'Copied',
        uninstall: 'Uninstall',
        openFolder: 'Open folder',
        tabSessions: 'Sessions',
        tabEco: 'By kind',
        tabMonth: 'By month',
        tabRecent: 'Today',
        catSession: 'From sessions',
        catDevice: 'Not from sessions',
        procSect: 'Who launches CDP / Chrome (process command lines)',
        procNone: 'No samples yet — the host samples every 90s',
        historySect: 'Backtrace: who left these directories (time vs session commands, probability only)',
        historyNone: 'Nothing left on disk to profile.',
        historySummary: 'matched to sessions',
        unmatched: 'no session match',
        causalSect: 'Causal table: process → disk',
        uninstallRisk: 'After uninstall',
        reproBtn: 'Find the driver',
        reproBusy: 'Scanning session commands…',
        reproNone: 'No CDP-capable script found in this session.',
        cleanable: 'cleanable',
        selectAll: 'Select all',
        selectSafe: '🟢 Safe only',
        selectAllWarn: '🟢🟡 All (incl. caution)',
        clearSel: 'Clear',
        deleteSelected: 'Delete selected',
        confirmBatch: 'Delete these',
        autoCleanLabel: 'Auto clean',
        autoCleanHint: 'only 🟢 safe items older than',
        autoCleanDays: 'days',
        autoCleanOn: 'on',
        autoCleanOff: 'off',
        trendTitle: 'Growth (last 14 days, by file timestamps)',
        trendEmpty: 'Nothing new in 14 days.',
        clean: 'Clean',
        confirmClean: 'Delete?',
        doClean: 'Delete',
        cancelClean: 'Cancel',
        freed: 'freed',
        noTime: 'no date',
        recentHead: 'Written or created since midnight (timestamps, not baseline)',
        recentEmpty: 'Nothing new today.',
        error: 'Failed',
      },
    }

    let localeIsEnglish = false
    const t = (key) => (localeIsEnglish ? STRINGS.en : STRINGS.zh)[key] ?? key

    const CSS = `
.dsh-ir-panel{height:100%;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;
  color:var(--dsw-alias-label-primary,#1f1f1f);font-size:13px;line-height:1.55;
  font-family:"PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Noto Sans SC",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dsh-ir-head{padding:18px 22px 12px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08))}
.dsh-ir-h1{margin:0;font-size:17px;font-weight:600;letter-spacing:.01em}
.dsh-ir-sub{margin-top:4px;color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.dsh-ir-actions{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
.dsh-ir-btn{height:30px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));
  background:var(--dsw-alias-button-elevated-fill,rgba(0,0,0,.03));color:inherit;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dsh-ir-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-ir-btn[disabled]{opacity:.5;cursor:default}
.dsh-ir-btn--primary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff}
.dsh-ir-btn--primary:hover{filter:brightness(1.06);background:var(--dsw-alias-state-business-primary,#3b82f6)}
.dsh-ir-search{flex:1;min-width:180px;height:30px;padding:0 10px;border-radius:8px;font:inherit;font-size:12px;color:inherit;
  border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-input-fill,rgba(0,0,0,.03))}
.dsh-ir-search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#3b82f6)}
.dsh-ir-stats{display:flex;gap:18px;flex-wrap:wrap;padding:12px 22px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.dsh-ir-stats b{color:var(--dsw-alias-label-primary,#1f1f1f);font-weight:600;font-variant-numeric:tabular-nums}
.dsh-ir-body{flex:1;min-height:0;overflow:auto;padding:8px 12px 24px}
.dsh-ir-session{margin:8px 4px 14px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));overflow:hidden}
.dsh-ir-sessionHead{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;user-select:none;
  background:var(--dsw-alias-bg-l1,rgba(0,0,0,.02))}
.dsh-ir-sessionHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-ir-caret{width:12px;flex:none;color:var(--dsw-alias-label-secondary,#888);transition:transform .12s ease}
.dsh-ir-caret--open{transform:rotate(90deg)}
.dsh-ir-sessionTitle{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ir-badge{flex:none;font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-l2,rgba(0,0,0,.06));
  color:var(--dsw-alias-label-secondary,#666);font-variant-numeric:tabular-nums}
.dsh-ir-cwd{padding:0 12px 8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);word-break:break-all}
.dsh-ir-item{padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.06));display:grid;
  grid-template-columns:minmax(140px,1.1fr) 92px minmax(220px,2fr) 150px;gap:8px 14px;align-items:start}
.dsh-ir-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ir-eco{font-size:11px;color:var(--dsw-alias-label-secondary,#777)}
.dsh-ir-purpose{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.dsh-ir-path{font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:11px;
  color:var(--dsw-alias-label-secondary,#666);word-break:break-all;cursor:pointer}
.dsh-ir-path:hover{color:var(--dsw-alias-state-business-primary,#3b82f6);text-decoration:underline}
.dsh-ir-time{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums;text-align:right}
.dsh-ir-size{font-variant-numeric:tabular-nums;font-weight:600}
.dsh-ir-evidence{padding:0 12px 9px;font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);
  font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:pre-wrap;word-break:break-all;opacity:.85}
.dsh-ir-note{font-size:11px;color:var(--dsw-alias-state-warning-primary,#c07c00)}
.dsh-ir-empty{padding:48px 22px;text-align:center;color:var(--dsw-alias-label-secondary,#777)}
.dsh-ir-sect{padding:14px 22px 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#666)}
.dsh-ir-tabs{display:flex;gap:4px;padding:0 22px 8px;flex:none}
.dsh-ir-tab{height:26px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));
  background:transparent;color:var(--dsw-alias-label-secondary,#7a7a7a);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dsh-ir-tab::before{content:'';width:7px;height:7px;border-radius:50%;flex:none;opacity:.55}
.dsh-ir-tab--session::before{background:#4d90f0}
.dsh-ir-tab--device::before{background:#e08a2e}
.dsh-ir-tab--session{border-color:rgba(77,144,240,.35);color:#8fc0ff}
.dsh-ir-tab--device{border-color:rgba(224,138,46,.35);color:#e8b26a}
.dsh-ir-tab--session:hover{background:rgba(77,144,240,.12)}
.dsh-ir-tab--device:hover{background:rgba(224,138,46,.12)}
.dsh-ir-tab--session.dsh-ir-tab--on{background:rgba(77,144,240,.22);border-color:rgba(77,144,240,.75);color:#eaf3ff;font-weight:600}
.dsh-ir-tab--session.dsh-ir-tab--on::before{opacity:1;box-shadow:0 0 0 3px rgba(77,144,240,.25)}
.dsh-ir-tab--device.dsh-ir-tab--on{background:rgba(224,138,46,.24);border-color:rgba(224,138,46,.8);color:#ffe6c7;font-weight:600}
.dsh-ir-tab--device.dsh-ir-tab--on::before{opacity:1;box-shadow:0 0 0 3px rgba(224,138,46,.28)}
.dsh-ir-chip{height:20px;padding:0 7px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));
  background:transparent;color:var(--dsw-alias-label-secondary,#777);font:inherit;font-size:11px;cursor:pointer;flex:none}
.dsh-ir-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f1f1f)}
.dsh-ir-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-l2,rgba(0,0,0,.08));overflow:hidden;margin:6px 0 0}
.dsh-ir-barFill{height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#3b82f6);opacity:.75}
.dsh-ir-recentHead{padding:8px 22px;font-size:12px;color:var(--dsw-alias-label-secondary,#666);flex:none}
.dsh-ir-recentRow{display:grid;grid-template-columns:96px minmax(240px,2fr) minmax(180px,1.4fr) auto;gap:6px 14px;align-items:start;
  padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.06))}
/* —— 两类视觉分层：会话=蓝，设备/非会话=橙 —— */
.dsh-ir-session{border-left:3px solid rgba(59,130,246,.55);background:var(--dsw-alias-bg-l1,rgba(0,0,0,.015))}
.dsh-ir-session--alt{background:var(--dsw-alias-bg-l2,rgba(0,0,0,.035))}
.dsh-ir-recent{border-radius:10px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));
  border-left:3px solid rgba(224,138,46,.65);margin:8px 4px;overflow:hidden;background:var(--dsw-alias-bg-l1,rgba(0,0,0,.015))}
.dsh-ir-sect--device{color:#c07c00;border-left:3px solid rgba(224,138,46,.65);padding-left:10px;margin-left:8px}
.dsh-ir-subtabs{display:flex;gap:6px;padding:0 22px 8px;flex:none}
.dsh-ir-subtab{height:24px;padding:0 9px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));
  background:transparent;color:var(--dsw-alias-label-secondary,#777);font:inherit;font-size:11px;cursor:pointer}
.dsh-ir-subtab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-ir-subtab--on{background:rgba(59,130,246,.14);border-color:rgba(59,130,246,.45);color:var(--dsw-alias-label-primary,#1f1f1f);font-weight:600}
.dsh-ir-days{display:flex;gap:6px;padding:8px 12px 2px}
.dsh-ir-chip--danger{color:#d33;border-color:rgba(221,51,51,.35)}
.dsh-ir-chip--danger:hover{background:rgba(221,51,51,.1);color:#d33}
.dsh-ir-confirm{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 12px 8px;padding:7px 9px;border-radius:8px;
  background:rgba(221,51,51,.08);border:.5px solid rgba(221,51,51,.3);font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.dsh-ir-procRow{display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.06));
  margin:0 4px;background:var(--dsw-alias-bg-l1,rgba(0,0,0,.015))}
.dsh-ir-item{background:rgba(59,130,246,.045);border-left:2px solid rgba(59,130,246,.25);margin-left:10px}
/* 每个条目一张独立小卡：交替底色 + 间距 + 左侧色条，相邻两行不再糊在一起 */
.dsh-ir-itemCard{margin:8px 10px;padding:4px 0 6px;border-radius:9px;
  border:.5px solid rgba(77,144,240,.22);border-left:3px solid rgba(77,144,240,.55);
  background:rgba(77,144,240,.075)}
.dsh-ir-itemCard--alt{border-left-color:rgba(148,163,184,.7);background:rgba(148,163,184,.085)}
.dsh-ir-itemCard .dsh-ir-item{background:transparent;border-left:none;margin-left:0}
.dsh-ir-why{padding:2px 12px 2px;font-size:12px;color:var(--dsw-alias-state-business-primary,#6ea8ff);opacity:.95}
.dsh-ir-risk{display:inline-flex;align-items:center;gap:5px;font-size:11px;margin-top:3px}
.dsh-ir-risk::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.dsh-ir-risk--safe{color:#2f9e5f}
.dsh-ir-risk--caution{color:#c07c00}
.dsh-ir-risk--danger{color:#d33}
.dsh-ir-histRow{display:grid;grid-template-columns:64px minmax(200px,2fr) 96px minmax(160px,1.4fr);gap:4px 12px;align-items:start;
  padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.06));margin:0 4px;background:var(--dsw-alias-bg-l1,rgba(0,0,0,.015))}
.dsh-ir-prob{font-size:11px;font-weight:600}
.dsh-ir-prob--high{color:#d33}
.dsh-ir-prob--medium{color:#c07c00}
.dsh-ir-prob--low{color:var(--dsw-alias-label-tertiary,#888)}
.dsh-ir-repro{margin:6px 4px;padding:9px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));
  border-left:3px solid rgba(224,138,46,.65);background:var(--dsw-alias-bg-l1,rgba(0,0,0,.015))}
.dsh-ir-reproHead{display:flex;align-items:center;gap:8px;cursor:pointer}
.dsh-ir-hook{margin:8px 0 0;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.28);color:#d8e6ff;font-size:11px;line-height:1.5;
  overflow:auto;max-height:260px;font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);white-space:pre}
.dsh-ir-selbar{display:flex;gap:8px;align-items:center;padding:6px 12px 4px;flex-wrap:wrap}
/* 选择栏吸附在滚动容器顶部，按钮靠右，滚到最下面也能直接点 */
.dsh-ir-selbarWrap{position:sticky;top:0;z-index:6;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
  padding:8px 12px;margin:0 -12px;
  background:color-mix(in srgb, var(--dsw-alias-bg-base, #17181c) 94%, transparent);
  backdrop-filter:blur(10px);
  border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));
  box-shadow:0 6px 14px -10px rgba(0,0,0,.55)}
.dsh-ir-selbarWrap--confirm{background:color-mix(in srgb, rgba(221,51,51,.16) 90%, var(--dsw-alias-bg-base,#17181c));
  border-bottom-color:rgba(221,51,51,.45)}
.dsh-ir-selbarSpacer{flex:1}
.dsh-ir-check{width:14px;height:14px;accent-color:#d33;cursor:pointer;flex:none}
.dsh-ir-recent--picked{border-left-color:rgba(221,51,51,.8);background:rgba(221,51,51,.07)}
.dsh-ir-btn--danger{border-color:rgba(221,51,51,.45);color:#d33;background:rgba(221,51,51,.1)}
.dsh-ir-btn--danger:hover{background:rgba(221,51,51,.18)}
.dsh-ir-btn--danger[disabled]{opacity:.45}
.dsh-ir-trend{margin:10px 4px 0;padding:10px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));
  background:var(--dsw-alias-bg-l1,rgba(0,0,0,.015))}
.dsh-ir-trendHead{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#666);margin-bottom:8px}
.dsh-ir-bars{display:flex;align-items:flex-end;gap:4px;height:64px}
.dsh-ir-barCol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;min-width:0;position:relative}
.dsh-ir-barFillV{width:100%;max-width:22px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,rgba(224,138,46,.95),rgba(224,138,46,.55))}
.dsh-ir-barLabel{font-size:9px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap}
.dsh-ir-acrow{display:flex;align-items:center;gap:8px;padding:8px 12px 2px;flex-wrap:wrap}
.dsh-ir-chip--on{background:rgba(47,158,95,.18);border-color:rgba(47,158,95,.45);color:#2f9e5f}
.dsh-ir-select{height:24px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));
  background:var(--dsw-alias-input-fill,rgba(0,0,0,.03));color:inherit;font:inherit;font-size:11px;padding:0 6px}
@media (max-width:900px){.dsh-ir-item{grid-template-columns:1fr}.dsh-ir-time{text-align:left}}
`

    let cssInjected = false
    function injectCSS() {
      if (cssInjected) return
      if (typeof document === 'undefined') return
      const el = document.createElement('style')
      el.dataset.dshInstallRadar = '1'
      el.textContent = CSS
      document.head.appendChild(el)
      cssInjected = true
    }

    /** 侧栏图标：盒子 + 扫描弧，跟主题同色 */
    function RadarGlyph(props) {
      const size = props && props.size ? props.size : 18
      const active = !!(props && props.active)
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.5 7.2 10 3.4l7.5 3.8v5.6L10 16.6l-7.5-3.8V7.2Z',
          stroke: 'currentColor',
          strokeWidth: active ? 1.6 : 1.4,
          strokeLinejoin: 'round',
          opacity: active ? 1 : 0.85,
        }),
        h('path', { d: 'M2.5 7.2 10 11l7.5-3.8M10 11v5.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', opacity: 0.7 }),
        h('circle', { cx: 10, cy: 7.4, r: 1.5, fill: 'currentColor', opacity: active ? 0.95 : 0.75 }),
      )
    }

    function formatWhen(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function rpcOf(ctx) {
      const connection = ctx.get('connection')
      const rpc = connection && connection.rpc
      if (!rpc) throw new Error('connection.rpc unavailable')
      return rpc
    }

    function callRpc(rpc, endpoint, payload, signal) {
      return rpc.call('/api', `install-radar/${endpoint}`, payload || {}, signal).then((result) => {
        if (!result || result.ok !== true) {
          const message = result && result.error && result.error.message ? result.error.message : 'RPC 调用失败'
          throw new Error(message)
        }
        return result.value
      })
    }

    function formatSize(bytes) {
      const n = Number(bytes) || 0
      if (n < 1024) return `${n} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let value = n / 1024
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index++
      }
      return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
    }

    const ECO_LABELS = {
      python: 'Python 包',
      node: 'Node 包',
      git: '代码仓库',
      winget: 'winget 程序',
      choco: 'Chocolatey 包',
      conda: 'conda 环境',
      'python-env': '虚拟环境',
      download: '下载文件',
      installer: '安装器',
      'remote-script': '远程脚本',
    }

    function Stat(props) {
      return h('span', null, props.label, ' ', h('b', null, props.value))
    }

    /** 在资源管理器里打开/选中一个路径（宿主用 explorer.exe 执行） */
    function openTarget(rpc, path) {
      if (!rpc || !path) return
      callRpc(rpc, 'open', { path }).catch(() => {})
    }

    function CopyChip({ text, label, title }) {
      const [done, setDone] = useState(false)
      const onCopy = useCallback(() => {
        const nav = typeof navigator !== 'undefined' ? navigator : null
        if (!text || !nav || !nav.clipboard || !nav.clipboard.writeText) return
        nav.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }, () => {})
      }, [text])
      if (!text) return null
      return h('button', { type: 'button', className: 'dsh-ir-chip', onClick: onCopy, title: title || label }, done ? t('copied') : label)
    }

    function Item({ item, rpc, index }) {
      const tags = []
      if (item.confidence === 'none') tags.push(t('notFound'))
      if (item.confidence === 'low') tags.push(t('guessed'))
      const alt = typeof index === 'number' && index % 2 === 1
      return h(
        'div',
        { className: `dsh-ir-itemCard${alt ? ' dsh-ir-itemCard--alt' : ''}` },
        h(
          'div',
          { className: 'dsh-ir-item' },
          h('div', { className: 'dsh-ir-name', title: item.name }, item.name),
          h('div', null, h('span', { className: 'dsh-ir-eco' }, item.eco || item.category || '')),
          h('div', { className: 'dsh-ir-purpose' }, [
            h('span', { key: 'purpose' }, item.purpose),
            item.note ? h('div', { key: 'note', className: 'dsh-ir-note' }, item.note) : null,
            tags.length > 0 ? h('div', { key: 'tags', className: 'dsh-ir-note' }, tags.join(' · ')) : null,
          ]),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 } },
            h('span', { className: 'dsh-ir-size' }, item.size),
            h('span', { className: 'dsh-ir-time' }, item.birthtime ? `${t('createdAt')} ${formatWhen(item.birthtime)}` : ''),
          ),
        ),
        h('div', { style: { padding: '0 12px 4px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
          h('code', { key: 'p', className: 'dsh-ir-path', title: t('copy') }, item.path || '—'),
          item.path ? h(CopyChip, { key: 'cp', text: item.path, label: t('copy'), title: item.path }) : null,
          item.path
            ? h(
                'button',
                {
                  key: 'op',
                  type: 'button',
                  className: 'dsh-ir-chip',
                  onClick: () => openTarget(rpc, item.path),
                  title: item.path,
                },
                t('openFolder'),
              )
            : null,
          item.uninstall ? h(CopyChip, { key: 'un', text: item.uninstall, label: t('uninstall'), title: item.uninstall }) : null,
        ]),
        item.why && item.why.text
          ? h('div', { className: 'dsh-ir-why' }, `🎯 ${t('whyInstalled')}：${item.why.text}`)
          : null,
        item.command
          ? h('div', { className: 'dsh-ir-evidence' }, `${t('evidence')}: ${String(item.command).split('\n')[0].slice(0, 220)}`)
          : null,
        item.uninstallRisk
          ? h(
              'div',
              { style: { padding: '2px 12px 8px' } },
              h(RiskNote, { level: item.uninstallRisk.level, text: item.uninstallRisk.consequence, prefix: t('uninstallRisk') }),
            )
          : null,
      )
    }

    /** 按类型 / 按月份的分组块：一个组就是一张同款卡片 */
    function ItemGroup({ group, rpc }) {
      const [open, setOpen] = useState(false)
      return h(
        'div',
        { className: 'dsh-ir-session' },
        h(
          'div',
          { className: 'dsh-ir-sessionHead', onClick: () => setOpen((v) => !v) },
          h('span', { className: `dsh-ir-caret${open ? ' dsh-ir-caret--open' : ''}` }, '▶'),
          h('span', { className: 'dsh-ir-sessionTitle', title: group.title }, group.title),
          h('span', { className: 'dsh-ir-badge' }, `${group.items.length} ${t('items')}`),
          h('span', { className: 'dsh-ir-badge' }, group.size),
        ),
        typeof group.share === 'number'
          ? h('div', { className: 'dsh-ir-bar' }, h('div', { className: 'dsh-ir-barFill', style: { width: `${Math.max(2, Math.round(group.share * 100))}%` } }))
          : null,
        open ? group.items.map((item, index) => h(Item, { key: `${item.name}-${index}`, item, rpc, index })) : null,
      )
    }

    /** 「今天」的一行：一个归属目录（可勾选批量清理 / 单条两段式清理） */
    function RecentRow({ item, rpc, pending, cleanBusy, onAsk, onCancel, onConfirm, selected, onToggle }) {
      const checkable = item.cleanable !== false
      return h(
        'div',
        { className: `dsh-ir-recent${selected ? ' dsh-ir-recent--picked' : ''}` },
        h(
          'div',
          { className: 'dsh-ir-recentRow' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            checkable
              ? h('input', {
                  type: 'checkbox',
                  className: 'dsh-ir-check',
                  checked: !!selected,
                  onChange: () => onToggle && onToggle(item.path),
                  title: item.path,
                })
              : h('span', { title: '不可一键删（风险高或小于 50 MB）' }, '🔴'),
            h('span', { className: 'dsh-ir-size' }, item.size),
          ),
          h(
            'div',
            null,
            h('code', { className: 'dsh-ir-path', title: item.path }, item.path),
            h('div', { className: 'dsh-ir-eco' }, `${item.files} 文件 · ${item.label || ''}`),
          ),
          h('div', { className: 'dsh-ir-purpose' }, [h('span', { key: 'p' }, item.purpose)]),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', { type: 'button', className: 'dsh-ir-chip', onClick: () => openTarget(rpc, item.path) }, t('openFolder')),
            h(CopyChip, { text: item.path, label: t('copy') }),
            onAsk && checkable
              ? h(
                  'button',
                  { type: 'button', className: 'dsh-ir-chip dsh-ir-chip--danger', onClick: onAsk, disabled: cleanBusy },
                  t('clean'),
                )
              : null,
          ),
        ),
        item.consequence
          ? h('div', { style: { padding: '0 12px 6px' } }, h(RiskNote, { level: item.risk, text: item.consequence }))
          : null,
        pending
          ? h(
              'div',
              { className: 'dsh-ir-confirm' },
              h('span', null, `${t('confirmClean')} ${item.path}（${item.size}）`),
              h('button', { type: 'button', className: 'dsh-ir-chip dsh-ir-chip--danger', disabled: cleanBusy, onClick: onConfirm }, t('doClean')),
              h('button', { type: 'button', className: 'dsh-ir-chip', disabled: cleanBusy, onClick: onCancel }, t('cancelClean')),
            )
          : null,
        item.samples && item.samples.length > 0 ? h('div', { className: 'dsh-ir-evidence' }, `示例：${item.samples.join('\n')}`) : null,
      )
    }

    /** 后果标注：删了会怎样（🟢 不影响 / 🟡 需注意 / 🔴 不要删） */
    function RiskNote({ level, text, prefix }) {
      const emoji = { safe: '🟢', caution: '🟡', danger: '🔴' }
      const map = { safe: '不影响', caution: '需注意', danger: '不要删' }
      const key = level || 'caution'
      return h(
        'div',
        { className: `dsh-ir-risk dsh-ir-risk--${key}` },
        `${emoji[key] || '🟡'} ${prefix || map[key] || '需注意'}：${text}`,
      )
    }

    /**
     * 清理结果 → 新的列表（纯函数，方便单测）。
     * 只摘掉删成功的行，不重新拉取：滚动位置与勾选状态都留在原地。
     * 支持通配行（C:\Windows\Temp\cdp-*）：任一被删的真实路径落在前缀下就算摘掉。
     */
    function filterCleaned(recent, value) {
      const removed = (value && Array.isArray(value.items) ? value.items : [])
        .filter((item) => item.ok !== false)
        .map((item) => String(item.path).toLowerCase())
      if (!recent || !Array.isArray(recent.items) || removed.length === 0) return { recent, removed: [] }
      const gone = (path) => {
        const p = String(path || '').toLowerCase()
        if (!p) return false
        if (p.endsWith('*')) {
          const prefix = p.slice(0, -1)
          return removed.some((item) => item.startsWith(prefix))
        }
        return removed.includes(p)
      }
      const dropped = recent.items.filter((item) => gone(item.path))
      if (dropped.length === 0) return { recent, removed: [] }
      const items = recent.items.filter((item) => !gone(item.path))
      const removedBytes = dropped.reduce((sum, item) => sum + (item.bytes || 0), 0)
      const removedFiles = dropped.reduce((sum, item) => sum + (item.files || 0), 0)
      return {
        recent: {
          ...recent,
          items,
          totalBytes: Math.max(0, (recent.totalBytes || 0) - removedBytes),
          totalFiles: Math.max(0, (recent.totalFiles || 0) - removedFiles),
        },
        removed: dropped.map((item) => item.path),
      }
    }

    /** 吸附在顶部的选择栏（滚到最下面也能直接按） */
    function SelBar({
      cleanableCount,
      totalCount,
      safeCount,
      selectedCount,
      selectedSize,
      busy,
      pending,
      onSelectSafe,
      onSelectAll,
      onClear,
      onDelete,
      onConfirm,
      onCancel,
    }) {
      return h(
        'div',
        { className: `dsh-ir-selbarWrap${pending ? ' dsh-ir-selbarWrap--confirm' : ''}` },
        pending
          ? [
              h('span', { key: 'txt' }, `🔴 ${t('confirmBatch')} ${selectedCount} 项，共 ${selectedSize}？`),
              h('span', { key: 'sp', className: 'dsh-ir-selbarSpacer' }),
              h('button', { key: 'ok', type: 'button', className: 'dsh-ir-chip dsh-ir-chip--danger', disabled: busy, onClick: onConfirm }, t('doClean')),
              h('button', { key: 'no', type: 'button', className: 'dsh-ir-chip', disabled: busy, onClick: onCancel }, t('cancelClean')),
            ]
          : [
              h('span', { key: 'cnt', className: 'dsh-ir-eco' }, `${t('cleanable')} ${cleanableCount} / ${totalCount}`),
              h('span', { key: 'sp', className: 'dsh-ir-selbarSpacer' }),
              h(
                'button',
                { key: 'safe', type: 'button', className: 'dsh-ir-chip dsh-ir-chip--on', onClick: onSelectSafe },
                `${t('selectSafe')} ${safeCount}`,
              ),
              h(
                'button',
                { key: 'all', type: 'button', className: 'dsh-ir-chip', onClick: onSelectAll },
                `${t('selectAllWarn')} ${cleanableCount}`,
              ),
              h('button', { key: 'clear', type: 'button', className: 'dsh-ir-chip', onClick: onClear }, t('clearSel')),
              h(
                'button',
                { key: 'del', type: 'button', className: 'dsh-ir-btn dsh-ir-btn--danger', disabled: selectedCount === 0 || busy, onClick: onDelete },
                `${t('deleteSelected')} ${selectedCount} · ${selectedSize}`,
              ),
            ],
      )
    }

    /** 增长趋势：近 N 天按天柱状图 */
    function TrendBars({ trend, busy }) {
      return h(
        'div',
        { className: 'dsh-ir-trend' },
        h('div', { className: 'dsh-ir-trendHead' }, `${t('trendTitle')}${trend ? ` · 合计 ${formatSize(trend.totalBytes)}` : ''}`),
        busy && !trend ? h('div', { className: 'dsh-ir-eco' }, t('scanning')) : null,
        trend
          ? h(
              'div',
              { className: 'dsh-ir-bars' },
              trend.buckets.map((bucket, index) => {
                const height = trend.maxBytes > 0 ? Math.max(2, Math.round((bucket.bytes / trend.maxBytes) * 48)) : 2
                return h(
                  'div',
                  {
                    key: bucket.day,
                    className: 'dsh-ir-barCol',
                    title: `${bucket.day} · ${formatSize(bucket.bytes)} · ${bucket.files} 文件`,
                  },
                  h('div', { className: 'dsh-ir-barFillV', style: { height } }),
                  index % 2 === 0 ? h('span', { className: 'dsh-ir-barLabel' }, bucket.day.slice(5)) : null,
                )
              }),
            )
          : null,
        trend && trend.totalBytes === 0 ? h('div', { className: 'dsh-ir-eco' }, t('trendEmpty')) : null,
      )
    }

    /** 定时自动清理开关 */
    function AutoCleanRow({ autoClean, onChange }) {
      if (!autoClean) return null
      return h(
        'div',
        { className: 'dsh-ir-acrow' },
        h('span', null, t('autoCleanLabel')),
        h(
          'button',
          {
            type: 'button',
            className: `dsh-ir-chip${autoClean.enabled ? ' dsh-ir-chip--on' : ''}`,
            onClick: () => onChange({ enabled: !autoClean.enabled }),
          },
          autoClean.enabled ? `🟢 ${t('autoCleanOn')}` : `⚪ ${t('autoCleanOff')}`,
        ),
        h('span', { className: 'dsh-ir-eco' }, `${t('autoCleanHint')} ${autoClean.minAgeDays} ${t('autoCleanDays')}`),
        h(
          'select',
          {
            className: 'dsh-ir-select',
            value: autoClean.minAgeDays,
            onChange: (event) => onChange({ minAgeDays: Number(event.target.value) }),
          },
          [7, 14, 30].map((days) => h('option', { key: days, value: days }, `${days} 天`)),
        ),
      )
    }

    /** 复现线索：一条候选脚本 */
    function ReproRow({ row }) {
      const [open, setOpen] = useState(false)
      return h(
        'div',
        { className: 'dsh-ir-repro' },
        h(
          'div',
          { className: 'dsh-ir-reproHead', onClick: () => setOpen((v) => !v) },
          h('span', { className: `dsh-ir-caret${open ? ' dsh-ir-caret--open' : ''}` }, '▶'),
          h('code', { className: 'dsh-ir-path', title: row.path }, row.path),
          h('span', { className: 'dsh-ir-badge' }, `命令里 ${row.usedInCommands} 次`),
        ),
        h('div', { className: 'dsh-ir-eco' }, row.verdict),
        row.cdpLines && row.cdpLines[0] ? h('div', { className: 'dsh-ir-evidence' }, row.cdpLines[0]) : null,
        open && row.hook ? h('pre', { className: 'dsh-ir-hook' }, row.hook) : null,
        open && !row.hook ? h('div', { className: 'dsh-ir-eco' }, '（这个脚本自己会清理，不用加钩子）') : null,
      )
    }

    /** 历史侧写的会话行 */
    function HistoryRow({ row }) {
      const total = row.count || 1
      const level = row.high / total >= 0.5 ? 'high' : row.high > 0 ? 'medium' : 'low'
      const label = level === 'high' ? '高概率' : level === 'medium' ? '中等' : '低'
      return h(
        'div',
        { className: 'dsh-ir-histRow' },
        h('span', { className: `dsh-ir-prob dsh-ir-prob--${level}` }, `${row.count}× ${label}`),
        h(
          'div',
          null,
          h('div', { className: 'dsh-ir-name', title: row.sessionId }, row.title),
          row.samples && row.samples[0] ? h('div', { className: 'dsh-ir-evidence', style: { padding: '2px 0 0' } }, row.samples[0]) : null,
        ),
        h('div', { className: 'dsh-ir-size' }, formatSize(row.bytes)),
        h(
          'div',
          { className: 'dsh-ir-eco' },
          `高置信 ${row.high} / ${row.count} 次 · ${formatWhen(row.firstAt)} → ${formatWhen(row.lastAt)}`,
        ),
      )
    }

    /** 因果表：发起者 → 类别 → 次数 → 磁盘 */
    function CausalRow({ row }) {
      return h(
        'div',
        { className: 'dsh-ir-histRow' },
        h('span', { className: 'dsh-ir-prob dsh-ir-prob--low' }, `${row.count}×`),
        h(
          'div',
          null,
          h('div', { className: 'dsh-ir-name' }, row.launcher),
          row.parentCommand ? h('div', { className: 'dsh-ir-evidence', style: { padding: '2px 0 0' } }, row.parentCommand) : null,
        ),
        h('div', { className: 'dsh-ir-eco' }, row.label),
        row.disk && row.disk.length > 0
          ? h('div', { className: 'dsh-ir-purpose' }, row.disk.slice(0, 2).map((item) => `${item.size}  ${item.path}`).join('\n'))
          : h('div', { className: 'dsh-ir-eco' }, row.paths && row.paths[0] ? row.paths[0] : '（磁盘上暂未匹配到）'),
      )
    }

    function SessionBlock({ session, defaultOpen, rpc, index }) {
      const [open, setOpen] = useState(false)
      const alt = typeof index === 'number' && index % 2 === 1
      return h(
        'div',
        { className: `dsh-ir-session${alt ? ' dsh-ir-session--alt' : ''}` },
        h(
          'div',
          { className: 'dsh-ir-sessionHead', onClick: () => setOpen((v) => !v) },
          h('span', { className: `dsh-ir-caret${open ? ' dsh-ir-caret--open' : ''}` }, '▶'),
          h('span', { className: 'dsh-ir-sessionTitle', title: session.id }, session.title || session.id),
          h('span', { className: 'dsh-ir-badge' }, `${session.items.length} ${t('items')}`),
          h('span', { className: 'dsh-ir-badge' }, session.size),
        ),
        open ? h('div', { className: 'dsh-ir-cwd' }, session.cwd || '') : null,
        open ? session.items.map((item, index) => h(Item, { key: `${item.name}-${index}`, item, rpc, index })) : null,
      )
    }

    function Panel(props) {
      const rpc = props && props.rpc ? props.rpc : null
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [keyword, setKeyword] = useState('')
      const [tab, setTab] = useState('sessions')
      const [subTab, setSubTab] = useState('sessions')
      const [recent, setRecent] = useState(null)
      const [recentBusy, setRecentBusy] = useState(false)
      const [recentDays, setRecentDays] = useState(3)
      const [procs, setProcs] = useState(null)
      const [procsBusy, setProcsBusy] = useState(false)
      const [history, setHistory] = useState(null)
      const [historyBusy, setHistoryBusy] = useState(false)
      const [repro, setRepro] = useState(null)
      const [reproBusy, setReproBusy] = useState(false)
      const [pendingClean, setPendingClean] = useState('')
      const [cleanBusy, setCleanBusy] = useState(false)
      const [selected, setSelected] = useState([])
      const [batchPending, setBatchPending] = useState(false)
      const [trend, setTrend] = useState(null)
      const [trendBusy, setTrendBusy] = useState(false)
      const [autoClean, setAutoClean] = useState(null)
      const recentRef = useRef(null)
      useEffect(() => {
        recentRef.current = recent
      }, [recent])
      const abortRef = useRef(null)

      const load = useCallback(
        (endpoint) => {
          if (!rpc) return
          setBusy(true)
          setError('')
          try {
            if (abortRef.current) abortRef.current.abort()
            const controller = new AbortController()
            abortRef.current = controller
            callRpc(rpc, endpoint || 'report', {}, controller.signal)
              .then((value) => {
                setData(value)
                setBusy(false)
              })
              .catch((err) => {
                if (err && err.name === 'AbortError') return
                setError(err && err.message ? err.message : String(err))
                setBusy(false)
              })
          } catch (err) {
            setError(err && err.message ? err.message : String(err))
            setBusy(false)
          }
        },
        [rpc],
      )

      useEffect(() => {
        load('report')
        return () => {
          if (abortRef.current) abortRef.current.abort()
        }
      }, [load])

      const loadRecent = useCallback(
        (days) => {
          if (!rpc) return
          setRecentBusy(true)
          setError('')
          callRpc(rpc, 'recent', { days: days ?? recentDays })
            .then((value) => {
              setRecent(value)
              setRecentBusy(false)
            })
            .catch((err) => {
              setError(err && err.message ? err.message : String(err))
              setRecentBusy(false)
            })
        },
        [rpc, recentDays],
      )

      useEffect(() => {
        if (tab === 'recent' && !recent && !recentBusy) loadRecent(recentDays)
      }, [tab, recent, recentBusy, loadRecent, recentDays])

      const loadProcs = useCallback(() => {
        if (!rpc) return
        setProcsBusy(true)
        callRpc(rpc, 'procs', {})
          .then((value) => {
            setProcs(value)
            setProcsBusy(false)
          })
          .catch(() => setProcsBusy(false))
      }, [rpc])

      useEffect(() => {
        if (tab === 'recent' && !procs && !procsBusy) loadProcs()
      }, [tab, procs, procsBusy, loadProcs])

      const loadHistory = useCallback(() => {
        if (!rpc) return
        setHistoryBusy(true)
        callRpc(rpc, 'history', { windowMinutes: 20 })
          .then((value) => {
            setHistory(value)
            setHistoryBusy(false)
          })
          .catch(() => setHistoryBusy(false))
      }, [rpc])

      const loadTrend = useCallback(() => {
        if (!rpc) return
        setTrendBusy(true)
        callRpc(rpc, 'trend', { days: 14 })
          .then((value) => {
            setTrend(value)
            setTrendBusy(false)
          })
          .catch(() => setTrendBusy(false))
      }, [rpc])

      useEffect(() => {
        if (tab === 'recent' && !history && !historyBusy) loadHistory()
      }, [tab, history, historyBusy, loadHistory])

      useEffect(() => {
        if (tab === 'recent' && !trend && !trendBusy) loadTrend()
        if (data && data.autoClean && !autoClean) setAutoClean(data.autoClean)
      }, [tab, trend, trendBusy, loadTrend, data, autoClean])

      const saveAutoClean = useCallback(
        (patch) => {
          if (!rpc) return
          const next = { ...(autoClean || { enabled: false, minAgeDays: 7 }), ...patch }
          setAutoClean(next)
          callRpc(rpc, 'autoclean', next).catch(() => {})
        },
        [rpc, autoClean],
      )

      const loadRepro = useCallback(
        (sessionId) => {
          if (!rpc) return
          setReproBusy(true)
          callRpc(rpc, 'repro', { sessionId: sessionId || '' })
            .then((value) => {
              setRepro(value)
              setReproBusy(false)
            })
            .catch(() => setReproBusy(false))
        },
        [rpc],
      )

      /** 清理成功后**只把删掉的行从本地列表里摘掉**：不重新拉取、不动滚动位置 */
      const applyRemoved = useCallback((value) => {
        const result = filterCleaned(recentRef.current, value)
        if (!result.recent || result.removed.length === 0) return
        setRecent(result.recent)
        setSelected((prev) => prev.filter((path) => !result.removed.includes(path)))
      }, [])

      /** 一键清理：第一次只预览，第二次才真删 */
      const doClean = useCallback(
        (target, confirm) => {
          if (!rpc) return
          setCleanBusy(true)
          callRpc(rpc, 'clean', { paths: [target], confirm: confirm === true })
            .then((value) => {
              setCleanBusy(false)
              setPendingClean('')
              applyRemoved(value)
            })
            .catch((err) => {
              setCleanBusy(false)
              setError(err && err.message ? err.message : String(err))
            })
        },
        [rpc, applyRemoved],
      )

      const toggleSelected = useCallback((path) => {
        setSelected((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]))
      }, [])

      /** 批量删除：同样两段式，先出「N 项 / X GB」确认条 */
      const doCleanBatch = useCallback(
        (confirm) => {
          if (!rpc || selected.length === 0) return
          if (!confirm) {
            setBatchPending(true)
            return
          }
          setCleanBusy(true)
          callRpc(rpc, 'clean', { paths: selected.slice(0, 50), confirm: true })
            .then((value) => {
              setCleanBusy(false)
              setBatchPending(false)
              applyRemoved(value)
            })
            .catch((err) => {
              setCleanBusy(false)
              setError(err && err.message ? err.message : String(err))
            })
        },
        [rpc, selected, applyRemoved],
      )

      const sessions = useMemo(() => {
        if (!data || !Array.isArray(data.perSession)) return []
        const needle = keyword.trim().toLowerCase()
        if (!needle) return data.perSession
        return data.perSession
          .map((session) => {
            const items = session.items.filter(
              (item) =>
                String(item.name).toLowerCase().includes(needle) ||
                String(item.path).toLowerCase().includes(needle) ||
                String(item.purpose).toLowerCase().includes(needle) ||
                String(item.eco).toLowerCase().includes(needle),
            )
            return items.length > 0 ? { ...session, items } : null
          })
          .filter(Boolean)
      }, [data, keyword])

      const totals = data && data.totals ? data.totals : null

      // 所有条目（扁平），给「按类型 / 按时间」两栏用
      const allItems = useMemo(() => {
        if (!data || !Array.isArray(data.perSession)) return []
        return data.perSession.flatMap((session) =>
          session.items.map((item) => ({ ...item, sessionTitle: session.title || session.id })),
        )
      }, [data])

      const matchedItems = useMemo(() => {
        const needle = keyword.trim().toLowerCase()
        if (!needle) return allItems
        return allItems.filter(
          (item) =>
            String(item.name).toLowerCase().includes(needle) ||
            String(item.path).toLowerCase().includes(needle) ||
            String(item.purpose).toLowerCase().includes(needle) ||
            String(item.eco).toLowerCase().includes(needle),
        )
      }, [allItems, keyword])

      const groups = useMemo(() => {
        if (subTab === 'sessions') return []
        const buckets = new Map()
        for (const item of matchedItems) {
          const key =
            subTab === 'eco'
              ? item.eco || item.category || 'other'
              : item.birthtime
                ? new Date(item.birthtime).toISOString().slice(0, 7)
                : 'unknown'
          const bucket = buckets.get(key) || { key, title: key, items: [], bytes: 0 }
          bucket.items.push(item)
          bucket.bytes += Number(item.bytes) || 0
          buckets.set(key, bucket)
        }
        const list = [...buckets.values()]
        for (const bucket of list) {
          if (subTab === 'eco') bucket.title = ECO_LABELS[bucket.key] || bucket.key
          if (bucket.key === 'unknown') bucket.title = t('noTime')
          bucket.size = formatSize(bucket.bytes)
          bucket.items.sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
        }
        list.sort((a, b) => b.bytes - a.bytes)
        const max = list.length > 0 ? list[0].bytes || 1 : 1
        for (const bucket of list) bucket.share = bucket.bytes / max
        return list
      }, [matchedItems, subTab])

      // 顶层只有两类：会话装的 / 机器上不是会话装的
      const TABS = [
        { id: 'sessions', label: t('catSession') },
        { id: 'recent', label: t('catDevice') },
      ]
      const SUB_TABS = [
        { id: 'sessions', label: t('tabSessions') },
        { id: 'eco', label: t('tabEco') },
        { id: 'month', label: t('tabMonth') },
      ]

      // 多选：只有「可一键清理」的行能勾（>=50 MB 且不是 danger）
      const cleanableItems = ((recent && recent.items) || []).filter((item) => item.cleanable !== false)
      const safeItems = cleanableItems.filter((item) => item.risk === 'safe')
      const selectedSet = new Set(selected)
      const selectedBytes = cleanableItems
        .filter((item) => selectedSet.has(item.path))
        .reduce((sum, item) => sum + (item.bytes || 0), 0)

      return h(
        'div',
        { className: 'dsh-ir-panel' },
        h(
          'div',
          { className: 'dsh-ir-head' },
          h('h1', { className: 'dsh-ir-h1' }, t('title')),
          h('div', { className: 'dsh-ir-sub' }, t('subtitle')),
          h(
            'div',
            { className: 'dsh-ir-actions' },
            h(
              'button',
              { type: 'button', className: 'dsh-ir-btn dsh-ir-btn--primary', disabled: busy, onClick: () => load('report') },
              `⟳ ${t('refresh')}`,
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-ir-btn', disabled: busy, onClick: () => load('baseline') },
              t('baseline'),
            ),
            h('input', {
              className: 'dsh-ir-search',
              placeholder: t('search'),
              value: keyword,
              onChange: (event) => setKeyword(event.target.value),
            }),
          ),
        ),
        totals
          ? h(
              'div',
              { className: 'dsh-ir-stats' },
              h(Stat, { label: '含安装动作', value: `${totals.sessions} ${t('sessions')}` }),
              h(Stat, { label: '', value: `${totals.items} ${t('items')}` }),
              h(Stat, { label: t('total'), value: totals.size }),
              h(Stat, { label: t('baselineAt'), value: data.baselineTakenAt ? formatWhen(data.baselineTakenAt) : t('noBaseline') }),
              data.generatedAt ? h('span', { style: { marginLeft: 'auto' } }, formatWhen(data.generatedAt)) : null,
            )
          : null,
        busy && !data ? h('div', { className: 'dsh-ir-empty' }, `${t('scanning')} 首次扫描要遍历 Program Files 等目录，十几秒左右。`) : null,
        error ? h('div', { className: 'dsh-ir-empty' }, `${t('error')}: ${error}`) : null,
        h(
          'div',
          { className: 'dsh-ir-tabs' },
          TABS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                className: `dsh-ir-tab${tab === entry.id ? ' dsh-ir-tab--on' : ''}${entry.id === 'recent' ? ' dsh-ir-tab--device' : ' dsh-ir-tab--session'}`,
                onClick: () => setTab(entry.id),
              },
              entry.label,
            ),
          ),
        ),
        tab === 'sessions'
          ? h(
              'div',
              { className: 'dsh-ir-subtabs' },
              SUB_TABS.map((entry) =>
                h(
                  'button',
                  {
                    key: entry.id,
                    type: 'button',
                    className: `dsh-ir-subtab${subTab === entry.id ? ' dsh-ir-subtab--on' : ''}`,
                    onClick: () => setSubTab(entry.id),
                  },
                  entry.label,
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dsh-ir-body' },
          tab === 'sessions'
            ? subTab === 'sessions'
              ? [
                  sessions.length === 0 && data ? h('div', { key: 'empty', className: 'dsh-ir-empty' }, t('empty')) : null,
                  sessions.map((session, index) => h(SessionBlock, { key: session.id, session, rpc, index })),
                ]
              : [
                  groups.length === 0 && data ? h('div', { key: 'empty', className: 'dsh-ir-empty' }, t('empty')) : null,
                  groups.map((group) => h(ItemGroup, { key: group.key, group, rpc })),
                ]
            : [
                recentBusy && !recent ? h('div', { key: 'busy', className: 'dsh-ir-empty' }, t('scanning')) : null,
                h(TrendBars, { key: 'trend', trend, busy: trendBusy }),
                h(AutoCleanRow, { key: 'autoclean', autoClean, onChange: saveAutoClean }),
                h(
                  'div',
                  { key: 'days', className: 'dsh-ir-days' },
                  [1, 3, 7].map((days) =>
                    h(
                      'button',
                      {
                        key: days,
                        type: 'button',
                        className: `dsh-ir-subtab${recentDays === days ? ' dsh-ir-subtab--on' : ''}`,
                        disabled: recentBusy,
                        onClick: () => {
                          setRecentDays(days)
                          loadRecent(days)
                        },
                      },
                      days === 1 ? '今天' : `近 ${days} 天`,
                    ),
                  ),
                ),
                recent
                  ? h('div', { key: 'head', className: 'dsh-ir-recentHead' }, `${t('recentHead')} · 起点 ${recent.sinceLabel} · 合计 ${formatSize(recent.totalBytes ?? 0)}`)
                  : null,
                recent && recent.items.length === 0 ? h('div', { key: 'empty2', className: 'dsh-ir-empty' }, t('recentEmpty')) : null,
                recent && recent.items.length > 0
                  ? h(SelBar, {
                      key: 'selbar',
                      cleanableCount: cleanableItems.length,
                      totalCount: recent.items.length,
                      safeCount: safeItems.length,
                      selectedCount: selected.length,
                      selectedSize: formatSize(selectedBytes),
                      busy: cleanBusy,
                      pending: batchPending,
                      onSelectSafe: () => setSelected(safeItems.map((item) => item.path)),
                      onSelectAll: () => setSelected(cleanableItems.map((item) => item.path)),
                      onClear: () => setSelected([]),
                      onDelete: () => doCleanBatch(false),
                      onConfirm: () => doCleanBatch(true),
                      onCancel: () => setBatchPending(false),
                    })
                  : null,
                recent
                  ? recent.items.map((item, index) =>
                      h(RecentRow, {
                        key: `${item.path}-${index}`,
                        item,
                        rpc,
                        pending: pendingClean === item.path,
                        cleanBusy,
                        selected: selectedSet.has(item.path),
                        onToggle: toggleSelected,
                        onAsk: () => setPendingClean(item.path),
                        onCancel: () => setPendingClean(''),
                        onConfirm: () => doClean(item.path, true),
                      }),
                    )
                  : null,
                h('div', { key: 'procSect', className: 'dsh-ir-sect dsh-ir-sect--device' }, t('procSect')),
                procsBusy && !procs ? h('div', { key: 'procBusy', className: 'dsh-ir-empty' }, t('scanning')) : null,
                procs && procs.causal && procs.causal.length === 0
                  ? h('div', { key: 'procEmpty', className: 'dsh-ir-recentHead' }, `${t('procNone')}（日志：${procs.logPath}）`)
                  : null,
                procs && procs.causal
                  ? procs.causal.map((row, index) => h(CausalRow, { key: `${row.launcher}-${row.category}-${index}`, row }))
                  : null,
                h('div', { key: 'histSect', className: 'dsh-ir-sect dsh-ir-sect--device' }, t('historySect')),
                historyBusy && !history ? h('div', { key: 'histBusy', className: 'dsh-ir-empty' }, t('scanning')) : null,
                history && history.sessions && history.sessions.length === 0
                  ? h('div', { key: 'histEmpty', className: 'dsh-ir-recentHead' }, t('historyNone'))
                  : null,
                history && history.sessions
                  ? h(
                      'div',
                      { key: 'histHead', className: 'dsh-ir-recentHead' },
                      `${history.total} 个遗留目录 · ${formatSize(history.totalBytes)} · ${t('historySummary')} ${history.sessions.reduce((sum, row) => sum + row.count, 0)} 个 · ${t('unmatched')} ${history.unmatched.count} 个`,
                    )
                  : null,
                history && history.sessions
                  ? history.sessions.slice(0, 8).map((row, index) => h(HistoryRow, { key: `${row.sessionId}-${index}`, row }))
                  : null,
                history && history.sessions && history.sessions.length > 0
                  ? h(
                      'div',
                      { key: 'reproBtn', style: { padding: '6px 12px 2px' } },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-ir-chip',
                          disabled: reproBusy,
                          onClick: () => loadRepro(history.sessions[0].sessionId),
                          title: history.sessions[0].title,
                        },
                        reproBusy ? t('reproBusy') : `${t('reproBtn')}：${history.sessions[0].title}`,
                      ),
                    )
                  : null,
                repro && repro.candidates
                  ? [
                      h(
                        'div',
                        { key: 'reproHead', className: 'dsh-ir-recentHead' },
                        `${repro.commands} 条命令 · ${repro.candidates.length} 个候选脚本 · cwd ${repro.cwd || '未知'}${
                          repro.pickedBy === 'commands' ? ' · 遗留目录已清空，按「浏览器命令最多的一轮」挑' : ''
                        }`,
                      ),
                      repro.candidates.map((row, index) => h(ReproRow, { key: `${row.path}-${index}`, row })),
                    ]
                  : null,
                repro && repro.candidates && repro.candidates.length === 0
                  ? h('div', { key: 'reproNone', className: 'dsh-ir-recentHead' }, repro.note || t('reproNone'))
                  : null,
                repro && repro.inline
                  ? h(
                      'div',
                      { key: 'inline', className: 'dsh-ir-repro' },
                      h('div', { className: 'dsh-ir-name' }, '内联驱动（命令里直接拉起浏览器）'),
                      h('div', { className: 'dsh-ir-eco' }, repro.inline.verdict),
                      h('pre', { className: 'dsh-ir-hook' }, repro.inline.hook),
                    )
                  : null,
                data && Array.isArray(data.unattributed) && data.unattributed.length > 0
                  ? h(
                      'div',
                      { key: 'unattributed' },
                      h('div', { className: 'dsh-ir-sect dsh-ir-sect--device' }, t('unattributed')),
                      h(SessionBlock, {
                        session: {
                          id: 'unattributed',
                          title: t('unattributed'),
                          cwd: '',
                          size: '',
                          items: data.unattributed.map((entry) => ({
                            name: entry.name,
                            eco: entry.root || '',
                            size: entry.size,
                            path: entry.path,
                            purpose: entry.purpose,
                            birthtime: entry.birthtime,
                            confidence: 'low',
                            uninstall: entry.uninstall || '',
                          })),
                        },
                        rpc,
                        index: 0,
                      }),
                    )
                  : null,
              ],
        ),
      )
    }
    exports.PANEL_ID = PANEL_ID
    exports.inject = ['slots', 'connection', 'locale']
    // 给 test/client-smoke.mjs 用：不进 UI，只用来构造元素树做回归
    exports.__internals = {
      Panel,
      SessionBlock,
      Item,
      ItemGroup,
      RecentRow,
      HistoryRow,
      ReproRow,
      TrendBars,
      AutoCleanRow,
      SelBar,
      filterCleaned,
      CausalRow,
      RiskNote,
      RadarGlyph,
      CopyChip,
      formatWhen,
      formatSize,
    }

    exports.apply = function apply(ctx) {
      injectCSS()
      const rpc = ctx.get('connection').rpc

      // 侧栏图标行：order 负数 → 排在官方面板行之前，也就是「工作区」上方
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: -20,
            label: STRINGS.zh.panel,
            inject: () => ({ rpc }),
          },
          RadarGlyph,
        ),
      )

      // 主面板：同一个 id 作为 keyed 槽的 key
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ rpc }),
          },
          Panel,
        ),
      )

      // 面板标题本地化：宿主按当前语言渲染面板名字
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        try {
          ctx.locale.register(NS, { zh: { panel: STRINGS.zh.panel }, en: { panel: STRINGS.en.panel } })
        } catch {
          /* 语言包注册失败不影响面板本身 */
        }
      }
      localeIsEnglish = false
    }

    return module.exports
  },
})
