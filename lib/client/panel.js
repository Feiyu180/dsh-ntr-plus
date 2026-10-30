import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * React surface for ACP: the settings configuration section.
 *
 * Scope is deliberately narrow — this is a CONFIGURATION surface. Runtime
 * interaction lives in the conversation: permission asks are answered in the
 * chat composer through the host approval chain. The ledger card answers
 * whatever did NOT reach the conversation — a host without the chain, a
 * session with no chat identity behind it, or an ask whose native route
 * degraded to unavailable (see `permissionLedgerCard`).
 *
 * Each configured agent is one compact row (status + current model + badges)
 * that expands into the full connection form and model catalog. The row stays
 * mounted and the body toggles `display`, so editing a form and collapsing it
 * never loses the in-progress values.
 * All business state lives in the injected AcpStore.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatCommandLine, isAbsolutePathLike, splitCommandLine } from "./acp-ui.js";
import { DEFAULT_KNOWN_PRESETS } from "./store.js";
/**
 * Mirrors `AGENT_ID_PATTERN` in impl.ts — the client cannot import host-side
 * modules, so this copy must stay in sync (same deal as the preset copies,
 * constraint 7).
 */
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Preset ids (drives the「自定义」badge); mirrors AGENT_PRESETS via store copies. */
const PRESET_IDS = new Set(DEFAULT_KNOWN_PRESETS.map(preset => preset.id));
/** Seed for the from-scratch creation card: no preset, no tested default. */
const NEW_AGENT_SEED = {
    id: '',
    name: '',
    detected: false,
    defaultCommand: '',
    defaultArgs: [],
};
/** How long a chip edit is coalesced before the lightweight exposure RPC fires. */
const EXPOSURE_SAVE_DEBOUNCE_MS = 400;
const STYLE = `
.dwa-root {
  --ntr-gap-1: 4px; --ntr-gap-2: 8px; --ntr-gap-3: 12px; --ntr-gap-4: 16px;
  --ntr-radius: 10px; --ntr-radius-sm: 7px;
  --ntr-font: 13px; --ntr-font-sm: 12px; --ntr-font-xs: 11px;
  --ntr-line: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
  --ntr-muted: var(--dsw-alias-text-secondary, #6b7280);
  --ntr-danger: #dc2626; --ntr-warn: #b45309;
  --ntr-accent: var(--dsw-alias-button-primary-fill, #2563eb);
  width: 100%; max-width: 960px; box-sizing: border-box; margin: 0 auto;
  padding: 20px; overflow: auto; font-size: var(--ntr-font); line-height: 1.55;
}
.dwa-root button, .dwa-root input, .dwa-root select { font-family: inherit; }
.dwa-root button:focus-visible, .dwa-root input:focus-visible, .dwa-root select:focus-visible {
  outline: 2px solid var(--ntr-accent); outline-offset: 2px;
}
.dwa-page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.dwa-page-heading { min-width: 0; }
.dwa-page-title { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 650; letter-spacing: -0.02em; }
.dwa-page-description { margin: 5px 0 0; color: var(--ntr-muted); font-size: var(--ntr-font-sm); }
.dwa-page-status { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-page-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dwa-btn {
  min-height: 32px; box-sizing: border-box; font: inherit; border-radius: var(--ntr-radius-sm);
  border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-1, #fff);
  padding: 5px 12px; cursor: pointer; color: inherit; font-size: var(--ntr-font-sm);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  white-space: nowrap; transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.dwa-btn:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); border-color: var(--dsw-alias-border-l1, #9ca3af); }
.dwa-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dwa-btn-primary { background: var(--ntr-accent); color: var(--dsw-alias-button-primary-invert, #fff); border-color: transparent; font-weight: 550; }
.dwa-btn-primary:hover { background: var(--ntr-accent); border-color: transparent; opacity: 0.88; }
.dwa-btn-secondary { background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.dwa-btn-danger { color: var(--ntr-danger); border-color: #fca5a5; }
.dwa-btn-danger:hover { background: #fee2e2; }
.dwa-section { margin-bottom: 24px; }
.dwa-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.dwa-section-title { font-size: 14px; font-weight: 650; margin: 0; display: flex; align-items: center; gap: 8px; }
.dwa-section-copy { margin: 3px 0 0; font-size: var(--ntr-font-xs); color: var(--ntr-muted); }
.dwa-card { border: var(--ntr-line); border-radius: var(--ntr-radius); padding: 16px; background: var(--dsw-alias-bg-layer-1, #fff); font-size: var(--ntr-font); line-height: 1.55; }
.dwa-card-warn { border-left: 3px solid var(--dsw-alias-state-warn-primary, #d97706); background: var(--dsw-alias-state-warn-secondary, #fffbeb); }
.dwa-mode-banner { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 16px; align-items: start; margin-bottom: 24px; padding: 14px 16px; }
.dwa-mode-title { display: flex; align-items: center; gap: 8px; font-weight: 650; }
.dwa-mode-copy { grid-column: 1 / -1; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-mode-source { display: block; margin-top: 5px; overflow-wrap: anywhere; opacity: 0.85; }
.dwa-badge { font-size: var(--ntr-font-xs); line-height: 1.4; border-radius: 999px; padding: 2px 8px; background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: var(--ntr-muted); font-weight: 550; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dwa-badge-success { background: #22c55e1c; color: #15803d; }
.dwa-badge-warn { background: #f59e0b1f; color: #b45309; }
.dwa-badge-info { background: #3b82f61a; color: #2563eb; }
.dwa-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dwa-agent-list { display: flex; flex-direction: column; gap: 8px; }
.dwa-agent-card { border: var(--ntr-line); border-radius: var(--ntr-radius); background: var(--dsw-alias-bg-layer-1, #fff); overflow: visible; transition: border-color 0.15s ease; }
.dwa-agent-card.is-open { border-color: var(--dsw-alias-border-l1, #c7ccd1); }
.dwa-agent-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px 14px; }
.dwa-caret { font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; width: 1em; }
.dwa-caret-btn { font: inherit; border: none; background: var(--dsw-alias-bg-layer-2, #f3f4f6); width: 28px; height: 28px; padding: 0; border-radius: var(--ntr-radius-sm); display: inline-flex; align-items: center; justify-content: center; color: var(--ntr-muted); cursor: pointer; }
.dwa-caret-btn:hover { background: var(--dsw-alias-interactive-bg-active, #e5e7eb); color: inherit; }
.dwa-agent-summary { min-width: 0; }
.dwa-agent-titleline { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dwa-agent-name { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.dwa-agent-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-agent-meta-separator { opacity: 0.45; }
.dwa-agent-body { border-top: var(--ntr-line); padding: 0 16px 16px; }
.dwa-subsection { padding-top: 16px; }
.dwa-subsection + .dwa-subsection { margin-top: 16px; border-top: var(--ntr-line); }
.dwa-subsection-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dwa-subsection-title { margin: 0; font-size: 13px; font-weight: 650; }
.dwa-subsection-copy { margin: 3px 0 0; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-form-row { display: flex; gap: var(--ntr-gap-3); margin-bottom: 14px; align-items: flex-start; }
.dwa-form-col { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dwa-form-label { font-size: var(--ntr-font-sm); font-weight: 600; color: var(--dsw-alias-text-primary, #374151); }
.dwa-hint { font-size: var(--ntr-font-xs); line-height: 1.55; color: var(--ntr-muted); }
.dwa-error { font-size: var(--ntr-font-xs); color: var(--ntr-danger); }
.dwa-input { min-height: 36px; font: inherit; font-size: var(--ntr-font-sm); padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; width: 100%; box-sizing: border-box; }
.dwa-select { min-height: 32px; font: inherit; font-size: var(--ntr-font-sm); padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; }
.dwa-input:hover, .dwa-select:hover { border-color: var(--dsw-alias-border-l1, #9ca3af); }
.dwa-input:focus, .dwa-select:focus { border-color: var(--ntr-accent); }
.dwa-input-mono, .dwa-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.dwa-stderr { max-height: 120px; overflow: auto; font-family: monospace; font-size: var(--ntr-font-xs); white-space: pre-wrap; color: var(--ntr-warn); margin: 12px 0 0; }
.dwa-default-hint { background: var(--dsw-alias-bg-layer-2, #f9fafb); border: var(--ntr-line); border-radius: var(--ntr-radius-sm); padding: 10px 12px; font-size: var(--ntr-font-sm); display: flex; align-items: center; justify-content: space-between; margin: 12px 0 14px; gap: 12px; }
.dwa-form-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: var(--ntr-line); flex-wrap: wrap; }
.dwa-form-actions .dwa-btn-primary { min-width: 88px; }
.dwa-menu-wrap { position: relative; }
.dwa-menu-wrap > .dwa-btn { width: 32px; padding: 0; }
.dwa-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 190px; border: var(--ntr-line); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 4px; display: flex; flex-direction: column; }
.dwa-menu-item { font: inherit; font-size: var(--ntr-font-sm); text-align: left; border: none; background: none; padding: 7px 10px; border-radius: 5px; cursor: pointer; color: inherit; }
.dwa-menu-item:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-menu-item-danger { color: var(--ntr-danger); }
.dwa-menu-confirm { display: flex; align-items: center; gap: 4px; padding: 4px; }
.dwa-add-panel { border: var(--ntr-line); border-radius: var(--ntr-radius); background: var(--dsw-alias-bg-layer-1, #fff); }
.dwa-add-toggle { width: 100%; border: 0; background: transparent; color: inherit; padding: 13px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; cursor: pointer; border-radius: var(--ntr-radius); }
.dwa-add-toggle:hover { background: var(--dsw-alias-interactive-bg-active, #f9fafb); }
.dwa-add-content { border-top: var(--ntr-line); padding: 14px 16px 16px; }
.dwa-chip { min-height: 30px; font: inherit; font-size: var(--ntr-font-sm); border: var(--ntr-line); border-radius: 999px; padding: 4px 12px; background: var(--dsw-alias-bg-layer-1, #fff); cursor: pointer; color: inherit; }
.dwa-chip:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-chip-active { border-color: var(--ntr-accent); background: #3b82f614; color: #2563eb; font-weight: 550; }
.dwa-chip-list { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 0 0 12px; }
.dwa-switch { display: inline-flex; align-items: center; gap: 7px; font-size: var(--ntr-font-sm); cursor: pointer; user-select: none; }
.dwa-inline-setting { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-2, #f9fafb); }
.dwa-inline-setting .dwa-switch { flex-shrink: 0; margin-top: 1px; }
.dwa-setting-copy { color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
/* Stacked, not side by side: the rows carry name, id and credit, and a
   half-width pane truncated them at every realistic settings width. Each list
   gets the whole column instead. */
.dwa-model-transfer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
/* Tall enough for a comfortable selection (about ten rows) before scrolling;
   the cap keeps the two stacked panes from pushing the rest of the card away. */
.dwa-model-pane { min-width: 0; max-height: 360px; display: flex; flex-direction: column; border: var(--ntr-line); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.dwa-model-pane-head { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-bottom: var(--ntr-line); font-size: var(--ntr-font-xs); font-weight: 600; color: var(--dsw-alias-text-secondary, #4b5563); }
.dwa-model-pane-head .dwa-btn { margin-left: auto; min-height: 26px; padding: 2px 8px; font-size: var(--ntr-font-xs); }
.dwa-model-pane-head .dwa-caret-btn { flex: none; width: 22px; height: 22px; background: transparent; }
.dwa-model-pane-head .dwa-caret-btn:hover { background: var(--dsw-alias-interactive-bg-active, #e5e7eb); }
.dwa-model-pane.is-collapsed .dwa-model-list { display: none; }
.dwa-model-list { display: flex; flex-direction: column; gap: 2px; padding: 5px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dwa-model-section { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.dwa-model-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* The actions group keeps 「检测可用模型」 and the filter together and wraps as
   one unit; the status line takes the leftover space on the first row, so a
   narrow panel puts [detect][search] on its own row starting under the label
   instead of floating them to the right edge. */
.dwa-model-toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dwa-model-status { margin-left: auto; white-space: nowrap; }
.dwa-model-search { width: 200px; min-height: 30px; }
.dwa-model-empty { padding: 6px; }
.dwa-model-row { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: none; padding: 5px 6px; border-radius: 5px; cursor: pointer; color: inherit; font: inherit; font-size: var(--ntr-font-sm); text-align: left; }
.dwa-model-row:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-model-row.is-on { background: #3b82f614; color: #2563eb; }
.dwa-model-row-mark { width: 12px; flex: none; text-align: center; opacity: 0.75; }
.dwa-model-row-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Name and credit keep their room; the id is the only cell that collapses. */
.dwa-model-row-desc { flex: 0 0 auto; max-width: 45%; opacity: 0.75; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The trailing 14px is reserved for the fade mask: while the id fits, the
   gradient only covers empty padding; once it overflows, its tail dissolves
   instead of ending in a hard ellipsis. armModelIdMarquee reads the same
   padding to scroll the full text under the pointer. */
.dwa-model-row-value { flex: 0 1 auto; flex-shrink: 1000; box-sizing: border-box; min-width: 0; max-width: 45%; padding-right: 14px; opacity: 0.55; font-size: 10px; overflow: hidden; white-space: nowrap; mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent); -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent); }
.dwa-model-row-value-text { display: inline-block; white-space: nowrap; }
.dwa-model-row:hover .dwa-model-row-value-text { animation: dwa-model-id-marquee var(--dwa-id-duration, 1.4s) ease-in-out 0.2s infinite alternate; }
@keyframes dwa-model-id-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(var(--dwa-id-shift, 0px)); }
}
.dwa-model-row-remove { flex: none; opacity: 0.5; padding: 0 2px; }
.dwa-model-row:hover .dwa-model-row-remove { opacity: 1; }
.dwa-seg { display: inline-flex; border-radius: var(--ntr-radius-sm); border: 1px solid var(--dsw-alias-border-l2, #d1d5db); overflow: hidden; vertical-align: middle; }
.dwa-seg > button { min-height: 30px; font: inherit; font-size: var(--ntr-font-sm); color: inherit; border: none; background: var(--dsw-alias-bg-layer-1, #fff); padding: 4px 14px; cursor: pointer; }
.dwa-seg > button + button { border-left: 1px solid var(--dsw-alias-border-l2, #d1d5db); }
.dwa-seg > button:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-seg > button.is-on { background: var(--ntr-accent); color: var(--dsw-alias-button-primary-invert, #fff); font-weight: 550; }
.dwa-preference-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; }
.dwa-preference-row + .dwa-preference-row { border-top: var(--ntr-line); }
.dwa-preference-label { font-size: var(--ntr-font-sm); font-weight: 600; }
.dwa-preference-copy { margin-top: 2px; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-deadline-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dwa-deadline-input { width: 76px; min-height: 30px; padding: 4px 8px; text-align: right; }
.dwa-deadline-input[aria-invalid="true"] { border-color: var(--ntr-danger); }
.dwa-deadline-unit { white-space: nowrap; }
@media (max-width: 640px) {
  .dwa-root { padding: 14px; }
  .dwa-page-header { flex-direction: column; }
  .dwa-page-actions { width: 100%; }
  .dwa-page-actions .dwa-btn { width: 100%; }
  .dwa-model-toolbar-actions { width: 100%; }
  .dwa-model-search { flex: 1 1 auto; width: auto; }
  .dwa-subsection-head, .dwa-preference-row { align-items: flex-start; flex-direction: column; }
  .dwa-default-hint { align-items: flex-start; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .dwa-root *, .dwa-root *::before, .dwa-root *::after { transition: none !important; }
  .dwa-model-row:hover .dwa-model-row-value-text { animation: none !important; }
}
`;
let styleMounted = false;
function ensureStyle() {
    if (styleMounted || typeof document === 'undefined')
        return;
    styleMounted = true;
    const node = document.createElement('style');
    node.textContent = STYLE;
    document.head.appendChild(node);
}
function useUi(acp) {
    return useSyncExternalStore(cb => acp.subscribe(cb), () => acp.getSnapshot());
}
function stateVisual(state, acp) {
    switch (state) {
        case 'ready': return { color: '#22c55e', text: acp.label('已连接', 'Connected') };
        case 'starting': return { color: '#eab308', text: acp.label('启动中', 'Starting') };
        case 'error': return { color: '#ef4444', text: acp.label('错误', 'Error') };
        // A configured-but-resting agent is the normal state, not a fault: the
        // process is not kept resident and connects on demand the first time a DSH
        // chat turn uses it. Surfacing a runtime lifecycle here ("stopped"/"idle")
        // read as broken; the user's real question at a glance is "is it set up?",
        // which the config-time 测试连接 (agent/test) already answers. So the
        // resting state just says 已配置.
        default: return {
            color: '#9ca3af',
            text: acp.label('已配置', 'Configured'),
            title: acp.label('已配置，进程不常驻。在 DSH 聊天中首次使用时自动连接；展开区可用「测试连接」验证命令能否正常起来。', 'Configured; the process is not kept resident. It connects automatically the first time a DSH chat turn uses it — use “Test connection” in the expanded panel to verify the command starts.'),
        };
    }
}
/** Bilingual label for the event-stream state shown in the toolbar. */
function streamText(stream, acp) {
    if (stream === 'live')
        return acp.label('事件流已连接', 'Event stream live');
    if (stream === 'down')
        return acp.label('事件流已断开', 'Event stream down');
    return acp.label('事件流连接中', 'Event stream connecting');
}
/**
 * Canonical comparable form of an exposure filter. Unset and empty mean the
 * same thing host-side (no `agentId@choice` variants), so they share a key —
 * treating them as different would leave a row permanently dirty.
 */
