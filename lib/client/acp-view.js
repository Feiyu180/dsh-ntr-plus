import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useRef, useState } from 'react';
import { ensureAcpStyle, useUi } from "./acp-ui.js";
/** Glyph per ACP tool kind, so a call's nature reads before its title does. */
const TOOL_GLYPH = {
    read: '📖',
    edit: '✏️',
    delete: '🗑️',
    move: '📦',
    search: '🔍',
    execute: '⌨️',
    think: '🧠',
    fetch: '🌐',
    switch_mode: '⇄',
    other: '🛠️',
};
/** Tone class per ACP tool status. */
const STATUS_TONE = {
    pending: 'idle',
    in_progress: 'busy',
    completed: 'done',
    failed: 'fail',
};
/** Cap on the rendered diff matrix: beyond it, show the edit as remove-all/add-all. */
const DIFF_LCS_LIMIT = 300;
/** Tool output lines shown before the "show all" toggle appears. */
const TOOL_LINES_CLIP = 12;
/** Split a text payload into lines, tolerating an empty / null side. */
function linesOf(text) {
    if (text === null || text === '')
        return [];
    return text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
}
/**
 * Line diff with a common prefix/suffix trim plus an LCS over the remaining
 * middle — the standard shape that keeps an edit reviewable without pulling a
 * diff library into a browser bundle.
 */
export function diffRows(oldText, newText) {
    const oldLines = linesOf(oldText);
    const newLines = linesOf(newText);
    const rows = [];
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
        start++;
    let tail = 0;
    while (tail < oldLines.length - start
        && tail < newLines.length - start
        && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail])
        tail++;
    for (let i = 0; i < start; i++)
        rows.push({ sign: ' ', text: oldLines[i] });
    const oldMiddle = oldLines.slice(start, oldLines.length - tail);
    const newMiddle = newLines.slice(start, newLines.length - tail);
    if (oldMiddle.length > DIFF_LCS_LIMIT || newMiddle.length > DIFF_LCS_LIMIT) {
        for (const text of oldMiddle)
            rows.push({ sign: '-', text });
        for (const text of newMiddle)
            rows.push({ sign: '+', text });
    }
    else {
        rows.push(...lcsRows(oldMiddle, newMiddle));
    }
    for (let i = tail; i > 0; i--)
        rows.push({ sign: ' ', text: oldLines[oldLines.length - i] });
    return rows;
}
/** LCS line alignment of two short blocks (DP table, bounded by the caller). */
function lcsRows(oldLines, newLines) {
    const rows = oldLines.length;
    const cols = newLines.length;
    const table = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
    for (let i = rows - 1; i >= 0; i--) {
        for (let j = cols - 1; j >= 0; j--) {
            const row = table[i];
            const below = table[i + 1];
            row[j] = oldLines[i] === newLines[j]
                ? below[j + 1] + 1
                : Math.max(below[j], row[j + 1]);
        }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
        if (oldLines[i] === newLines[j]) {
            out.push({ sign: ' ', text: oldLines[i] });
            i++;
            j++;
        }
        else if (table[i + 1][j] >= table[i][j + 1]) {
            out.push({ sign: '-', text: oldLines[i] });
            i++;
        }
        else {
            out.push({ sign: '+', text: newLines[j] });
            j++;
        }
    }
    while (i < rows) {
        out.push({ sign: '-', text: oldLines[i] });
        i++;
    }
    while (j < cols) {
        out.push({ sign: '+', text: newLines[j] });
        j++;
    }
    return out;
}
/** Inline `code` and **bold** spans; everything else stays literal text. */
function inlineNodes(text) {
    const out = [];
    const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
    let last = 0;
    let match;
    let key = 0;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > last)
            out.push(text.slice(last, match.index));
        const token = match[0];
        key++;
        if (token.startsWith('`'))
            out.push(_jsx("code", { className: "ntr-acp-inline-code", children: token.slice(1, -1) }, key));
        else
            out.push(_jsx("strong", { children: token.slice(2, -2) }, key));
        last = match.index + token.length;
    }
    if (last < text.length)
        out.push(text.slice(last));
    return out;
}
/** Fenced-code-aware text body: agent prose without a markdown dependency. */
function RichText({ text }) {
    const parts = text.split('```');
    return (_jsx(_Fragment, { children: parts.map((part, index) => (index % 2 === 1
            ? _jsx("pre", { className: "ntr-acp-code", children: part.replace(/^[a-zA-Z0-9_-]*\n/, '') }, index)
            : _jsx("span", { children: inlineNodes(part) }, index))) }));
}
/**
 * Whether one structured edit is a NEW FILE.
 *
 * Decided by the old side, never by the removal count: an existing file that
 * only gained lines also diffs to zero removals, and labelling that "new file"
 * hid a real edit behind a wrong badge (the audit's F8). The only old sides
 * that mean "nothing was there" are an absent one and one byte-identical to
 * the new content — the degenerate case where there is no edit at all.
 */