function exposureKey(exposed) {
    return exposed === undefined || exposed.length === 0 ? 'none' : `set:${exposed.join('\u0000')}`;
}
function sameStringArray(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
function sameStringMap(a, b) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length)
        return false;
    return keys.every(key => a[key] === b[key]);
}
/**
 * Canonical comparable form of the MCP server list. Unset and empty mean the
 * same thing host-side (no extra MCP servers), so they share a key — treating
 * them as different would leave a card permanently dirty.
 *
 * The list is compared by CANONICAL JSON (object keys sorted, the servers
 * themselves sorted by name): reformatting the text — reordering keys,
 * re-indenting, listing the servers in another order — is not a change. The
 * ARGV array inside a server keeps its order, because there it is the command
 * line. The browser half needs no copy of the host's per-server validation: a
 * list the host would reject simply never matches, and the host's own error is
 * what the user sees.
 */
function mcpKey(servers) {
    if (servers === undefined || servers.length === 0)
        return 'none';
    const canonical = servers
        .map(canonicalJson)
        .sort((a, b) => {
        const nameA = String(a.name ?? '');
        const nameB = String(b.name ?? '');
        return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });
    return JSON.stringify(canonical);
}
/** One value in canonical JSON form: object keys sorted, arrays kept in order. */
function canonicalJson(value) {
    if (Array.isArray(value))
        return value.map(canonicalJson);
    if (value === null || typeof value !== 'object')
        return value;
    const entries = Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalJson(entry)]);
    return Object.fromEntries(entries);
}
/**
 * The MCP server list as the form holds it: the raw JSON text the user typed.
 *
 * Parsing happens on the way OUT (`buildPayload`), never on the way in, so a
 * half-typed value never throws inside a render. An unparseable text yields
 * `undefined`, which the form reports as invalid (`mcpInvalid`) and refuses to
 * save — better than sending a truncated list.
 */
function parseMcpServers(text) {
    const trimmed = text.trim();
    if (trimmed === '')
        return undefined;
    try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed))
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
/** Whether the MCP server text parses as a list at all (the host validates the rest). */
function mcpTextValid(text) {
    const trimmed = text.trim();
    if (trimmed === '')
        return true;
    try {
        return Array.isArray(JSON.parse(trimmed));
    }
    catch {
        return false;
    }
}
/**
 * Detected presets split by configured-ness, plus configured agents missing
 * from detection (custom / legacy persisted defs) synthesized into card
 * entries so they stay manageable.
 */
function partitionAgents(detectedAgents, agents) {
    const configured = [];
    const available = [];
    const agentIds = new Set(agents.map(a => a.id));
    const detectedIds = new Set(detectedAgents.map(d => d.id));
    for (const info of detectedAgents) {
        if (agentIds.has(info.id) || info.currentConfig !== undefined)
            configured.push({ info, synthesized: false });
        else
            available.push(info);
    }
    for (const agent of agents) {
        if (!detectedIds.has(agent.id)) {
            configured.push({
                info: {
                    id: agent.id,
                    name: agent.title,
                    detected: false,
                    defaultCommand: agent.command,
                    defaultArgs: [...agent.args],
                },
                synthesized: true,
            });
        }
    }
    return { configured, available };
}
/**
 * The persisted definition a save would replace. `currentConfig` is the full
 * def (env / npmPackage / exposedModels included); the synthesized fallback
 * covers only the fields an `AgentView` carries, so anything else compares as
 * "changed" — the honest answer when the host never reported it.
 */
/**
 * The idle-release window in effect for an agent: an unset per-agent field is
 * resolved by the HOST and reported back on `AgentView`, so filling it from
 * there keeps "unset" and "explicitly the host default" the same state —
 * merely opening the form must never read as an unsaved change.
 */
function resolvedIdleTimeoutMs(def, activeAgent) {
    if (def.idleTimeoutMs !== undefined || activeAgent?.idleTimeoutMs === undefined)
        return def;
    return { ...def, idleTimeoutMs: activeAgent.idleTimeoutMs };
}
function persistedDef(detected, activeAgent) {
    if (detected.currentConfig !== undefined)
        return resolvedIdleTimeoutMs(detected.currentConfig, activeAgent);
    if (activeAgent === undefined)
        return undefined;
    return {
        id: activeAgent.id,
        title: activeAgent.title,
        command: activeAgent.command,
        args: [...activeAgent.args],
        ...(activeAgent.cwd === undefined ? {} : { cwd: activeAgent.cwd }),
        allowedCwdRoots: [...activeAgent.allowedCwdRoots],
        env: {},
        ...(activeAgent.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: activeAgent.idleTimeoutMs }),
    };
}
/**
 * Equivalence test between the form payload and what is already persisted.
 * Order-insensitive on purpose: `env` is a map and `args`/`allowedCwdRoots`
 * keep their order, but a reordered allow-list is not a change worth warning
 * about; `exposedModels === undefined` means "offer no variants", which is the
 * same state as an empty list.
 */