export function isNewFileDiff(oldText, newText) {
    return oldText === null || oldText === '' || oldText === newText;
}
/** One structured edit, rendered as a unified diff. */
function DiffView({ diff, t }) {
    const rows = diffRows(diff.oldText, diff.newText);
    const added = rows.filter(row => row.sign === '+').length;
    const removed = rows.filter(row => row.sign === '-').length;
    const isNewFile = isNewFileDiff(diff.oldText, diff.newText);
    return (_jsxs("div", { className: "ntr-acp-diff", children: [_jsxs("div", { className: "ntr-acp-diff-head", children: [_jsx("span", { className: "ntr-acp-diff-path", children: diff.path }), _jsxs("span", { className: "ntr-acp-diff-stats", children: [_jsxs("span", { className: "is-add", children: ["+", added] }), " ", _jsxs("span", { className: "is-del", children: ["-", removed] })] })] }), _jsx("div", { className: "ntr-acp-diff-body", children: rows.map((row, index) => (_jsxs("div", { className: `ntr-acp-diff-row is-${row.sign === '+' ? 'add' : row.sign === '-' ? 'del' : 'ctx'}`, children: [_jsx("span", { className: "ntr-acp-diff-sign", children: row.sign }), _jsx("span", { className: "ntr-acp-diff-text", children: row.text })] }, index))) }), isNewFile && _jsx("div", { className: "ntr-acp-diff-note", children: t('新增文件', 'new file') })] }));
}
/** One tool call: header, arguments, text output, unknown payloads, and any structured edits it carried. */
function ToolCard({ block, t }) {
    const [expanded, setExpanded] = useState(false);
    const [rawOpen, setRawOpen] = useState(false);
    const glyph = TOOL_GLYPH[block.toolKind ?? 'other'] ?? TOOL_GLYPH.other;
    const tone = STATUS_TONE[block.status] ?? 'idle';
    const clipped = !expanded && block.lines.length > TOOL_LINES_CLIP;
    const shown = clipped ? block.lines.slice(0, TOOL_LINES_CLIP) : block.lines;
    return (_jsxs("div", { className: `ntr-acp-tool is-${tone}`, children: [_jsxs("div", { className: "ntr-acp-tool-head", children: [_jsx("span", { "aria-hidden": true, children: glyph }), _jsx("span", { className: "ntr-acp-tool-title", children: block.title === '' ? block.toolCallId : block.title }), _jsx("span", { className: `ntr-acp-badge is-${tone}`, children: block.status })] }), block.input !== undefined && block.input !== '' && (_jsx("pre", { className: "ntr-acp-tool-body ntr-acp-tool-input", children: block.input })), block.details !== undefined && block.details.length > 0 && (_jsx("pre", { className: "ntr-acp-tool-body ntr-acp-tool-meta", children: block.details.join('\n') })), shown.length > 0 && (_jsx("pre", { className: "ntr-acp-tool-body", children: `${shown.join('\n')}${clipped ? '\n…' : ''}` })), block.extras !== undefined && block.extras.length > 0 && (_jsx("pre", { className: "ntr-acp-tool-body", children: block.extras.join('\n') })), block.diffs?.map((diff, index) => _jsx(DiffView, { diff: diff, t: t }, `${diff.path}#${String(index)}`)), block.lines.length > TOOL_LINES_CLIP && (_jsx("button", { type: "button", className: "ntr-acp-more", onClick: () => { setExpanded(!expanded); }, children: expanded
                    ? t('收起', 'collapse')
                    : t(`显示全部 ${block.lines.length} 行`, `show all ${block.lines.length} lines`) })), block.raw !== undefined && (_jsx("button", { type: "button", className: "ntr-acp-more", onClick: () => { setRawOpen(!rawOpen); }, children: rawOpen ? t('收起原始数据', 'hide raw payload') : t('原始数据', 'raw payload') })), rawOpen && block.raw !== undefined && _jsx("pre", { className: "ntr-acp-tool-body", children: block.raw })] }));
}
/** One notification the view has no card of its own for: its readable fold, plus the untouched payload. */
function EventCard({ block, t }) {
    const [rawOpen, setRawOpen] = useState(false);
    return (_jsxs("div", { className: "ntr-acp-tool is-done", children: [_jsxs("div", { className: "ntr-acp-tool-head", children: [_jsx("span", { "aria-hidden": true, children: "\u2139\uFE0F" }), _jsx("span", { className: "ntr-acp-tool-title", children: block.event })] }), block.text !== '' && _jsx("pre", { className: "ntr-acp-tool-body", children: block.text }), block.raw !== undefined && (_jsx("button", { type: "button", className: "ntr-acp-more", onClick: () => { setRawOpen(!rawOpen); }, children: rawOpen ? t('收起原始数据', 'hide raw payload') : t('原始数据', 'raw payload') })), rawOpen && block.raw !== undefined && _jsx("pre", { className: "ntr-acp-tool-body", children: block.raw })] }));
}
/** One plan snapshot (the agent's own todo list). */
function PlanCard({ entries, t }) {
    const done = entries.filter(entry => entry.status === 'completed').length;
    return (_jsxs("div", { className: "ntr-acp-plan", children: [_jsx("div", { className: "ntr-acp-plan-head", children: t(`计划 ${done}/${entries.length}`, `Plan ${done}/${entries.length}`) }), entries.map((entry, index) => (_jsxs("div", { className: `ntr-acp-plan-row is-${entry.status}`, children: [_jsx("span", { className: "ntr-acp-plan-glyph", "aria-hidden": true, children: entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '▸' : '○' }), _jsx("span", { children: entry.content }), entry.priority !== undefined && _jsx("span", { className: "ntr-acp-plan-prio", children: entry.priority })] }, index)))] }));
}
/**
 * One stream block, dispatched by kind. Memoized on its props — `block`, the
 * store's instance-bound `label`, and `localeRev` (it moves on a language
 * switch, so translated copy re-renders) — so a folded batch re-renders only
 * the rows whose block object changed (`foldUpdate` replaces blocks immutably)
 * instead of the whole transcript on every store notification. `key` stays the
 * index on purpose: blocks fold append-only, and identity is the block object.
 */
const BlockView = memo(function BlockView({ block, label }) {
    const t = label;
    switch (block.kind) {
        case 'user':
            return _jsx("div", { className: "ntr-acp-bubble is-user", children: _jsx(RichText, { text: block.text }) });
        case 'agent':
            return _jsx("div", { className: "ntr-acp-bubble is-agent", children: _jsx(RichText, { text: block.text }) });
        case 'thought':
            return (_jsxs("details", { className: "ntr-acp-thought", children: [_jsx("summary", { children: t('思考过程', 'reasoning') }), _jsx("div", { className: "ntr-acp-thought-body", children: _jsx(RichText, { text: block.text }) })] }));
        case 'tool':
            return _jsx(ToolCard, { block: block, t: t });
        case 'plan':
            return _jsx(PlanCard, { entries: block.entries, t: t });
        case 'event':
            return _jsx(EventCard, { block: block, t: t });
        default:
            return _jsx("div", { className: `ntr-acp-notice is-${block.tone}`, children: block.text });
    }
});
/** The bound ACP session for this chat, preferring the live one. */
function boundSession(list) {
    return list.find(session => !session.released) ?? list[0];
}
/**
 * Everything the view can read that says "this conversation is set up on an
 * agent": a live or parked ACP session, the host's binding (`session/chat-list`'s
 * `boundAgentId`, which outlives a closed session), and the persisted pick.
 *
 * The transcript is deliberately NOT one of these sources: it is a record of
 * turns, and it is dropped when a session is destroyed, so reading it alone
 * answered "has an agent ever served this conversation" with "no" for
 * conversations that had just run one.
 */