export function payloadEquals(payload, current) {
    if (payload.command !== current.command)
        return false;
    if ((payload.title ?? payload.id) !== (current.title ?? current.id))
        return false;
    if (!sameStringArray(payload.args ?? [], current.args ?? []))
        return false;
    if ((payload.npmPackage ?? '') !== (current.npmPackage ?? ''))
        return false;
    if ((payload.cwd ?? '') !== (current.cwd ?? ''))
        return false;
    if (!sameStringArray(payload.allowedCwdRoots ?? [], current.allowedCwdRoots ?? []))
        return false;
    if (!sameStringMap(payload.env ?? {}, current.env ?? {}))
        return false;
    if (exposureKey(payload.exposedModels) !== exposureKey(current.exposedModels))
        return false;
    if (mcpKey(payload.mcpServers) !== mcpKey(current.mcpServers))
        return false;
    if ((payload.autoDiscoverModels !== false) !== (current.autoDiscoverModels !== false))
        return false;
    // An absent field means "use the host default" — which is what `current`
    // already resolved to (see `resolvedIdleTimeoutMs`), so it is not a change.
    if (payload.idleTimeoutMs !== undefined && payload.idleTimeoutMs !== current.idleTimeoutMs)
        return false;
    return true;
}
/**
 * The settings panel's permission-ledger rule.
 *
 * A pending ask ALWAYS gets an answerable card here, whatever `approvalRouted`
 * says. That flag reports that the host HAS an approval service — it does not
 * promise THIS ask reached the conversation. An ask lands in `ui.permissions`
 * only on the ledger path (`AgentBridge.handlePermissionRequest` broadcasts
 * `permission/request` there and nowhere else), so a pending entry is by
 * definition a question the conversation is not showing. The previous rule
 * (`approvalRouted` → a read-only count, no buttons) hid the only answer
 * entry exactly when the native route had degraded to unavailable, and the
 * ask then hung until its timeout.
 *
 * `fellBackFromConversation` is the case the card has to explain: the host
 * can route asks, and this one still did not make it.
 */
export function permissionLedgerCard(ui) {
    const visible = ui.permissions.length > 0;
    return { visible, fellBackFromConversation: visible && ui.approvalRouted };
}
/**
 * One-click windows for an approval deadline, in ms. `0` is spelled out rather
 * than hidden behind a big number because "never" is the value a cautious user
 * picks first, and a preset row that cannot express it would make them type.
 */
const DEADLINE_PRESETS = [0, 30_000, 60_000, 300_000, 900_000];
/** Both editable windows, for the loops that treat them alike. */
const DEADLINE_FIELDS = ['nativeApprovalTimeoutMs', 'permissionFallbackTimeoutMs'];
/** `5 分钟` / `30 秒` / `关` — the readout and the preset label, one formatter. */
function deadlineText(ms, acp) {
    if (ms <= 0)
        return acp.label('关', 'Off');
    const seconds = Math.round(ms / 1000);
    if (seconds < 60)
        return acp.label(`${String(seconds)} 秒`, `${String(seconds)}s`);
    const minutes = Math.round(seconds / 60);
    return acp.label(`${String(minutes)} 分`, `${String(minutes)}m`);
}
/**
 * One editable deadline: presets for the windows people actually pick, plus a
 * free-form seconds field for everything else.
 *
 * The field is a DRAFT, not the value: it only commits a parseable whole number
 * of seconds (0 allowed), and an unparseable draft reverts on blur instead of
 * writing garbage the host would refuse. The host answer is what the row then
 * shows, so a value the host trims never lingers in the UI.
 */
function DeadlineRow(props) {
    const { acp, field, label, copy, value } = props;
    const [draft, setDraft] = useState(undefined);
    const text = draft ?? String(Math.round(value / 1000));
    const parsed = /^\d+$/.test(text.trim()) ? Number(text.trim()) * 1000 : undefined;
    const commit = () => {
        const next = parsed;
        setDraft(undefined);
        // A no-op write is still a write: it is what pins the value into the
        // persisted override, which is what makes it survive a restart.
        if (next !== undefined && next !== value)
            void acp.setApprovalDeadline(field, next);
    };
    return (_jsxs("div", { className: "dwa-preference-row", children: [_jsxs("div", { children: [_jsx("div", { className: "dwa-preference-label", children: label }), _jsx("div", { className: "dwa-preference-copy", children: copy })] }), _jsxs("div", { className: "dwa-deadline-controls", children: [_jsx("div", { className: "dwa-seg", children: DEADLINE_PRESETS.map(preset => (_jsx("button", { type: "button", className: value === preset ? 'is-on' : '', title: deadlineText(preset, acp), onClick: () => void acp.setApprovalDeadline(field, preset), children: deadlineText(preset, acp) }, preset))) }), _jsx("input", { className: "dwa-input dwa-deadline-input", type: "text", inputMode: "numeric", "aria-label": label, "aria-invalid": parsed === undefined, value: text, onChange: event => setDraft(event.target.value), onBlur: commit, onKeyDown: event => { if (event.key === 'Enter')
                            commit(); } }), _jsx("span", { className: "dwa-hint dwa-deadline-unit", children: acp.label('秒', 'sec') })] })] }));
}
/**
 * The approval-deadline card.
 *
 * Both windows are about the SAME failure — an ask nobody answered — reached
 * from two different routes, which is exactly why they need an explanation
 * rather than two bare sliders: the first bounds a host that took the question
 * into the composer and never rendered it, the second bounds an ask that never
 * reached the conversation at all. Neither is an answer on the user's behalf
 * being hidden from them: withdrawing re-asks on the ledger, and the fallback
 * says what it did in a notice.
 *
 * `configured` and `permissionTimeoutMs` are reported by the host only when
 * they are actually in play, and both are shown here rather than swallowed:
 * a user tuning a number that something else is overriding deserves to be told.
 */