export function boundAgentOf(session, hostBoundAgentId, pickedAgentId, agents) {
    const id = session?.agentId ?? hostBoundAgentId ?? pickedAgentId;
    if (id === undefined)
        return undefined;
    return { id, title: session?.agentTitle ?? agents.find(agent => agent.id === id)?.title ?? id };
}
/**
 * The empty state's copy, decided from the facts the view can actually read.
 *
 * A pure function on purpose: the bundle has no DOM test, and this decision is
 * where two real defects lived. `chatTranscriptOf` answering `undefined` covers
 * TWO different states — "this conversation has never been served by an NTR
 * agent" and "its ACP session record is gone" (a closed session is destroyed by
 * `closeSession`/`forgetDshSession`, a stopped agent drops its bridge) while the
 * binding and the composer chip still name the agent. Claiming the first state
 * in both cases made the view contradict the chip sitting one row above it.
 *
 * The hint has its own defect: it pointed at the composer's NTR base, which only
 * the ACP-mode gate installs (`syncAcpMode` in src/client/index.tsx) — in an
 * ordinary conversation that cell still holds the host's own model selector, so
 * the hint sent the user to a control that is not there.
 */
export function acpEmptyCopy(facts, t) {
    const bound = facts.bound;
    if (bound !== undefined) {
        return {
            title: t('这个会话当前没有可显示的 ACP 会话', 'This conversation has no ACP session to show right now'),
            body: t('给它发一条消息，它就会开始服务这个会话：原生聊天里会出现它的文字回复与思考过程，而它的工具调用、计划和 diff 会完整地出现在这个视图里。', 'Send it a message and it starts serving this conversation: the native chat shows its prose and reasoning, while its tool calls, plans and diffs appear here in full.'),
            hint: `${t('绑定的是', 'bound to')} · ${bound.title}`,
        };
    }
    const copy = {
        title: t('这个会话还没有 NTR agent 参与', 'No NTR agent has run in this conversation yet'),
        body: t('选中一个 NTR agent 后，本会话的对话就由它服务：原生聊天里会出现它的文字回复与思考过程，而它的工具调用、计划和 diff 会完整地出现在这个视图里。', "Pick a NTR agent and it serves this conversation: the native chat shows its prose and reasoning, while its tool calls, plans and diffs appear here in full."),
    };
    if (!facts.hasAgents) {
        return { ...copy, hint: `${t('还没有配置 agent', 'No agent configured')} · ${t('设置 → NTR', 'Settings → NTR')}` };
    }
    // The base is only on screen in NTR mode; naming it anywhere else points at
    // the host's model selector. A host that has not answered yet gets no line
    // rather than a guess (the seat diagnostics below still say what they saw).
    if (facts.acpMode === true) {
        return { ...copy, hint: t('用输入框右侧的 NTR 底座选择一个 agent', 'pick one from the NTR base in the composer') };
    }
    if (facts.acpMode === false) {
        return {
            ...copy,
            hint: `${t('这个会话不在 NTR 模式', 'This conversation is not in NTR mode')} · ${t('新建会话时可以选择 NTR 模式', 'NTR is chosen when a conversation starts')}`,
        };
    }
    return copy;
}
/**
 * The ACP view tab body: who serves this conversation and how it is doing,
 * then the agent's own stream.
 */