function ApprovalDeadlinesCard(props) {
    const { acp, ui } = props;
    const deadlines = ui.approvalDeadlines;
    // Older host half: no card rather than a number this browser invented.
    if (deadlines === undefined)
        return null;
    const configured = deadlines.configured ?? {};
    const inForce = {
        nativeApprovalTimeoutMs: deadlines.nativeApprovalTimeoutMs,
        permissionFallbackTimeoutMs: deadlines.permissionFallbackTimeoutMs,
    };
    const overrideNote = (field) => {
        const baseline = configured[field];
        // Equal (or unconfigured) means nothing is being outranked: stay silent.
        if (baseline === undefined || baseline === inForce[field])
            return undefined;
        return acp.label(`cordis.patch.yml 里是 ${deadlineText(baseline, acp)}，设置页的值优先。`, `cordis.patch.yml asks for ${deadlineText(baseline, acp)}; the value set here wins.`);
    };
    // An override is in force exactly when a note says so — a configured baseline
    // that AGREES with the running value is not an override, and offering a reset
    // for it would be a button that does nothing (observed live).
    const overridden = DEADLINE_FIELDS.some(field => overrideNote(field) !== undefined);
    return (_jsxs("section", { className: "dwa-section", children: [_jsx("div", { className: "dwa-section-heading", children: _jsxs("div", { children: [_jsx("h3", { className: "dwa-section-title", children: acp.label('审批时限', 'Approval deadlines') }), _jsx("p", { className: "dwa-section-copy", children: acp.label('没人答复的权限询问多久后由插件接手。两者都不是替你批准：撤回后会改到设置页再问一次，代答前会先发一条说明。', 'How long an unanswered permission ask waits before the plugin takes over. Neither approves on your behalf: a withdrawal re-asks in Settings, and an auto-answer announces itself first.') })] }) }), _jsxs("div", { className: "dwa-card", style: { paddingTop: 4, paddingBottom: 4 }, children: [_jsx(DeadlineRow, { acp: acp, field: "nativeApprovalTimeoutMs", label: acp.label('对话审批撤回窗口', 'Composer approval withdrawal'), copy: acp.label('宿主把询问接进对话后，多久没出现就撤回并改到设置页问。会渲染的接管是立即出现的，所以这个期限只为「收了却不渲染」而响。', 'How long an ask the host took into the composer may stay invisible before it is withdrawn and re-asked in Settings. A takeover that renders does so immediately, so this only fires for one that never showed up.'), value: deadlines.nativeApprovalTimeoutMs }), overrideNote('nativeApprovalTimeoutMs') !== undefined && (_jsx("div", { className: "dwa-hint", style: { paddingBottom: 8 }, children: overrideNote('nativeApprovalTimeoutMs') })), _jsx(DeadlineRow, { acp: acp, field: "permissionFallbackTimeoutMs", label: acp.label('降级询问代答窗口', 'Degraded-ask auto-answer'), copy: acp.label('询问没能进入对话时（审批服务不可用，或已被撤回），多久后答复 cancelled。', 'How long an ask that never reached the conversation (approval service unavailable, or withdrawn above) waits before it is answered cancelled.'), value: deadlines.permissionFallbackTimeoutMs }), overrideNote('permissionFallbackTimeoutMs') !== undefined && (_jsx("div", { className: "dwa-hint", style: { paddingBottom: 8 }, children: overrideNote('permissionFallbackTimeoutMs') })), deadlines.permissionTimeoutMs !== undefined && (_jsx("div", { className: "dwa-hint", style: { paddingBottom: 8 }, children: acp.label(`注意：cordis.patch.yml 里 permissionTimeoutMs = ${deadlineText(deadlines.permissionTimeoutMs, acp)}，它一视同仁，覆盖上面两个窗口。`, `Note: cordis.patch.yml sets permissionTimeoutMs = ${deadlineText(deadlines.permissionTimeoutMs, acp)}, which governs every path alike and overrides both windows above.`) })), overridden && (_jsxs("div", { className: "dwa-preference-row", children: [_jsx("div", { children: _jsx("div", { className: "dwa-preference-copy", children: acp.label('设置页的值写在插件自己的状态文件里，重启后仍然有效；重置后回到 cordis.patch.yml 的配置。', 'A value set here lives in the plugin\'s own state file and survives a restart; resetting returns to whatever cordis.patch.yml asks for.') }) }), _jsx("button", { type: "button", className: "dwa-btn", onClick: () => void acp.resetApprovalDeadlines(), children: acp.label('恢复配置文件的值', 'Use config file value') })] }))] })] }));
}
/** Settings configuration section for ACP agents. */
export function AcpSettingsSection(props) {
    const acp = props.acp;
    ensureStyle();
    const ui = useUi(acp);
    const ledger = permissionLedgerCard(ui);
    // The agent list section opens by default. `addTarget === undefined` means
    // "follow the first available preset"; an explicit chip click pins the
    // selection until the next create resets it.
    const [addOpen, setAddOpen] = useState(true);
    const [addTarget, setAddTarget] = useState(undefined);
    const [createNonce, setCreateNonce] = useState(0);
    const { configured, available } = partitionAgents(ui.detectedAgents, ui.agents);
    const selected = addTarget ?? available[0] ?? NEW_AGENT_SEED;
    return (_jsxs("div", { className: "dwa-root", children: [_jsxs("header", { className: "dwa-page-header", children: [_jsxs("div", { className: "dwa-page-heading", children: [_jsx("h2", { className: "dwa-page-title", children: acp.label('NTR 智能体', 'NTR Agents') }), _jsx("p", { className: "dwa-page-description", children: acp.label('管理智能体连接、可用模型与对话显示偏好。', 'Manage agent connections, available models, and conversation display preferences.') }), _jsxs("div", { className: "dwa-page-status", children: [_jsx("span", { className: "dwa-dot", style: { background: ui.stream === 'live' ? '#22c55e' : ui.stream === 'down' ? '#ef4444' : '#9ca3af' }, title: ui.stream }), _jsx("span", { children: streamText(ui.stream, acp) }), ui.detectSummary !== undefined && _jsxs("span", { children: ["\u00B7 ", ui.detectSummary] })] })] }), _jsx("div", { className: "dwa-page-actions", children: _jsx("button", { className: "dwa-btn", onClick: () => {
                                void acp.resync();
                                void acp.detectAgents();
                            }, disabled: ui.detecting, children: ui.detecting ? acp.label('检测中...', 'Detecting...') : acp.label('重新检测与刷新', 'Re-detect & Refresh') }) })] }), ledger.visible && (_jsxs("div", { className: "dwa-card dwa-card-warn", style: { marginBottom: 16 }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: 8 }, children: acp.label('待处理权限请求', 'Pending Permission Requests') }), ledger.fellBackFromConversation && (_jsx("div", { className: "dwa-hint", style: { marginBottom: 8 }, children: acp.label('这些询问没有进入对话（审批服务本次不可用、问题从未到达对话，或会话没有对话身份），请在此回答。', 'These asks did not reach the conversation (the approval service was unavailable, the question never reached the conversation, or the session has no chat identity) — answer them here.') })), ui.permissions.map(permission => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }, children: [_jsx("span", { style: { flex: 1, minWidth: 160 }, children: permission.title }), permission.options.map(option => (_jsx("button", { className: "dwa-btn dwa-btn-primary", onClick: () => void acp.respondPermission(permission.requestId, option.optionId), children: option.name }, option.optionId))), _jsx("button", { className: "dwa-btn", onClick: () => void acp.respondPermission(permission.requestId), children: acp.label('拒绝', 'Dismiss') })] }, permission.requestId)))] })), ui.notice !== undefined && (_jsxs("div", { className: "dwa-card dwa-card-warn", style: { marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { flex: 1 }, children: ui.notice }), _jsx("button", { className: "dwa-btn", onClick: () => acp.clearNotice(), children: "\u2715" })] })), ui.preset !== undefined && (_jsxs("div", { className: "dwa-card dwa-mode-banner", children: [_jsxs("div", { className: "dwa-mode-title", children: [acp.label('NTR 模式', 'NTR mode'), _jsx("span", { className: "dwa-badge", children: ui.preset.id })] }), _jsx("span", { className: `dwa-badge ${ui.preset.installed ? 'dwa-badge-success' : 'dwa-badge-warn'}`, children: ui.preset.installed ? acp.label('已就绪', 'Ready') : acp.label('需检查', 'Needs attention') }), _jsxs("div", { className: "dwa-mode-copy", children: [ui.preset.installed
                                ? acp.label('已加入宿主模式列表，新建会话时选择「NTR 模式」即可使用。', 'Added to the harness roster. Pick “NTR mode” when creating a session.')
                                : acp.label('宿主模式列表中没有可用的「NTR 模式」，请检查预设声明。', 'The harness roster has no usable “NTR mode”. Check the preset declaration.'), _jsx("code", { className: "dwa-mode-source dwa-mono", children: ui.preset.source })] }), ui.preset.problem !== undefined && (_jsx("div", { className: "dwa-hint", style: { gridColumn: '1 / -1', color: 'var(--ntr-warn)' }, children: acp.label(`宿主报告：${ui.preset.problem}`, `Harness reported: ${ui.preset.problem}`) }))] })), _jsxs("section", { className: "dwa-section", children: [_jsx("div", { className: "dwa-section-heading", children: _jsxs("div", { children: [_jsxs("h3", { className: "dwa-section-title", children: [acp.label('已接入的智能体', 'Connected agents'), _jsx("span", { className: "dwa-badge", children: configured.length })] }), _jsx("p", { className: "dwa-section-copy", children: acp.label('展开智能体可管理模型、启动命令与工作区。', 'Expand an agent to manage its models, launch command, and workspace.') })] }) }), configured.length === 0 && (_jsx("div", { className: "dwa-card", style: { textAlign: 'center', color: 'var(--ntr-muted)', padding: 20 }, children: acp.label('尚未启用任何 Agent。从下方「添加智能体」点一个检测到的预设（会展开预填命令的创建卡），再点「保存并启用」；也可以直接新建自定义 Agent。', 'No agents configured yet. Pick a detected preset from "Add agent" below (it opens a creation card prefilled with its command), then click "Save & Enable" — or create a custom one from scratch.') })), _jsx("div", { className: "dwa-agent-list", children: configured.map(({ info, synthesized }) => {
                            const activeAgent = ui.agents.find(a => a.id === info.id);
                            return (_jsx(AgentRow, { detected: info, activeAgent: activeAgent, acp: acp, isDefault: ui.defaultAgent === info.id, synthesized: synthesized }, info.id));
                        }) })] }), _jsx("section", { className: "dwa-section", children: _jsxs("div", { className: "dwa-add-panel", children: [_jsxs("button", { type: "button", className: "dwa-add-toggle", "aria-expanded": addOpen, onClick: () => setAddOpen(open => !open), children: [_jsxs("span", { children: [_jsx("span", { className: "dwa-section-title", children: acp.label('添加智能体', 'Add agent') }), _jsx("span", { className: "dwa-section-copy", style: { display: 'block' }, children: acp.label('从预设快速启用，或创建自定义连接。', 'Enable a preset or create a custom connection.') })] }), _jsx("span", { className: "dwa-caret-btn", "aria-hidden": true, children: _jsx("span", { className: "dwa-caret", children: addOpen ? '▾' : '▸' }) })] }), addOpen && (_jsxs("div", { className: "dwa-add-content", children: [_jsxs("div", { className: "dwa-chip-list", children: [available.map(info => (_jsx("button", { type: "button", className: `dwa-chip${selected.id === info.id ? ' dwa-chip-active' : ''}`, onClick: () => setAddTarget(info), title: info.description, children: info.name }, info.id))), _jsx("button", { type: "button", className: `dwa-chip${selected.id === '' ? ' dwa-chip-active' : ''}`, onClick: () => setAddTarget(NEW_AGENT_SEED), children: acp.label('自定义', 'Custom') })] }), available.length === 0 && selected.id === '' && (_jsx("div", { className: "dwa-hint", style: { marginBottom: 8 }, children: acp.label('没有更多可启用的预设 Agent。', 'No more detected presets to enable.') })), _jsx(AgentRow, { detected: selected, acp: acp, isDefault: false, synthesized: false, newCustom: selected.id === '', onCreated: () => {
                                        // Creation done: drop the pin so the selection re-derives to
                                        // the next available preset (or a fresh custom card), and bump
                                        // the nonce so an all-custom reset still remounts empty
                                        // instead of keeping the just-saved values in the form.
                                        setAddTarget(undefined);
                                        setCreateNonce(nonce => nonce + 1);
                                    } }, selected.id === '' ? `custom-${createNonce}` : selected.id)] }))] }) }), _jsx(ApprovalDeadlinesCard, { acp: acp, ui: ui }), _jsxs("section", { className: "dwa-section", children: [_jsx("div", { className: "dwa-section-heading", children: _jsxs("div", { children: [_jsx("h3", { className: "dwa-section-title", children: acp.label('对话外观', 'Conversation appearance') }), _jsx("p", { className: "dwa-section-copy", children: acp.label('设置对话中 NTR 挂牌的进程存活提示。', 'Choose how the NTR tag indicates a running agent process.') })] }) }), _jsxs("div", { className: "dwa-card", style: { paddingTop: 4, paddingBottom: 4 }, children: [_jsxs("div", { className: "dwa-preference-row", children: [_jsxs("div", { children: [_jsx("div", { className: "dwa-preference-label", children: acp.label('挂牌光晕', 'Tag halo') }), _jsx("div", { className: "dwa-preference-copy", children: acp.label('呼吸为脉动光，常亮为恒定光。', 'Breathe pulses gently; steady keeps a constant glow.') })] }), _jsx("div", { className: "dwa-seg", children: ['breath', 'steady'].map(mode => (_jsx("button", { type: "button", className: ui.tagHalo.mode === mode ? 'is-on' : '', onClick: () => void acp.setTagHalo({ ...ui.tagHalo, mode }), children: mode === 'breath' ? acp.label('呼吸', 'Breathe') : acp.label('常亮', 'Steady') }, mode))) })] }), ui.tagHalo.mode === 'breath' && (_jsxs("div", { className: "dwa-preference-row", children: [_jsxs("div", { children: [_jsx("div", { className: "dwa-preference-label", children: acp.label('呼吸频率', 'Breathing speed') }), _jsx("div", { className: "dwa-preference-copy", children: acp.label('控制光晕的脉动速度。', 'Controls how quickly the halo pulses.') })] }), _jsx("div", { className: "dwa-seg", children: ['slow', 'normal', 'fast'].map(speed => (_jsx("button", { type: "button", className: ui.tagHalo.speed === speed ? 'is-on' : '', onClick: () => void acp.setTagHalo({ ...ui.tagHalo, speed }), children: speed === 'slow' ? acp.label('慢速', 'Slow') : speed === 'normal' ? acp.label('正常', 'Normal') : acp.label('快速', 'Fast') }, speed))) })] }))] })] })] }));
}
/** One row per agent: compact when collapsed, the full form when expanded. */
function AgentRow({ detected, activeAgent, acp, isDefault, synthesized, newCustom = false, onCreated, }) {
    const ui = useUi(acp);
    const configured = activeAgent !== undefined || detected.currentConfig !== undefined;
    // A configured agent starts collapsed; a creation card opens straight away
    // (nothing to summarise yet).
    const [expanded, setExpanded] = useState(!configured);
    const [form, setForm] = useState(() => initialForm(detected, activeAgent));
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(undefined);
    const patch = (next) => setForm(prev => ({ ...prev, ...next }));
    const serverExposureKey = exposureKey(detected.currentConfig?.exposedModels);
    useEffect(() => {
        const server = detected.currentConfig?.exposedModels;
        setForm(prev => ({ ...prev, exposed: server === undefined ? undefined : [...server] }));
        // Re-sync the editor only when the persisted filter actually changes, so
        // background resyncs never clobber in-progress checkbox edits.
    }, [serverExposureKey]);
    const serverAutoDiscover = detected.currentConfig?.autoDiscoverModels !== false;
    useEffect(() => {
        // The switch saves itself through the lightweight RPC, so the host is the
        // truth; this keeps the form (and therefore a later full save) in step.
        setForm(prev => ({ ...prev, autoDiscoverModels: serverAutoDiscover }));
    }, [serverAutoDiscover]);
    const trimmedId = form.agentId.trim();
    const idValid = !newCustom || AGENT_ID_PATTERN.test(trimmedId);
    const idTaken = newCustom && trimmedId !== '' && ui.agents.some(a => a.id === trimmedId);
    const cwdInvalid = form.cwd.trim() !== '' && !isAbsolutePathLike(form.cwd.trim());
    const rootValues = form.roots.map(root => root.trim()).filter(root => root !== '');
    const rootsInvalid = form.rootsOpen && (rootValues.length === 0 || rootValues.some(root => !isAbsolutePathLike(root)));
    const idleInvalid = !idleValid(form.idleStr);
    const mcpInvalid = !mcpTextValid(form.mcpText);
    const formIncomplete = splitCommandLine(form.commandLine).command === '' || !idValid || idTaken || cwdInvalid || rootsInvalid || idleInvalid || mcpInvalid;
    const payload = buildPayload(form, detected, newCustom);
    const current = persistedDef(detected, activeAgent);
    const dirty = current !== undefined && !payloadEquals(payload, current);
    // A save stops the child and kills every live session (see BridgeManager.saveAgent).
    const showSaveWarning = dirty && activeAgent !== undefined && activeAgent.state !== 'stopped';
    const handleUseDefault = () => patch({ commandLine: formatCommandLine(detected.defaultCommand, detected.defaultArgs) });
    const handleSave = async () => {
        setSaving(true);
        setSavedSuccess(false);
        try {
            await acp.saveAgent(payload);
            // A save from the creation card resets the list's selection: the agent
            // now lives in the configured list, and keeping the same card mounted
            // would render it twice. Configured rows pass no `onCreated`, so this is
            // a no-op for them.
            onCreated?.();
            if (newCustom)
                return;
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 2000);
        }
        catch {
            // Error handled by store
        }
        finally {
            setSaving(false);
        }
    };
    const handleTest = async () => {
        setTesting(true);
        setTestResult(undefined);
        try {
            const result = await acp.testAgent(payload);
            setTestResult(result.ok
                ? {
                    ok: true,
                    text: acp.label('连接成功', 'Connected') + (result.agentInfo?.name !== undefined ? ` · ${result.agentInfo.name}` : '')
                        + (result.agentInfo?.version !== undefined ? ` v${result.agentInfo.version}` : '')
                        + ` · ${String(result.durationMs)}ms`,
                }
                : { ok: false, text: result.error ?? acp.label('未知错误', 'Unknown error') });
        }
        catch (error) {
            setTestResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
        }
        finally {
            setTesting(false);
        }
    };
    const state = activeAgent !== undefined ? stateVisual(activeAgent.state, acp) : undefined;
    const displayName = newCustom
        ? acp.label('新建自定义 Agent', 'New Custom Agent')
        : (activeAgent?.title ?? detected.currentConfig?.title ?? detected.name);
    const stderr = activeAgent?.state === 'error' ? (activeAgent.stderrTail ?? []) : [];
    const errorSummary = stderr.length > 0 ? stderr[stderr.length - 1] : undefined;
    const currentModel = ui.modelCatalogs[detected.id]?.catalog.model?.currentValue;
    const isPreset = PRESET_IDS.has(detected.id);
    // An error row opens itself so the stderr tail is never behind a click.
    const open = expanded || (activeAgent?.state === 'error' && configured);
    return (_jsxs("div", { className: `dwa-agent-card${open ? ' is-open' : ''}`, children: [_jsxs("div", { className: "dwa-agent-row", children: [_jsx("button", { type: "button", className: "dwa-caret-btn", "aria-expanded": open, onClick: () => setExpanded(value => !value), title: open ? acp.label('收起', 'Collapse') : acp.label('展开配置与模型', 'Expand configuration and models'), children: _jsx("span", { className: "dwa-caret", "aria-hidden": true, children: open ? '▾' : '▸' }) }), _jsxs("div", { className: "dwa-agent-summary", children: [_jsxs("div", { className: "dwa-agent-titleline", children: [_jsx("span", { className: "dwa-agent-name", title: detected.executablePath ?? detected.description, children: displayName }), isDefault && _jsx("span", { className: "dwa-badge dwa-badge-success", children: acp.label('默认', 'Default') }), !isPreset && !newCustom && _jsx("span", { className: "dwa-badge", children: acp.label('自定义', 'Custom') })] }), _jsxs("div", { className: "dwa-agent-meta", children: [state !== undefined && (_jsxs("span", { title: state.title ?? activeAgent?.state, style: { display: 'inline-flex', alignItems: 'center', gap: 6 }, children: [_jsx("span", { className: "dwa-dot", style: { background: state.color } }), state.text] })), configured && (_jsxs(_Fragment, { children: [state !== undefined && _jsx("span", { className: "dwa-agent-meta-separator", children: "\u00B7" }), _jsx("span", { children: currentModel === undefined ? acp.label('未探测模型', 'Model not probed') : `${acp.label('模型', 'Model')}: ${currentModel}` })] })), !synthesized && !newCustom && !detected.detected && (_jsxs("span", { style: { color: 'var(--ntr-warn)' }, title: detected.description, children: ["\u00B7 ", acp.label('未在 PATH 中检测到', 'Not in PATH')] }))] }), errorSummary !== undefined && (_jsx("div", { className: "dwa-error dwa-mono", style: { marginTop: 6, wordBreak: 'break-all' }, children: errorSummary }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [activeAgent?.state === 'error' && (_jsx("button", { className: "dwa-btn", disabled: testing, onClick: () => void handleTest(), children: testing ? acp.label('测试中...', 'Testing...') : acp.label('测试', 'Test') })), configured && (_jsx(RowMenu, { acp: acp, canStop: activeAgent !== undefined && activeAgent.state !== 'stopped', onStop: () => void acp.stopAgent(detected.id), 
                                // The store already surfaced the failure as a notice; swallowing it
                                // here only prevents an unhandled rejection.
                                onRemove: async () => { await acp.deleteAgent(detected.id).catch(() => { }); } }))] })] }), _jsxs("div", { className: "dwa-agent-body", style: open ? undefined : { display: 'none' }, children: [stderr.length > 0 && _jsx("pre", { className: "dwa-stderr", children: stderr.join('\n') }), configured && (_jsxs("section", { className: "dwa-subsection", children: [_jsx("div", { className: "dwa-subsection-head", children: _jsxs("div", { children: [_jsx("h4", { className: "dwa-subsection-title", children: acp.label('模型与默认值', 'Models & defaults') }), _jsx("p", { className: "dwa-subsection-copy", children: acp.label('检测模型目录，并控制对话中可选择的模型。', 'Detect the model catalog and choose what appears in conversations.') })] }) }), _jsx(ModelCatalogBlock, { agentId: detected.id, detected: detected, acp: acp, active: open, exposed: form.exposed, onExposedChange: exposed => patch({ exposed }), autoDiscover: form.autoDiscoverModels, onAutoDiscoverChange: autoDiscoverModels => patch({ autoDiscoverModels }), isDefault: isDefault })] })), _jsxs("section", { className: "dwa-subsection", children: [_jsx("div", { className: "dwa-subsection-head", children: _jsxs("div", { children: [_jsx("h4", { className: "dwa-subsection-title", children: acp.label('连接配置', 'Connection') }), _jsx("p", { className: "dwa-subsection-copy", children: acp.label('设置显示名与启动命令，高级选项按需展开。', 'Set the display name and launch command; expand advanced options only when needed.') })] }) }), _jsx(AgentDetails, { acp: acp, detected: detected, form: form, patch: patch, isConfigured: configured, newCustom: newCustom, formIncomplete: formIncomplete, idValid: idValid, idTaken: idTaken, cwdInvalid: cwdInvalid, rootsInvalid: rootsInvalid, idleInvalid: idleInvalid, mcpInvalid: mcpInvalid, saving: saving, savedSuccess: savedSuccess, testing: testing, testResult: testResult, showSaveWarning: showSaveWarning, onUseDefault: handleUseDefault, onSave: () => void handleSave(), onTest: () => void handleTest() })] })] })] }));
}
/**
 * Hand copy of `DEFAULT_TUNING.idleTimeoutMs` (src/bridge.ts): the browser
 * cannot import the host plane, and this number is only ever placeholder text
 * for a NOT-yet-configured agent (a configured one renders the host's resolved
 * value from `AgentView.idleTimeoutMs`). Keep the two in sync.
 */
const DEFAULT_IDLE_RELEASE_MS = 1_800_000;
/**
 * Hand copy of `DEFAULT_TUNING.probeIdleTimeoutMs` (src/bridge.ts). A process
 * that has never hosted a session — the model probe / post-save probe — lives
 * by THIS window whatever the agent's own field says, so the placeholder has to
 * name both windows. Keep the two in sync.
 */
const DEFAULT_PROBE_RELEASE_MS = 300_000;
export function initialForm(detected, activeAgent) {
    const config = detected.currentConfig;
    const roots = [...(activeAgent?.allowedCwdRoots ?? config?.allowedCwdRoots ?? [])];
    return {
        agentId: detected.id,
        title: activeAgent?.title ?? config?.title ?? detected.name,
        commandLine: formatCommandLine(activeAgent?.command ?? config?.command ?? detected.defaultCommand, activeAgent?.args ?? config?.args ?? detected.defaultArgs),
        npmPackage: config?.npmPackage ?? '',
        cwd: activeAgent?.cwd ?? config?.cwd ?? '',
        // An agent already carrying more than one root opens in advanced mode:
        // single-root mode narrows the allow-list to `cwd` on save, which must
        // never happen as a side effect of merely opening the form.
        rootsOpen: roots.length > 1,
        roots,
        envRows: Object.entries(config?.env ?? {}).map(([key, value]) => ({ key, value })),
        exposed: config?.exposedModels === undefined ? undefined : [...config.exposedModels],
        autoDiscoverModels: config?.autoDiscoverModels !== false,
        // Prefer the host's resolved value: it is the one actually in effect.
        idleStr: idleText(activeAgent?.idleTimeoutMs ?? config?.idleTimeoutMs),
        // The MCP list comes back from the host in its NORMALIZED shape (defaults
        // filled in), so re-serializing it reproduces exactly what is stored —
        // that is what keeps the card from being permanently dirty.
        mcpText: config?.mcpServers === undefined ? '' : JSON.stringify(config.mcpServers, null, 2),
    };
}
function idleText(value) {
    return value === undefined ? '' : String(value);
}
/** `MM-DD HH:mm`, local time — compact enough for the catalog's status line. */
function formatStamp(ms) {
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/**
 * Assemble the save/test payload.
 *
 * Workspace rules (P0-1): a non-empty single-root `cwd` also pins
 * `allowedCwdRoots` to exactly that path — an explicit narrowing, so saving
 * from the panel can never silently widen the sandbox. An empty `cwd` sends
 * neither field and the host falls back to `~/.dsh/dsh-ntr-plus/workspaces`. Advanced
 * mode sends the edited roots as-is (deduplicated).
 */
/** `''` = host default, `0` = never release, otherwise a sane millisecond window. */
function idleValid(raw) {
    const text = raw.trim();
    if (text === '')
        return true;
    if (!/^\d+$/.test(text))
        return false;
    const value = Number(text);
    return value === 0 || (value >= 1_000 && value <= 86_400_000);
}
export function buildPayload(form, detected, newCustom) {
    const env = {};
    for (const row of form.envRows) {
        const key = row.key.trim();
        if (key === '')
            continue;
        env[key] = row.value;
    }
    const cwd = form.cwd.trim();
    const idleRaw = form.idleStr.trim();
    // The field is a command line; the host validates it the same way, so what
    // the preview under the input shows is what will actually be spawned.
    const parsed = splitCommandLine(form.commandLine);
    // An unparseable MCP text yields `undefined` here and `mcpInvalid` in the
    // form, which disables saving — so this never throws inside a render.
    const mcpServers = parseMcpServers(form.mcpText);
    const payload = {
        id: newCustom ? form.agentId.trim() : detected.id,
        ...(form.title.trim() === '' ? {} : { title: form.title.trim() }),
        command: parsed.command,
        args: parsed.args,
        ...(form.npmPackage.trim() === '' ? {} : { npmPackage: form.npmPackage.trim() }),
        env,
        ...(form.exposed === undefined ? {} : { exposedModels: form.exposed }),
        // Auto-discovery is ON by default: only an unchecked switch records the
        // opt-out, otherwise a full save would silently re-enable it.
        ...(form.autoDiscoverModels ? {} : { autoDiscoverModels: false }),
        // `''` sends nothing: the host then applies its own default.
        ...(idleRaw === '' || !idleValid(idleRaw) ? {} : { idleTimeoutMs: Number(idleRaw) }),
        // The MCP list is OPTIONAL: absent = the agent connects only to the
        // servers it configures for itself.
        ...(mcpServers === undefined ? {} : { mcpServers }),
    };
    if (form.rootsOpen) {
        if (cwd !== '')
            payload.cwd = cwd;
        const roots = [...new Set(form.roots.map(root => root.trim()).filter(root => root !== ''))];
        if (roots.length > 0)
            payload.allowedCwdRoots = roots;
        return payload;
    }
    if (cwd !== '') {
        payload.cwd = cwd;
        payload.allowedCwdRoots = [cwd];
    }
    return payload;
}
/** The expanded body: connection form, workspace allow-list, env, actions. */
function AgentDetails({ acp, detected, form, patch, isConfigured, newCustom, formIncomplete, idValid, idTaken, cwdInvalid, rootsInvalid, idleInvalid, mcpInvalid, saving, savedSuccess, testing, testResult, showSaveWarning, onUseDefault, onSave, onTest, }) {
    const ui = useUi(acp);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    // The same parse the host will run (`validateAgentDef` → `splitCommandLine`).
    // Showing it is what turns "the first box swallowed my arguments" into a
    // visible, fixable state instead of a spawn error.
    const parsedCommand = splitCommandLine(form.commandLine);
    const commandPreview = parsedCommand.command === ''
        ? acp.label('填整条命令，例如：codebuddy --acp', 'Type the whole command, e.g. codebuddy --acp')
        : `${acp.label('程序', 'Program')}: ${parsedCommand.command}`
            + (parsedCommand.args.length === 0 ? '' : `　${acp.label('参数', 'Arguments')}: ${parsedCommand.args.join(' ')}`);
    return (_jsxs("div", { children: [newCustom && (_jsx("div", { className: "dwa-form-row", children: _jsxs("div", { className: "dwa-form-col", children: [_jsx("label", { className: "dwa-form-label", children: acp.label('Agent ID（唯一标识，创建后不可改）', 'Agent ID (unique, immutable after creation)') }), _jsx("input", { className: "dwa-input dwa-input-mono", value: form.agentId, onChange: e => patch({ agentId: e.target.value }), placeholder: "e.g. my-agent" }), _jsx("span", { className: idValid && !idTaken ? 'dwa-hint' : 'dwa-error', children: idTaken
                                ? acp.label('该 ID 已被现有 Agent 占用。', 'This id is already taken by a configured agent.')
                                : idValid
                                    ? acp.label('小写字母或数字开头，可用 a-z 0-9 . _ -，最长 64 字符。', 'Starts with a lowercase letter or digit; a-z 0-9 . _ - allowed; max 64 chars.')
                                    : acp.label('ID 格式不合法：小写字母或数字开头，可用 a-z 0-9 . _ -。', 'Invalid id: start with a lowercase letter or digit; only a-z 0-9 . _ - allowed.') })] }) })), _jsx("div", { className: "dwa-form-row", children: _jsxs("div", { className: "dwa-form-col", children: [_jsx("label", { className: "dwa-form-label", children: acp.label('显示名', 'Display Name') }), _jsx("input", { className: "dwa-input", value: form.title, onChange: e => patch({ title: e.target.value }), placeholder: detected.name === '' ? acp.label('我的 Agent', 'My Agent') : detected.name })] }) }), _jsx("div", { className: "dwa-form-row", children: _jsxs("div", { className: "dwa-form-col", children: [_jsx("label", { className: "dwa-form-label", children: acp.label('启动命令（程序 + 参数）', 'Launch Command (program + arguments)') }), _jsx("input", { className: "dwa-input dwa-input-mono", value: form.commandLine, onChange: e => patch({ commandLine: e.target.value }), placeholder: detected.defaultCommand === ''
                                ? 'e.g. codebuddy --acp'
                                : formatCommandLine(detected.defaultCommand, detected.defaultArgs) }), _jsx("span", { className: "dwa-hint", children: commandPreview }), _jsx("span", { className: "dwa-hint", children: acp.label('参数直接跟在程序后面即可；路径里含空格时用引号包住整条路径，例如 "C:\\Program Files\\nodejs\\node.exe" --acp。', 'Arguments go right after the program; quote a whole path that contains spaces, e.g. "C:\\Program Files\\nodejs\\node.exe" --acp.') })] }) }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }, children: [_jsxs("button", { type: "button", className: "dwa-btn dwa-btn-secondary", "aria-expanded": advancedOpen, onClick: () => setAdvancedOpen(value => !value), children: [_jsx("span", { className: "dwa-caret", "aria-hidden": true, children: advancedOpen ? '▾' : '▸' }), " ", acp.label('高级参数', 'Advanced Parameters')] }), !advancedOpen && (cwdInvalid || rootsInvalid) && (_jsx("span", { className: "dwa-error", children: acp.label('里面有非法的工作空间路径', 'Contains an invalid workspace path') })), !advancedOpen && mcpInvalid && (_jsx("span", { className: "dwa-error", children: acp.label('里面的 MCP 服务器配置不是合法 JSON', 'Contains an invalid MCP server list') }))] }), _jsxs("div", { style: advancedOpen ? undefined : { display: 'none' }, children: [!newCustom && (_jsxs("div", { className: "dwa-default-hint", children: [_jsxs("div", { children: [_jsx("span", { style: { fontWeight: 600, marginRight: 6 }, children: acp.label('官方测试默认命令:', 'Tested Default Command:') }), _jsxs("code", { className: "dwa-input-mono", style: { background: '#0000000a', padding: '2px 6px', borderRadius: 4 }, children: [detected.defaultCommand, " ", detected.defaultArgs.join(' ')] })] }), _jsx("button", { type: "button", className: "dwa-btn dwa-btn-secondary", onClick: onUseDefault, title: acp.label('把命令与参数重置为官方验证值', 'Reset command and arguments to the tested default'), children: acp.label('使用预设值', 'Use Preset') })] })), _jsx("div", { className: "dwa-form-row", children: _jsxs("div", { className: "dwa-form-col", children: [_jsx("label", { className: "dwa-form-label", children: acp.label('npm 包名（PATH 中找不到时自动安装）', 'npm Package (auto-installed when missing from PATH)') }), _jsx("input", { className: "dwa-input dwa-input-mono", value: form.npmPackage, onChange: e => patch({ npmPackage: e.target.value }), placeholder: acp.label('原生支持 ACP 的 agent 无需填写', 'Not needed for agents with native ACP support') })] }) }), _jsx(WorkspaceBlock, { acp: acp, form: form, patch: patch, cwdInvalid: cwdInvalid, rootsInvalid: rootsInvalid }), _jsx("div", { className: "dwa-form-row", children: _jsxs("div", { className: "dwa-form-col", children: [_jsx("label", { className: "dwa-form-label", children: acp.label('空闲释放（毫秒）', 'Idle Release (ms)') }), _jsx("input", { className: "dwa-input dwa-input-mono", value: form.idleStr, onChange: e => patch({ idleStr: e.target.value }), placeholder: acp.label(`留空 = 宿主默认（承载会话 ${String(DEFAULT_IDLE_RELEASE_MS / 60_000)} 分钟 / 探测进程 ${String(DEFAULT_PROBE_RELEASE_MS / 60_000)} 分钟）`, `Blank = host default (${String(DEFAULT_IDLE_RELEASE_MS / 60_000)} min for a chat process / ${String(DEFAULT_PROBE_RELEASE_MS / 60_000)} min for a probe)`) }), _jsx("span", { className: idleInvalid ? 'dwa-error' : 'dwa-hint', children: idleInvalid
                                        ? acp.label('必须是 0（永不释放）或 [1000, 86400000] 之间的整数毫秒。', 'Must be 0 (never release) or an integer in [1000, 86400000] ms.')
                                        : acp.label('没有进行中的回合或待答审批时，空闲超过此时长就挂起进程（会话保留，下一条消息自动重启并恢复）；0 = 永不释放；有回合在跑、取消尚未结算或审批待答的进程不会被释放。此窗口只对承载过会话的进程生效：保存后拉起的模型探测进程（面板显示「已连接」的那个）固定 5 分钟释放，填 0 也拦不住。', 'With no turn in flight or approval awaiting an answer, the process is parked once it has been idle this long (sessions are kept and resume on the next message); 0 = never; a process with a running turn, an unsettled cancel, or a pending approval is never released. This window applies only to a process that has hosted a session: the model-probe process (the one the panel shows as "connected" after a save) is always released after 5 minutes, and 0 does not stop it.') })] }) }), _jsxs("div", { className: "dwa-form-row", style: { flexDirection: 'column', gap: 6 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsx("span", { className: "dwa-form-label", children: acp.label('环境变量', 'Environment Variables') }), _jsx("button", { type: "button", className: "dwa-btn dwa-btn-secondary", onClick: () => patch({ envRows: [...form.envRows, { key: '', value: '' }] }), children: acp.label('添加', 'Add') })] }), form.envRows.map((row, index) => (_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsx("input", { className: "dwa-input dwa-input-mono", style: { flex: 2 }, value: row.key, onChange: e => patch({ envRows: form.envRows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)) }), placeholder: "KEY" }), _jsx("input", { className: "dwa-input dwa-input-mono", style: { flex: 3 }, value: row.value, onChange: e => patch({ envRows: form.envRows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)) }), placeholder: "VALUE" }), _jsx("button", { type: "button", className: "dwa-btn", title: acp.label('删除该变量', 'Remove this variable'), onClick: () => patch({ envRows: form.envRows.filter((_, i) => i !== index) }), children: "\u2715" })] }, index))), form.envRows.length === 0 && (_jsx("span", { className: "dwa-hint", children: acp.label('无自定义变量；子进程继承宿主环境。', 'No custom variables; the child inherits the host environment.') }))] }), _jsxs("div", { className: "dwa-form-row", style: { flexDirection: 'column', gap: 6 }, children: [_jsx("span", { className: "dwa-form-label", children: acp.label('MCP 服务器（JSON）', 'MCP Servers (JSON)') }), _jsx("textarea", { className: "dwa-input dwa-input-mono", style: { minHeight: 96, resize: 'vertical' }, value: form.mcpText, onChange: e => patch({ mcpText: e.target.value }), spellCheck: false, placeholder: '[\n  { "name": "example", "transport": "stdio", "command": "/abs/path/to/server", "args": ["--mcp"] }\n]' }), mcpInvalid && (_jsx("span", { className: "dwa-error", children: acp.label('必须是一个 JSON 数组；每个条目写明 name 与 transport。', 'Must be a JSON array; every entry needs a name and a transport.') })), _jsx("span", { className: "dwa-hint", children: acp.label('这些 MCP 服务器会在建会话时交给 agent，由 agent 自己拉起并使用（stdio 需填 command，可选 args / env；http 与 sse 需填 url，可选 headers）。agent 自己配置的 MCP 服务器不受影响，这里只是额外追加。', 'These MCP servers are handed to the agent when a session is created; the agent launches and uses them itself (stdio needs command, with optional args / env; http and sse need url, with optional headers). The MCP servers the agent configures for itself are unaffected — this only adds more.') })] })] }), _jsxs("div", { className: "dwa-form-actions", children: [_jsx("button", { className: "dwa-btn", onClick: onTest, disabled: testing || saving || formIncomplete, title: acp.label('用当前表单值拉起一次性进程并完成 ACP 握手，不保存配置', 'Spawns a throwaway process from the form values and completes the ACP handshake; nothing is saved'), children: testing ? acp.label('测试中...', 'Testing...') : acp.label('测试连接', 'Test Connection') }), _jsx("button", { className: "dwa-btn dwa-btn-primary", onClick: onSave, disabled: saving || testing || formIncomplete, children: saving
                            ? acp.label('保存中...', 'Saving...')
                            : savedSuccess
                                ? acp.label('✓ 已保存', '✓ Saved')
                                : isConfigured
                                    ? acp.label('保存', 'Save')
                                    : acp.label('保存并启用', 'Save & Enable') }), showSaveWarning && (_jsxs("span", { className: "dwa-hint", style: { color: 'var(--ntr-warn)' }, children: ["\u26A0 ", acp.label('保存会停止该 Agent 进程并中断进行中的会话', 'Saving stops this agent process and interrupts live sessions')] }))] }), testResult !== undefined && (_jsxs("div", { className: "dwa-mono", style: {
                    marginTop: 8,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color: testResult.ok ? '#16a34a' : 'var(--ntr-danger)',
                }, children: [testResult.ok ? '✓ ' : '✕ ', testResult.text] }))] }));
}
/**
 * Workspace editor. Single-root mode is one directory; the advanced switch
 * reveals the full allow-list, because the host enforces every root the agent
 * may touch (and refuses anything else with `cwd_denied`).
 */
function WorkspaceBlock({ acp, form, patch, cwdInvalid, rootsInvalid, }) {
    return (_jsxs("div", { className: "dwa-form-row", style: { flexDirection: 'column', gap: 6 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [_jsx("span", { className: "dwa-form-label", children: acp.label('工作空间根目录', 'Workspace Roots') }), _jsxs("label", { className: "dwa-hint", style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: form.rootsOpen, onChange: e => patch({ rootsOpen: e.target.checked }), style: { margin: 0 } }), acp.label('白名单根目录（高级）', 'Root allow-list (advanced)')] })] }), _jsxs("div", { className: "dwa-form-col", children: [_jsx("input", { className: "dwa-input", value: form.cwd, onChange: e => patch({ cwd: e.target.value }), placeholder: acp.label('默认 ~/.dsh/dsh-ntr-plus/workspaces', 'Default: ~/.dsh/dsh-ntr-plus/workspaces') }), cwdInvalid && (_jsx("span", { className: "dwa-error", children: acp.label('必须是绝对路径（如 /work 或 C:\\work）', 'Must be an absolute path (e.g. /work or C:\\work)') })), _jsx("span", { className: "dwa-hint", children: acp.label('对话里的 NTR 会话以该 DSH 会话选中的工作区为工作目录（agent 进程也从那里启动）；此项只在 /acp 直连会话与宿主未上报工作区时生效。', 'An NTR session inside a conversation runs \u2014 and starts its agent process \u2014 in that DSH session\u2019s own workspace; this value applies to /acp-direct sessions and when the host reports no workspace.') }), !form.rootsOpen && (_jsxs("span", { className: "dwa-hint", children: [acp.label('当前白名单：', 'Current allow-list: '), form.roots.length === 0 ? acp.label('（未设置）', '(unset)') : form.roots.join('、'), form.cwd.trim() === '' ? '' : acp.label('；保存时将收窄为工作空间目录', '; saving narrows it to the workspace directory')] }))] }), form.rootsOpen && (_jsxs("div", { className: "dwa-form-col", style: { gap: 4 }, children: [form.roots.map((root, index) => (_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsx("input", { className: "dwa-input dwa-input-mono", value: root, onChange: e => patch({ roots: form.roots.map((r, i) => (i === index ? e.target.value : r)) }), placeholder: "/absolute/path" }), _jsx("button", { type: "button", className: "dwa-btn", title: acp.label('删除该根目录', 'Remove this root'), onClick: () => patch({ roots: form.roots.filter((_, i) => i !== index) }), children: "\u2715" })] }, index))), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("button", { type: "button", className: "dwa-btn dwa-btn-secondary", onClick: () => patch({ roots: [...form.roots, ''] }), children: acp.label('添加根目录', 'Add root') }), _jsx("span", { className: "dwa-hint", children: acp.label('留空的工作空间则使用宿主默认目录。', 'An empty workspace falls back to the host default directory.') })] }), rootsInvalid && (_jsx("span", { className: "dwa-error", children: acp.label('至少需要一个绝对路径根目录', 'At least one absolute root is required') }))] })), _jsx("span", { className: "dwa-hint", children: acp.label('白名单之外的路径会被宿主拒绝（cwd_denied）；当前 DSH 会话自己的工作区始终被信任。', 'Paths outside the allow-list are refused by the host (cwd_denied); the current DSH session\u2019s own workspace is always trusted.') })] }));
}
/** Row overflow menu: the dangerous actions, plus the inline remove confirm. */
function RowMenu({ acp, canStop, onStop, onRemove, }) {
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const wrap = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const onDown = (event) => {
            if (wrap.current !== null && event.target instanceof Node && wrap.current.contains(event.target))
                return;
            setOpen(false);
            setConfirming(false);
        };
        const onKey = (event) => {
            if (event.key !== 'Escape')
                return;
            setOpen(false);
            setConfirming(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    const close = () => {
        setOpen(false);
        setConfirming(false);
    };
    return (_jsxs("div", { className: "dwa-menu-wrap", ref: wrap, children: [_jsx("button", { type: "button", className: "dwa-btn", "aria-haspopup": "menu", "aria-expanded": open, title: acp.label('更多操作', 'More actions'), onClick: () => {
                    setOpen(value => !value);
                    setConfirming(false);
                }, children: "\u22EF" }), open && (_jsxs("div", { className: "dwa-menu", role: "menu", children: [canStop && (_jsx("button", { type: "button", role: "menuitem", className: "dwa-menu-item", onClick: () => {
                            close();
                            onStop();
                        }, children: acp.label('停止当前运行实例', 'Stop Running Process') })), confirming ? (_jsxs("div", { className: "dwa-menu-confirm", children: [_jsx("button", { type: "button", className: "dwa-btn dwa-btn-danger", onClick: () => {
                                    close();
                                    void onRemove();
                                }, children: acp.label('确认移除？', 'Confirm remove?') }), _jsx("button", { type: "button", className: "dwa-btn", onClick: () => setConfirming(false), children: acp.label('取消', 'Cancel') })] })) : (_jsx("button", { type: "button", role: "menuitem", className: "dwa-btn dwa-menu-item dwa-menu-item-danger", onClick: () => setConfirming(true), children: acp.label('移除配置', 'Remove') }))] }))] }));
}
/**
 * Measure the id cell on row hover so its CSS marquee can reach the end of the
 * text. The id is the only cell that yields width, and the panel is resizable,
 * so the overflow is re-read on every entry rather than cached. The animation
 * itself lives in CSS and only runs while the row is hovered; `title` on the
 * row stays the fallback for reduced-motion users.
 */
function armModelIdMarquee(row) {
    const view = row.querySelector('.dwa-model-row-value');
    const text = view?.querySelector('.dwa-model-row-value-text');
    if (view === null || view === undefined || text === null || text === undefined)
        return;
    const fade = Number.parseFloat(getComputedStyle(view).paddingRight) || 0;
    const shift = Math.max(0, text.offsetWidth - (view.clientWidth - fade));
    row.style.setProperty('--dwa-id-shift', `${String(-shift)}px`);
    row.style.setProperty('--dwa-id-duration', `${String(Math.min(4, Math.max(1.2, shift / 30)))}s`);
}
/**
 * Model / thought-level catalog display plus the native-selector visibility
 * filter, as a two-pane transfer list: every known model on the left, the
 * selection that reaches the NTR surfaces on the right. Variants are still
 * opt-in — an empty selection is a legitimate state (base entry only) — and
 * edits save themselves (debounced), so there is no apply button and no second
 * dirty state to lose track of.
 *
 * The panes are ALWAYS shown, never gated on a probe: the right side comes from
 * the agent definition (`exposedModels`) and the left from the host's persisted
 * catalog cache, so opening the card shows what is already configured instead
 * of an empty box that costs one click per visit. 「检测可用模型」 therefore
 * sits with the list and acts as a REFRESH of the left pane only — models the
 * agent newly publishes appear, models it stopped advertising drop out.
 *
 * The auto-discovery switch is a per-agent POLICY, not a one-shot action: it
 * appends models the agent NEWLY publishes to the selection (see
 * `AcpAgentDef.autoDiscoverModels`). It saves itself through the lightweight
 * RPC, so flipping it never restarts the agent process.
 */
function ModelCatalogBlock({ agentId, detected, acp, active, exposed, onExposedChange, autoDiscover, onAutoDiscoverChange, isDefault, }) {
    const ui = useUi(acp);
    const [saveError, setSaveError] = useState(undefined);
    const [search, setSearch] = useState('');
    const timer = useRef(undefined);
    const pending = useRef(undefined);
    const hasPending = useRef(false);
    // In-flight auto-discovery toggle. A ref, not state: the switch saves
    // silently, and a "saving" render here made the row wrap and snap back
    // (user report, 2026-10-21). The guard only prevents double-submits.
    const autoDiscoverBusy = useRef(false);
    // Latest host-confirmed filter: the rollback target when a save fails.
    const serverValue = useRef(exposed);
    serverValue.current = detected.currentConfig?.exposedModels;
    const probing = ui.probingModels[agentId] === true;
    const probeError = ui.probeErrors[agentId];
    const result = ui.modelCatalogs[agentId];
    const modelChoices = result?.catalog.model?.choices ?? [];
    /** Result of the last click on 「检测可用模型」 (what the refresh changed). */
    const [detectNote, setDetectNote] = useState(undefined);
    // Each list folds on its own so a long selection can be parked while the
    // other pane keeps the full column. The list stays mounted (display-toggled)
    // to keep its scroll position.
    const [allCollapsed, setAllCollapsed] = useState(false);
    const [selectedCollapsed, setSelectedCollapsed] = useState(false);
    // Display read, not a probe: the host answers from its persisted catalog
    // cache, so the panes already list the known models the first time the card
    // opens. Gated on `active` because every configured agent's body stays
    // mounted (display-toggled) and a collapsed card has nothing to show.
    useEffect(() => {
        if (!active)
            return;
        void acp.loadCachedModels(agentId);
    }, [active, agentId]);
    useEffect(() => () => {
        if (timer.current === undefined)
            return;
        clearTimeout(timer.current);
        // Flush a pending edit instead of dropping it with the unmount (the
        // panel can be closed mid-debounce); the host keeps the last word.
        if (!hasPending.current)
            return;
        hasPending.current = false;
        void acp.setExposedModels(agentId, pending.current).catch(() => { });
    }, []);
    const rollback = (error) => {
        onExposedChange(serverValue.current === undefined ? undefined : [...serverValue.current]);
        setSaveError(error instanceof Error ? error.message : String(error));
    };
    /** Persist a filter now (mode switch); a failure restores the editor. */
    const commit = async (next) => {
        setSaveError(undefined);
        try {
            await acp.setExposedModels(agentId, next);
            onExposedChange(next);
        }
        catch (error) {
            rollback(error);
        }
    };
    /** Persist selection edits after a short idle — several clicks coalesce into one call. */
    const queueExposure = (next) => {
        pending.current = next;
        hasPending.current = true;
        if (timer.current !== undefined)
            clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            if (!hasPending.current)
                return;
            hasPending.current = false;
            void commit(pending.current);
        }, EXPOSURE_SAVE_DEBOUNCE_MS);
    };
    const toggleAutoDiscover = async (next) => {
        if (autoDiscoverBusy.current)
            return;
        autoDiscoverBusy.current = true;
        onAutoDiscoverChange(next);
        setSaveError(undefined);
        try {
            await acp.setAutoDiscoverModels(agentId, next);
        }
        catch (error) {
            onAutoDiscoverChange(!next);
            setSaveError(error instanceof Error ? error.message : String(error));
        }
        finally {
            autoDiscoverBusy.current = false;
        }
    };
    const query = search.trim().toLowerCase();
    const visibleChoices = query === ''
        ? modelChoices
        : modelChoices.filter(choice => choice.name.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query));
    // Unset means "nothing selected", not "everything": an unset filter and an
    // empty one are the same host-side state (base entry only).
    const basis = exposed ?? [];
    const selected = new Set(basis);
    // Right pane = selection in catalog order, then any selected value the last
    // probe no longer lists (still saved and still usable — hiding it would make
    // the two panes quietly disagree about what is configured).
    const selectedChoices = [];
    for (const choice of modelChoices)
        if (selected.has(choice.value))
            selectedChoices.push(choice);
    const listed = new Set(selectedChoices.map(choice => choice.value));
    for (const value of basis)
        if (!listed.has(value))
            selectedChoices.push({ value, name: value });
    const selectedInCatalog = basis.filter(value => modelChoices.some(choice => choice.value === value)).length;
    const apply = (next) => {
        onExposedChange(next);
        queueExposure(next);
    };
    const toggleChoice = (value) => {
        apply(selected.has(value) ? basis.filter(v => v !== value) : [...basis, value]);
    };
    /** Add every model matching the current search that is not selected yet. */
    const addVisible = () => {
        const added = visibleChoices.map(choice => choice.value).filter(value => !selected.has(value));
        if (added.length === 0)
            return;
        apply([...basis, ...added]);
    };
    const clearAll = () => {
        if (basis.length === 0)
            return;
        apply([]);
    };
    /**
     * Refresh the left pane from the agent: re-probe, then report what moved.
     * The note is what makes the button legible — a refresh that changes nothing
     * looks identical to a dead button otherwise (the catalog `updatedAt` does
     * not even move, since the host keeps the entry when the answer is equal).
     */
    const detect = async () => {
        const before = new Set(modelChoices.map(choice => choice.value));
        setDetectNote(undefined);
        await acp.probeModels(agentId);
        const state = acp.getSnapshot();
        if (state.probeErrors[agentId] !== undefined)
            return;
        const after = state.modelCatalogs[agentId]?.catalog.model?.choices ?? [];
        const afterValues = new Set(after.map(choice => choice.value));
        const added = after.filter(choice => !before.has(choice.value)).length;
        const removed = [...before].filter(value => !afterValues.has(value)).length;
        setDetectNote(added === 0 && removed === 0
            ? acp.label('目录无变化', 'Catalog unchanged')
            : acp.label(`新增 ${String(added)} · 移除 ${String(removed)}`, `${String(added)} added · ${String(removed)} removed`));
    };
    const selectionBadge = modelChoices.length > 0
        ? acp.label(`已选 ${String(selectedInCatalog)}/${String(modelChoices.length)}`, `Selected ${String(selectedInCatalog)}/${String(modelChoices.length)}`)
        : acp.label(`已选 ${String(basis.length)}`, `Selected ${String(basis.length)}`);
    // Freshness of the cached list (a probe that finds nothing new keeps the old
    // stamp by design — see `detect`), superseded by the click's own outcome.
    const catalogStatus = detectNote ?? (result !== undefined && result.updatedAt > 0
        ? acp.label(`目录更新于 ${formatStamp(result.updatedAt)}`, `Catalog from ${formatStamp(result.updatedAt)}`)
        : undefined);
    const leftEmptyCopy = visibleChoices.length > 0
        ? undefined
        : modelChoices.length > 0
            ? acp.label('无匹配模型', 'No matching models')
            : result === undefined
                ? acp.label('尚未读取模型目录，点「检测可用模型」从 Agent 读取。', 'No catalog yet — click "Detect available models" to read it from the agent.')
                : acp.label('该 Agent 未暴露模型选择器（category: model）。', 'This agent exposes no model selector (category: model).');
    return (_jsxs("div", { children: [!isDefault && (_jsx("div", { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, children: _jsx("button", { className: "dwa-btn", onClick: () => void acp.setDefaultAgent(agentId), children: acp.label('设为默认智能体', 'Set as default agent') }) })), isDefault && (
            // This default belongs to the plugin, not the deployment model route.
            _jsx("div", { className: "dwa-hint", style: { marginTop: 8 }, children: acp.label('当前为默认智能体：新的 NTR 会话由它服务，不影响其他模式的默认模型。', "This is the default agent for new NTR sessions; other modes' default models are untouched.") })), _jsxs("div", { className: "dwa-inline-setting", style: { marginTop: 12 }, children: [_jsxs("label", { className: "dwa-switch", title: acp.label('Agent 新发布的模型会自动加入右侧已选列表；首次检测到的目录只作为基线，不会一次性全选。', 'Models the agent newly publishes are added to the selected list; the first observed catalog is only a baseline and is not selected wholesale.'), children: [_jsx("input", { type: "checkbox", checked: autoDiscover, onChange: e => void toggleAutoDiscover(e.target.checked), style: { margin: 0, accentColor: '#2563eb' } }), acp.label('自动发现新模型', 'Auto-discover new models')] }), _jsx("span", { className: "dwa-setting-copy", children: acp.label('新增模型自动加入已选列表，现有勾选不受影响。', 'New models join the selected list automatically; existing picks are untouched.') })] }), saveError !== undefined && _jsx("div", { className: "dwa-error", style: { marginTop: 4 }, children: saveError }), probeError !== undefined && (_jsxs("div", { className: "dwa-error", style: { marginTop: 8, wordBreak: 'break-word' }, children: ["\u26A0 ", acp.label('模型检测失败：', 'Model detection failed: '), probeError] })), _jsxs("div", { className: "dwa-model-section", children: [_jsxs("div", { className: "dwa-model-toolbar", children: [_jsxs("span", { className: "dwa-form-label", children: [acp.label('对话中可见的模型', 'Models offered in the conversation'), _jsx("span", { className: "dwa-hint", style: { marginLeft: 6, fontWeight: 400 }, title: acp.label('NTR 模式下的对话只列出这里勾选的模型；未勾选的仍可用——正在生效的那个也会以「· 当前」列出来，其余不列出。', 'The NTR surfaces only list what is checked here; unchecked models still work, and the one currently in force is still listed with a "· current" row — the rest are not offered.'), children: acp.label('（NTR 座位 / 芯片的下拉列表）', '(the NTR seat and chip pickers)') })] }), _jsx("span", { className: "dwa-badge dwa-badge-info", children: selectionBadge }), catalogStatus !== undefined && _jsx("span", { className: "dwa-hint dwa-model-status", children: catalogStatus }), _jsxs("div", { className: "dwa-model-toolbar-actions", children: [_jsx("button", { type: "button", className: "dwa-btn dwa-btn-secondary", disabled: probing, onClick: () => void detect(), title: acp.label('重新读取 Agent 的模型目录：新增的加入左侧，已下架的从左侧移除；已选列表不受影响。', 'Re-read the agent catalog: newly published models join the left list, withdrawn ones drop out. The selection is untouched.'), children: probing ? acp.label('模型检测中...', 'Probing models...') : acp.label('检测可用模型', 'Detect available models') }), _jsx("input", { className: "dwa-input dwa-model-search", value: search, onChange: e => setSearch(e.target.value), placeholder: acp.label('搜索模型…', 'Search models…') })] })] }), _jsxs("div", { className: "dwa-model-transfer", children: [_jsxs("div", { className: `dwa-model-pane${allCollapsed ? ' is-collapsed' : ''}`, children: [_jsxs("div", { className: "dwa-model-pane-head", children: [_jsx("span", { children: acp.label('全部模型', 'All models') }), result !== undefined && _jsx("span", { className: "dwa-badge", children: modelChoices.length }), _jsx("button", { type: "button", className: "dwa-btn dwa-btn-secondary", disabled: visibleChoices.length === 0, onClick: addVisible, title: acp.label('把当前搜索范围内的模型全部加入右侧', 'Add every model matching the current search'), children: acp.label('全部加入', 'Add all') }), _jsx("button", { type: "button", className: "dwa-caret-btn", "aria-expanded": !allCollapsed, onClick: () => setAllCollapsed(value => !value), title: allCollapsed ? acp.label('展开全部模型', 'Expand all models') : acp.label('收起全部模型', 'Collapse all models'), children: _jsx("span", { className: "dwa-caret", "aria-hidden": true, children: allCollapsed ? '▸' : '▾' }) })] }), _jsxs("div", { className: "dwa-model-list", children: [visibleChoices.map(choice => {
                                                const checked = selected.has(choice.value);
                                                // group 前缀仅来自 agent 返回的 SessionConfigSelectGroup（见 impl.ts
                                                // pushCatalogChoice）；供应商可见性兜底靠原样展示 value，严禁从
                                                // value 路径截取供应商段做标签（约束 8）。
                                                const title = choice.description === undefined
                                                    ? choice.value
                                                    : `${choice.value}\n${choice.description}`;
                                                return (_jsxs("button", { type: "button", className: `dwa-model-row${checked ? ' is-on' : ''}`, title: title, onClick: () => toggleChoice(choice.value), onPointerEnter: event => { armModelIdMarquee(event.currentTarget); }, children: [_jsx("span", { className: "dwa-model-row-mark", children: checked ? '✓' : '+' }), _jsxs("span", { className: "dwa-model-row-name", children: [choice.group !== undefined && _jsxs("span", { style: { opacity: 0.7 }, children: [choice.group, " \u00B7 "] }), choice.name] }), choice.value !== choice.name && (_jsx("span", { className: "dwa-model-row-value", children: _jsx("span", { className: "dwa-model-row-value-text", children: choice.value }) })), choice.description !== undefined && choice.description !== choice.group && (_jsx("span", { className: "dwa-model-row-desc", children: choice.description }))] }, choice.value));
                                            }), leftEmptyCopy !== undefined && _jsx("span", { className: "dwa-hint dwa-model-empty", children: leftEmptyCopy })] })] }), _jsxs("div", { className: `dwa-model-pane${selectedCollapsed ? ' is-collapsed' : ''}`, children: [_jsxs("div", { className: "dwa-model-pane-head", children: [_jsx("span", { children: acp.label('已选模型', 'Selected models') }), _jsx("span", { className: "dwa-badge dwa-badge-info", children: basis.length }), _jsx("button", { type: "button", className: "dwa-btn dwa-btn-secondary", disabled: basis.length === 0, onClick: clearAll, children: acp.label('清空', 'Clear') }), _jsx("button", { type: "button", className: "dwa-caret-btn", "aria-expanded": !selectedCollapsed, onClick: () => setSelectedCollapsed(value => !value), title: selectedCollapsed ? acp.label('展开已选模型', 'Expand selected models') : acp.label('收起已选模型', 'Collapse selected models'), children: _jsx("span", { className: "dwa-caret", "aria-hidden": true, children: selectedCollapsed ? '▸' : '▾' }) })] }), _jsxs("div", { className: "dwa-model-list", children: [selectedChoices.length === 0 && (_jsx("span", { className: "dwa-hint dwa-model-empty", children: acp.label('还没有选择模型（点左侧的模型加入）', 'Nothing selected yet — pick models on the left') })), selectedChoices.map(choice => (_jsxs("button", { type: "button", className: "dwa-model-row is-on", title: choice.description === undefined ? choice.value : `${choice.value}\n${choice.description}`, onClick: () => toggleChoice(choice.value), onPointerEnter: event => { armModelIdMarquee(event.currentTarget); }, children: [_jsxs("span", { className: "dwa-model-row-name", children: [choice.group !== undefined && _jsxs("span", { style: { opacity: 0.7 }, children: [choice.group, " \u00B7 "] }), choice.name] }), choice.value !== choice.name && (_jsx("span", { className: "dwa-model-row-value", children: _jsx("span", { className: "dwa-model-row-value-text", children: choice.value }) })), choice.description !== undefined && choice.description !== choice.group && (_jsx("span", { className: "dwa-model-row-desc", children: choice.description })), _jsx("span", { className: "dwa-model-row-remove", "aria-hidden": "true", children: "\u00D7" })] }, choice.value)))] })] })] }), result?.catalog.thought !== undefined && (_jsxs("div", { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("span", { className: "dwa-form-label", children: acp.label('思考等级', 'Thought Levels') }), result.catalog.thought.choices.map(choice => (_jsx("span", { className: "dwa-badge", title: choice.description, children: choice.name }, choice.value)))] }))] })] }));
}