export function AcpConversationView(props) {
    ensureAcpStyle();
    const { acp, sessionId } = props;
    const t = (zh, en) => acp.label(zh, en);
    const ui = useUi(acp);
    const bound = ui.chatSessionsFor === sessionId ? boundSession(ui.chatSessions) : undefined;
    const transcript = acp.chatTranscriptOf(sessionId);
    // Who this conversation is set up on — readable with no transcript at all,
    // which is the whole point: the transcript is a record of turns, the binding
    // is the conversation's own state.
    const boundAgent = boundAgentOf(bound, ui.chatBoundAgent[sessionId], ui.chatChoice[sessionId]?.agentId, ui.agents);
    const streamRef = useRef(null);
    const pinned = useRef(true);
    // Observe this chat session's ACP transcripts whenever the binding could
    // have changed (first turn, agent switch, crash → resume).
    useEffect(() => {
        void acp.loadChatSessions(sessionId);
        void acp.loadChatTranscript(sessionId);
    }, [acp, sessionId, bound?.sessionId, bound?.released]);
    const blockCount = transcript?.blocks.length ?? 0;
    const tail = transcript?.blocks[blockCount - 1];
    useEffect(() => {
        const node = streamRef.current;
        if (node === null || !pinned.current)
            return;
        node.scrollTop = node.scrollHeight;
    }, [blockCount, tail]);
    if (transcript === undefined) {
        // `ui.acpMode[sessionId]` is `undefined` until the host has answered for
        // this conversation; the copy builder reads that as "unknown" and says
        // nothing rather than guessing.
        const empty = acpEmptyCopy({
            bound: boundAgent,
            hasAgents: ui.agents.length > 0,
            acpMode: ui.acpMode[sessionId],
        }, t);
        return (_jsx("div", { className: "ntr-acp-view", children: _jsxs("div", { className: "ntr-acp-empty", children: [_jsx("div", { className: "ntr-acp-empty-title", children: empty.title }), _jsx("p", { className: "ntr-acp-empty-body", children: empty.body }), empty.hint !== undefined && _jsx("div", { className: "ntr-acp-empty-hint", children: empty.hint }), ui.seatDiag !== 'idle' && ui.seatDiag !== 'gate disposed' && (_jsxs("div", { className: "ntr-acp-empty-hint ntr-acp-seat-diag", children: [t('模型座位', 'model seat'), " \u00B7 ", ui.seatDiag] })), ui.permissionSeatDiag !== 'idle' && ui.permissionSeatDiag !== 'gate disposed' && (_jsxs("div", { className: "ntr-acp-empty-hint ntr-acp-seat-diag", children: [t('权限底座', 'permission seat'), " \u00B7 ", ui.permissionSeatDiag] })), ui.slashDiag !== 'idle' && (_jsxs("div", { className: "ntr-acp-empty-hint ntr-acp-seat-diag", children: [t('斜杠菜单', 'slash menu'), " \u00B7 ", ui.slashDiag] }))] }) }));
    }
    const session = transcript.session;
    const usage = session.usage;
    const agentTitle = ui.agents.find(agent => agent.id === session.agentId)?.title ?? bound?.agentTitle ?? session.agentId;
    const health = session.released
        ? { text: t('已挂起 · 下一条消息自动恢复', 'paused · resumes on your next message'), tone: 'warn' }
        : session.closed
            ? { text: t('已关闭', 'closed'), tone: 'idle' }
            : session.running
                ? { text: t('运行中', 'running'), tone: 'busy' }
                : { text: t('空闲', 'idle'), tone: 'done' };
    return (_jsxs("div", { className: "ntr-acp-view", children: [_jsxs("div", { className: "ntr-acp-view-head", children: [_jsx("span", { className: `ntr-acp-badge is-${health.tone}`, children: health.text }), _jsx("span", { className: "ntr-acp-view-agent", children: agentTitle }), _jsx("span", { className: "ntr-acp-view-meta", title: session.cwd, children: session.cwd }), usage !== undefined && _jsxs("span", { className: "ntr-acp-view-meta", children: [usage.used, "/", usage.size] }), _jsx("button", { type: "button", className: "ntr-acp-more", onClick: () => { void acp.loadChatTranscript(sessionId); }, children: t('刷新', 'refresh') })] }), _jsx("div", { className: "ntr-acp-stream", ref: streamRef, onScroll: event => {
                    const node = event.currentTarget;
                    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
                }, children: transcript.blocks.length === 0
                    ? _jsx("div", { className: "ntr-acp-empty-hint", children: t('还没有消息：在下面的输入框里发给它。', 'Nothing yet — send it a message below.') })
                    : transcript.blocks.map((block, index) => _jsx(BlockView, { block: block, label: acp.label, localeRev: ui.localeRev }, index)) })] }));
}
