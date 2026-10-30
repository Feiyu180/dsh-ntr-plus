/**
 * Pure host-side logic for dsh-ntr-plus: config validation, workspace guard,
 * child env assembly, capped transcript, event hub, and the RPC dispatcher.
 * No Node imports, no SDK imports — everything here is testable with plain
 * fakes.
 */
import { randomUUID } from './ids.ts';
import type { AcpAgentCatalog, AcpAgentDef, AcpApprovalDeadlines, AcpConversationChoice, AcpEvent, AcpMcpServerDef, AcpPluginConfig, AcpPresetStatus, AcpTagHalo, AgentCatalogResult, AgentProbeModelsResult, AgentTestResult, AgentView, ApprovalDeadlineKey, ChatSessionView, ChatTranscriptView, DetectedAgentInfo, PermissionOptionView, PermissionOutcome, RpcResult } from './protocol.ts';
export { randomUUID };
/** Structured failure the RPC layer converts to `{ok:false, error}` and `apply()` surfaces at boot. */
export declare class AcpError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Validate and normalize one `exposedModels` filter (order preserved,
 * duplicates dropped).
 *
 * Shared by the persisted-config validator and the `agent/set-exposed-models`
 * RPC route so the two can never drift apart: a filter the panel can build must
 * be accepted by every layer that sees it — including `loadPersistedAgents`,
 * which re-validates the stored config on every boot (a mismatch there silently
 * drops the whole agent definition).
 */
export declare function normalizeExposedModels(raw: unknown, label: string, code: 'bad_config' | 'bad_payload'): string[];
/**
 * Rebuild the agent tag's halo preference from untrusted input. Only the two
 * enums the settings UI offers are accepted; anything else fails loudly
 * instead of silently switching the tag's look.
 */
export declare function validateTagHalo(value: unknown): AcpTagHalo;
/**
 * Ceiling shared by every approval deadline: one day. Both knobs accept `0`
 * (their meaningful "never" value) and anything up to this, so a range any
 * longer would be a mis-typed number rather than a deliberate window.
 */
export declare const APPROVAL_DEADLINE_MAX_MS = 86400000;
/**
 * Validate ONE approval deadline, shared by every layer that accepts one.
 *
 * Three callers, one gate: `validateConfig` (the `cordis.patch.yml` baseline),
 * `validateApprovalDeadlines` (the settings-page write), and
 * `BridgeManager.loadPersistedAgents` (the persisted override, re-validated on
 * every boot because the state file is user-editable). They must agree — a
 * value the panel can save has to survive the next boot, or the setting would
 * silently revert.
 */
export declare function validateApprovalDeadlineMs(raw: unknown, label: string, code: 'bad_config' | 'bad_payload', hint: string): number;
/**
 * Validate a settings-page deadline write. Omitted keys are simply absent from
 * the result — the manager merges, so a card that only touched one slider must
 * not reset the other. `reset` is not a deadline and is dropped here.
 */
export declare function validateApprovalDeadlines(value: unknown): Partial<Record<ApprovalDeadlineKey, number>>;
/**
 * Validate one agent's `mcpServers` list (the plugin's normalized shape, NOT
 * the ACP wire shape).
 *
 * THE ENTRIES ARE RETURNED AS THE USER WROTE THEM — not rebuilt, not
 * defaulted. That is deliberate: the settings panel holds this list as JSON
 * text, and it compares what it would send against what the host stored. A
 * host that reshaped the entries (filling `args: []`, reordering the keys)
 * would make the panel report a change where there is none, and the card
 * would never come clean. So this function VALIDATES and leaves the shape
 * alone; the ACP wire conversion (src/bridge.ts) supplies the defaults the
 * protocol wants.
 *
 * The ACP-transport variant is rejected rather than ignored: it needs the
 * client side of `mcp/message`, which is not in the ACP SDK's stable surface,
 * and no agent advertises `mcpCapabilities.acp`. Accepting it would produce a
 * server the agent can never reach.
 */
export declare function validateMcpServers(raw: unknown, label: string, code: 'bad_config' | 'bad_payload'): AcpMcpServerDef[];
/**
 * Split a command line into tokens, the way a shell would: whitespace
 * separates, single or double quotes group.
 *
 * Inside double quotes a backslash escapes a quote (`\"`) and is otherwise
 * LITERAL — Windows paths are full of backslashes, so treating `\` as a general
 * escape would mangle `"C:\Program Files\agent.exe"`. Best-effort only: an
 * unbalanced quote swallows the rest of the line, which is the same thing a
 * shell does and is reported by the caller as a missing executable.
 */
export declare function tokenizeCommandLine(raw: string): string[];
/** First token = program, rest = arguments (see {@link tokenizeCommandLine}). */
export declare function splitCommandLine(raw: string): {
    command: string;
    args: string[];
};
/** Quote one token for a command line — only when it needs it. Inverse of the tokenizer. */
export declare function quoteCommandToken(token: string): string;
/**
 * Validate a single agent definition object.
 *
 * `command` is a COMMAND LINE: the whole thing a user would type in a terminal
 * (`codebuddy --acp`) belongs in that one field, and its extra tokens are folded
 * IN FRONT of `args`. Two reasons this is the host's job and not the panel's:
 * `agent/save` / `agent/test` are callable without the panel, and
 * `loadPersistedAgents` re-validates stored defs on every boot.
 *
 * The fold is idempotent ONLY for a whitespace-free command. When the command
 * carries whitespace (a quoted Windows path such as `C:\Program Files\a.exe`),
 * the returned `command` is the BARE path — spawn needs it unquoted
 * (`findExecutable` runs `existsSync` on it, `windowsShimLaunch` re-quotes for
 * cmd.exe; both in src/bridge.ts) — so re-validating that bare command splits it
 * at the space instead of round-tripping. `loadPersistedAgents` closes the gap
 * with `quoteLegacyCommand` (src/bridge.ts): it re-quotes the command token
 * before the re-validate, and only when the path exists on disk. Do not "fix"
 * this by quoting `command` here — that breaks the spawn above.
 */
export declare function validateAgentDef(entry: unknown, label?: string): AcpAgentDef;
/** Validate the raw plugin config; throws AcpError on any violation (boot fails loudly). */
export declare function validateConfig(raw: unknown): AcpPluginConfig;
/**
 * Whether `p` is an absolute path on some platform this plugin runs on: POSIX
 * (`/…`), a Windows drive path (`C:\…`, `C:/…`), or a UNC path
 * (`\\host\share…`, `//host/share…`). The extended-length `\\?\…` family is
 * deliberately NOT absolute here — see {@link isExtendedLength}.
 *
 * Style is judged by the string head only, never deeper content: on POSIX both
 * `\` and `C:` are legal filename characters, so a look past the head would
 * misclassify legitimate POSIX paths.
 *
 * This is the host half of the check; the browser's form validation mirrors it
 * as `isAbsolutePathLike` (src/client/acp-ui.tsx) — keep the two in agreement
 * (tests/acp-view.spec.ts asserts equivalence on a shared sample set).
 */
export declare function isAbsolutePath(p: string): boolean;
/**
 * Resolve the requested session cwd against the agent's allowed roots.
 * @param def - validated agent definition.
 * @param requested - browser-supplied cwd (optional; `''`/undefined → default).
 * @param realpath - platform realpath (injected; throws if the path is unusable).
 * @param extraRoots - roots trusted on top of the agent's own ones, for THIS
 *   session only. The one caller that matters is a chat session, whose cwd is
 *   the workspace the user picked in the DSH sidebar: that directory is never in
 *   the agent's configured allow-list (the plugin's own sandbox dir is), yet it
 *   is the session's declared workspace — the root the fs guard confines reads
 *   and writes to. `/acp`-RPC sessions pass none and keep `allowedCwdRoots` as
 *   a hard cap.
 * @returns the canonical absolute directory to hand to `session/new` (POSIX
 *   spelling on Windows too: `\` folded to `/`).
 */
export declare function resolveSessionCwd(def: AcpAgentDef, requested: string | undefined, realpath: (p: string) => string, extraRoots?: readonly string[]): string;
/**
 * Canonicalize a path requested by an ACP agent (fs/read_text_file,
 * fs/write_text_file) against the session workspace — no containment check.
 *
 * Relative paths join under `sessionCwd`; the collapsed path is canonicalized
 * by realpath up to the nearest existing ancestor (collapsing symlinks and any
 * surviving `..`), with the missing tail re-attached lexically — so a fresh
 * write target with not-yet-created parent directories still validates, and a
 * symlink pointing outside the workspace resolves to its real location (where
 * the containment check then judges it).
 *
 * Windows spellings work throughout: an absolute drive/UNC request keeps its
 * own head, a relative request folds `\` when the session cwd is
 * Windows-style, and the result comes back in the folded `/`-separated form.
 */
export declare function canonicalizeFsPath(sessionCwd: string, requested: string, realpath: (p: string) => string): string;
/**
 * {@link canonicalizeFsPath} plus the allowed-root containment check: a path
 * outside the given `roots` throws (`cwd_denied`) and the caller answers the
 * agent's request with that error instead of touching the disk.
 *
 * The containment is UNCONDITIONAL — there is deliberately no access-mode layer
 * here. The one caller (`guardFsPath` in src/bridge.ts) always passes the
 * agent's own `allowedCwdRoots` plus the session cwd as a hard cap; a DSH
 * access mode such as `danger-full-access` never reaches this path and never
 * lifts the cap.
 */
export declare function resolveFsPath(sessionCwd: string, roots: readonly string[], requested: string, realpath: (p: string) => string): string;
/**
 * The agent is a peer process, not a DSH sub-agent: it inherits the host
 * environment exactly as a native tool would, and the agent's configured env
 * wins per key on top.
 */
export declare function childEnv(parent: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string>;
/**
 * Extract select options from a raw ACP `configOptions` payload.
 *
 * `model`, `thought_level` and `mode` get dedicated slots. Every OTHER select
 * with at least one choice lands in `extras` (deduped by `configId`, last
 * definition wins) — that is what the composer's advanced base lists and sets.
 * Tolerant by design: unknown categories, boolean options, grouped choices,
 * missing `name`, and the legacy `id` field (pre-spec agents) are all handled;
 * anything unusable is skipped silently.
 */
export declare function parseCatalogOptions(configOptions: unknown): AcpAgentCatalog;
/**
 * Fold one per-session option answer's SHAPE into an agent-level catalog.
 *
 * `session/set_config_option` answers are often the ONLY place an agent
 * publishes how its option set changes with the model — opencode offers
 * `thought_level` (`effort`) just for models with variants and never
 * re-notifies after a client-driven set — and the composer's thought chip is
 * driven by the agent-level catalog. What is agent knowledge there is the
 * SHAPE (which slots exist, which choices they offer); `currentValue` is not:
 * in a per-session answer it is that session's pick, and promoting it would
 * turn one conversation's choice into `reasoning.defaultEffort` for every
 * other one. A merged slot therefore keeps the catalog's known current value
 * while the observed choices still offer it, and `null` ("the agent's own
 * default") otherwise. Slots the answer does not mention are left alone — a
 * different model may still offer them.
 */
export declare function mergeCatalogShape(existing: AcpAgentCatalog | undefined, observed: AcpAgentCatalog): AcpAgentCatalog;
/**
 * Size ceiling for one `configOptions` answer to be believed. Normal answers
 * are a few KB (a 500-model catalog is well under this); beyond it the agent is
 * misbehaving and absorbing/persisting it would turn every notification into
 * an unbounded write.
 */
export declare const MAX_CONFIG_OPTIONS_BYTES: number;
/**
 * Whether a `configOptions` answer may overwrite known state.
 *
 * An EMPTY (or absent) answer is a non-answer: observed agents return
 * `configOptions: []` in intermediate states, and treating that as "this agent
 * now has no options" would wipe a perfectly good catalog and session
 * snapshot for a state that passes (the rule OmniTerm settles on for the same
 * observation — empty sets never overwrite the last known state). Oversized
 * answers are dropped for the same reason: see {@link MAX_CONFIG_OPTIONS_BYTES}.
 */
export declare function usableConfigOptions(configOptions: unknown): configOptions is unknown[];
/**
 * Split an adapter model id into its agent id and optional model choice.
 * `@` is the separator because agent ids are restricted to `[a-z0-9._-]`.
 */
export declare function splitAdapterModelId(model: string): {
    agentId: string;
    choice?: string;
};
/** Inverse of {@link splitAdapterModelId} for variant entries. */
export declare function buildAdapterModelId(agentId: string, choice: string): string;
/**
 * Tool activity as REAL `tool-call` blocks, one driver step per tool activity.
 *
 * The ordering problem (docs/acp-convergence.md §1.7) is solved by SEGMENTING
 * the turn, not by prose: the adapter ends its stream when a tool-bearing
 * segment has a card and the next non-tool event arrives, the host settles the
 * assistant message, executes the card (the guard's virtual tool answers with
 * the agent's real output from the shared registry), and its agent loop then
 * proposes the continuation step — whose stream() call resumes reading the SAME
 * in-flight `session/prompt` from the transcript cursor. Cards therefore sit
 * between two assistant messages, exactly like a native multi-step turn.
 */
/**
 * One ACP tool call, narrowed to what the Chat plane's tool-call renderer shows.
 *
 * `callId` is the ACP `toolCallId` — it is the only identity the agent gives, and
 * the Chat renderer uses it to group a call with its updates. `name` is the
 * agent's own label (`title`, falling back to nothing at all: the renderer shows
 * the call id when a name is missing). `argsRaw` accumulates whatever the agent
 * chose to disclose — ACP has no mandatory arguments field, so an agent that
 * sends none simply produces an empty block, which is honest.
 */
export interface AcpToolCallSnapshot {
    callId: string;
    name: string;
    /** Accumulated argument text (ACP has no fixed vocabulary for it). */
    argsRaw: string;
}
/** A delta of tool-call content, folded into the open snapshot. */
export type AcpToolCallDelta = {
    kind: 'name';
    name: string;
} | {
    kind: 'args';
    text: string;
};
/**
 * The argument text an ACP tool-call notification carries, if any.
 *
 * Accepts the spellings seen in the wild (`rawInput` / `arguments` as a string,
 * an object, or an ARRAY of inputs) and refuses to invent one: an agent that
 * sends no arguments gets `''`, which renders as an empty card rather than a
 * fabricated placeholder.
 */
export declare function acpToolCallArgsOf(update: Record<string, unknown>): string;
/**
 * Fold one ACP `tool_call` notification into a snapshot.
 *
 * `rawInput` / `arguments` are accepted when present: some agents send structured
 * input, and a tool card that cannot show its arguments is half a card. Anything
 * else is ignored — a tool call with only an id and a title is legal ACP.
 */
export declare function acpToolCallFromUpdate(update: Record<string, unknown>): AcpToolCallSnapshot | undefined;
/**
 * Fold one ACP `tool_call_update` into an open snapshot, in place.
 *
 * ACP updates carry FULL replacement snapshots (`rawInput` restated in whole on
 * every change), while the host's accumulator CONCATENATES `argumentsDelta` —
 * so the deltas produced here are the extension suffix only, and the snapshot
 * itself always moves to the latest known text (the closing `block-end` frame
 * replaces the block wholesale, which is what makes a non-extension update
 * land correctly in the settled card).
 */
export declare function acpToolCallDelta(snapshot: AcpToolCallSnapshot, update: Record<string, unknown>): AcpToolCallDelta[];
/**
 * Whether this request is the CONTINUATION step of a turn whose previous step
 * settled with tool-call blocks — which is exactly what the ACP agent's display
 * cards are. The host agent-loop starts a next step whenever the settled
 * assistant message contains `tool-call` blocks, feeding it the staged tool
 * results: the request's message list then has `tool`-sourced messages AFTER
 * the last user-sourced one. A fresh prompt never does (the person's new words
 * are the last message); history from earlier turns sits before the new user
 * text, so it cannot trip this.
 *
 * The adapter answers such a step by resuming the SAME in-flight ACP prompt
 * from the transcript cursor instead of sending a new one (see
 * `BridgeManager.streamPrompt` and docs/acp-convergence.md §1.7).
 */
export declare function isAcpToolContinuation(messages: readonly {
    source?: {
        kind?: string;
    };
}[]): boolean;
/** One structured edit as plain text: its path, then `-`/`+` lines with three lines of context. */
export interface AcpDiffPayload {
    path: string;
    oldText: string | null;
    newText: string;
}
/** One folded piece of a tool call's `content`. */
export type AcpContentRow = {
    kind: 'text';
    text: string;
}
/** Structured edits are kept apart: flattening them to `diff <path>` throws away the review. */
 | {
    kind: 'diff';
    diff: AcpDiffPayload;
}
/** A kind we cannot render. `json` carries the whole item, so nothing the agent sent is lost. */
 | {
    kind: 'other';
    label: string;
    json: string;
};
/**
 * Fold one ACP tool-call content item, preserving everything.
 *
 * The caller decides how to render a `text` / `diff` / `other` row; the one rule
 * here is that no shape may vanish. ACP agents in the wild send kinds beyond the
 * spec's `content` / `diff` / `terminal` (observations, images, links, custom
 * rows), and an item we do not understand is still something the agent said —
 * it rides along as `other` with its full JSON rather than disappearing.
 */
export declare function acpContentRows(content: unknown): AcpContentRow[];
/**
 * The plain text of one tool payload: text as-is, diffs as a per-file header
 * plus its removed/added lines (`-`/`+`), other kinds as their full JSON. This
 * replaces the old `[diff path]` / `[terminal id]` placeholders — those names
 * the block and drop everything else the agent said.
 *
 * It doubles as what the guard's virtual tools answer the host loop with, so
 * both the card and the executed result read the same thing.
 */
export declare function updateContentToText(content: unknown): string;
/** One structured edit as readable text: `path`, then `-`/`+` lines plus unchanged context. */
export declare function formatAcpDiff(diff: AcpDiffPayload): string;
/** Cap on one tool call's raw notification. Large enough for big `content` arrays; the cut is marked. */
export declare const ACP_TOOL_RAW_MAX = 256000;
/** Pretty-printed JSON of an agent message, truncated only at {@link ACP_TOOL_RAW_MAX}. */
export declare function dumpJson(value: unknown): string;
/** Notification kinds that are routine state, not content: they update the session view and nothing else. */
export declare const BOOKKEEPING_UPDATES: ReadonlySet<string>;
/**
 * Human-readable text of an ACP notification this build has no card of its own
 * for. The text is what the native chat stream shows and what the guard answers
 * the host loop's execution of that card with, so it must carry the payload —
 * a plan's entries, an unknown kind's whole JSON — rather than only a name.
 *
 * The routine bookkeeping kinds (`current_mode_update`, `available_commands_update`,
 * and the rest of `BOOKKEEPING_UPDATES`) never reach this function on the live
 * path: `streamPrompt` drops them before it announces a kind inline — it is the
 * only caller. The two branches below that name them are a defensive fallback
 * for a direct caller, NOT a live route into the chat stream.
 */
export declare function describeUnhandledUpdate(kind: string, update: Record<string, unknown>): string;
/**
 * Outcome of picking the one message an ACP turn forwards.
 *
 * `no-user-input` is its own case, not an error: the host wakes a driver for
 * injected context too (goal/subagent/skill material), and that turn carries no
 * user intent to send anywhere.
 */
export type ForwardPromptSelection = {
    kind: 'prompt';
    text: string;
    id?: string;
} | {
    kind: 'no-user-input';
} | {
    kind: 'empty';
};
/**
 * Select the user's own words out of a host-built request.
 *
 * Why this exists (AGENTS.md rule 16): the host appends its context sections
 * *after* the claimed user batch — `agent-instructions` folds its digest right
 * behind the prompt, and the driver appends the runtime-context snapshot after
 * that — so "the last user-role message" is routinely an injected section, not
 * the prompt. Only the message's `source` distinguishes them: `kind: 'user'` is
 * the person, anything else (`plugin`, `skill-catalog`, `agent-instructions`,
 * `tool`, …) is harness context. An absent source means a hand-built request
 * (tests, headless callers) and counts as user input.
 *
 * @param messages - the request's ordered messages, exactly as the host built them.
 * @returns the last real user message's text, or why there is none to forward.
 */
export declare function selectForwardPrompt(messages: readonly {
    role: string;
    content?: Array<{
        type?: string;
        text?: string;
    }>;
    source?: {
        kind?: string;
    };
    id?: string;
}[]): ForwardPromptSelection;
/** Structural read of ACP `ToolCall.kind`; anything unexpected stays `undefined` (= effect unknown). */
export declare function permissionToolKind(toolCall: unknown): string | undefined;
/** Structural read of ACP `ToolCall.locations[].path` — where an edit claims it will write. */
export declare function permissionToolPaths(toolCall: unknown): string[];
/**
 * Lexical containment test: does `path` equal or live under `root`?
 *
 * Both sides go through the compare form (win32-style paths get `\` folded to
 * `/` and case dropped; POSIX stays byte-exact), so a disk-derived canonical
 * path compares against a configured root regardless of which spelling each
 * arrived in — `C:\work` and `\\host\share` contain their `c:/work/…` and
 * `//host/share/…` children, while `/work2` still does not pass under `/work`
 * anywhere. A root of `/` contains every POSIX absolute path and nothing
 * Windows-shaped; any other non-absolute root contains nothing.
 */
export declare function isUnderPath(path: string, root: string): boolean;
/**
 * The slice of a host session log the preset fold reads.
 */
export interface SessionLogLike {
    events?: readonly unknown[];
    /** Creation header; carries the agent preset the session started under. */
    header?: {
        agentPreset?: unknown;
    };
}
/**
 * The agent preset a session actually runs.
 *
 * Mirrors `resolveSessionPreset` from `@deepseek-ai/dsh-agent-presets`
 * structurally (no dependency): the newest `agent-preset/selected` log event
 * wins over the creation-time header, because a blank session may be recomposed
 * and the header is by design a frozen creation fact.
 *
 * This is how the host half knows a chat session is in ACP mode: the mode IS an
 * agent preset, so reading it back from the session log is the only honest
 * source — a marker we set ourselves could drift from what the roster mounted.
 */
export declare function sessionAgentPreset(session: SessionLogLike | undefined): string | undefined;
/**
 * Fold a preset from a RAW stored header plus already-decoded log events —
 * the cold-read path: `sessionPersistence` hands back the header verbatim and
 * `SessionHandle.read` returns raw event objects, neither of which is a host
 * `Session`, so {@link sessionAgentPreset} does not apply.
 */
export declare function sessionAgentPresetFromLog(headerPreset: unknown, events: readonly unknown[]): string | undefined;
/** Where the ACP-mode preset is declared inside this package. */
export declare const ACP_PRESET_SOURCE = "dsh-ntr-plus/presets/acp/acp.patch.yml";
/** One harness preset-roster row (structurally `AgentPresetRow`; no dependency). */
export interface RosterPresetRow {
    id: string;
    /** Why this preset cannot compose a session; absent when it can. */
    broken?: unknown;
}
/**
 * Fold the harness's preset roster into the panel's preset status.
 *
 * WHY the roster is the only honest source: the ACP mode IS an agent preset, and
 * this package only *declares* it (a `preset-<id>` row in its own bundle patch).
 * Whether that declaration reached the roster, and whether it can compose a
 * session, is the harness's state — a file we ship cannot answer it, and a
 * failed activation stays on the roster with a diagnostic rather than
 * disappearing, which is exactly the case the panel must show.
 *
 * @param rows - the roster as read from the harness, or `undefined` when the
 *   roster could not be read at all (a host without the registry service) —
 *   the caller then hides the block instead of reporting a false negative.
 * @param id - the preset id to look for (`ACP_PRESET_ID`).
 * @returns the status, or `undefined` when the roster is unreadable.
 */
export declare function acpPresetStatusFromRoster(rows: readonly RosterPresetRow[] | undefined, id: string): AcpPresetStatus | undefined;
/** Bounded append-only log of raw ACP session updates with monotone seq. */
export declare class Transcript {
    private readonly max;
    private readonly entries;
    private next;
    constructor(max: number);
    append(update: unknown): number;
    get head(): number;
    since(afterSeq: number): Array<{
        seq: number;
        update: unknown;
    }>;
}
export declare class EventHub {
    private readonly sinks;
    subscribe(sink: (event: AcpEvent) => void): () => void;
    broadcast(event: AcpEvent): void;
}
export interface PendingPermission {
    requestId: string;
    sessionId: string;
    resolve: (outcome: PermissionOutcome) => void;
    /**
     * The ask as the browser was shown it, kept for the REPLAY a reconnecting
     * client receives (see `permissionReplayFrames`). Absent on entries created
     * without a view — those still answer, they just cannot be re-shown.
     */
    view?: {
        toolCall: unknown;
        options: PermissionOptionView[];
    };
}
/** One outstanding ask as a reconnecting client must be re-shown it. */
export interface PendingPermissionView {
    requestId: string;
    sessionId: string;
    toolCall: unknown;
    options: PermissionOptionView[];
}
export declare class PermissionLedger {
    private readonly pending;
    create(sessionId: string, executor: (outcome: PermissionOutcome) => void, view?: PendingPermission['view']): string;
    respond(requestId: string, outcome: PermissionOutcome): true;
    has(requestId: string): boolean;
    settleFor(predicate: (p: {
        requestId: string;
        sessionId: string;
    }) => boolean): string[];
    sessionIds(): Array<{
        requestId: string;
        sessionId: string;
    }>;
    /**
     * Outstanding asks WITH the view the browser was shown, for the reconnect
     * replay. Entries created without a view are skipped: replaying a frame the
     * client cannot render (no title, no options) would show an unanswerable
     * card, which is worse than showing nothing.
     */
    pendingViews(): PendingPermissionView[];
}
/**
 * Frames that re-establish a freshly connected client's view of the pending
 * permission asks: every outstanding ask re-sent as its original
 * `permission/request`, then one `permission/synced` carrying the live id set.
 *
 * Why a replay at all: a `permission/request` is broadcast ONCE, when the ask is
 * created. A client that connects later — page reload, second tab, stream
 * outage — never receives it, and for a ledger ask (the `/acp` RPC path, or a
 * native route that degraded) that card is the ONLY answer entry, so the ask is
 * invisible to exactly the client that needs it. OmniTerm closes the same hole
 * with `PermissionManager::pending_events()` + a `PermissionsSynced` marker on
 * every WS connect.
 *
 * Why the terminator is mandatory: the replay is a snapshot, so an ask resolved
 * while this client was disconnected is not in it. Without the live set the
 * client would keep a stale card forever — the ask is gone host-side and
 * `respond` would answer `unknown_request`.
 */
export declare function permissionReplayFrames(pending: readonly PendingPermissionView[]): AcpEvent[];
/** The bridge-manager face the dispatcher talks to (interface keeps dispatch pure-testable). */
export interface AcpManager {
    agentViews(): AgentView[];
    startSession(agentId: string, cwd: string | undefined): Promise<{
        sessionId: string;
    }>;
    prompt(sessionId: string, text: string): Promise<{
        turnId: string;
    }>;
    cancel(sessionId: string): Promise<void>;
    closeSession(sessionId: string): Promise<void>;
    setMode(sessionId: string, modeId: string): Promise<void>;
    setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void>;
    respondPermission(requestId: string, optionId: string | undefined): void;
    transcript(sessionId: string, afterSeq: number | undefined): {
        session: unknown;
        entries: Array<{
            seq: number;
            update: unknown;
        }>;
    };
    sessions(): unknown[];
    stopAgent(agentId: string): Promise<void>;
    /**
     * The plugin's OWN default ACP agent (the panel's ★ gesture): which agent an
     * ACP-mode conversation should start on. Deliberately NOT a DSH model route:
     * nothing in this plugin writes the host's model selection (see
     * docs/acp-convergence.md §2.2).
     */
    defaultAgent?(): string | undefined;
    /** Set (or clear, with `undefined`) the default ACP agent. */
    setDefaultAgent?(agentId: string | undefined): Promise<void>;
    /** The agent tag's halo preference (composer display, plugin-private). */
    tagHalo?(): AcpTagHalo;
    /** Write the halo preference (persisted with the agent registry). */
    setTagHalo?(halo: AcpTagHalo): Promise<void>;
    /**
     * The approval deadlines in force, with the facts that explain an override
     * (the `cordis.patch.yml` baseline it outranks, and a `permissionTimeoutMs`
     * that overrides both). `undefined` on a host half from before the card
     * existed, which hides the settings card instead of guessing a value.
     */
    approvalDeadlines?(): AcpApprovalDeadlines | undefined;
    /**
     * Write one or both approval deadlines (omitted keys keep their value), or
     * drop the persisted override with `reset` so the config-file baseline
     * applies again. Applies to the running bridges without a restart.
     */
    setApprovalDeadlines?(patch: Partial<Record<ApprovalDeadlineKey, number>>, reset?: boolean): Promise<void>;
    detectAgents?(): Promise<DetectedAgentInfo[]>;
    saveAgent?(def: AcpAgentDef): Promise<void>;
    deleteAgent?(agentId: string): Promise<void>;
    /**
     * Spawn a throwaway process from raw form values (never persisted, never
     * registered), run the ACP handshake, tear it down, and report the outcome.
     * May trigger the def's npm auto-install.
     */
    testAgent?(def: AcpAgentDef): Promise<AgentTestResult>;
    /** Update which probed model choices the ACP seats offer; `undefined` clears the filter. Must not restart the agent. */
    setExposedModels?(agentId: string, exposedModels: readonly string[] | undefined): Promise<void>;
    /** Toggle auto-discovery of newly published models. Must not restart the agent. */
    setAutoDiscoverModels?(agentId: string, autoDiscoverModels: boolean): Promise<void>;
    probeAgentModels?(agentId: string): Promise<AgentProbeModelsResult>;
    /**
     * The ACP model surface for one agent (the seats' data source): base entry,
     * the `exposedModels` variants, and the agent's own reasoning efforts.
     * Memory-only — never spawns and never probes: an agent without a cached
     * catalog is reported with `probed: false` and whatever (possibly empty)
     * content memory holds, NOT probed on read. A catalog is filled only by
     * `agent/probe-models` (the settings-card button) and by the agent's own
     * `session/new` / `session/load` — reading the seat must never start a
     * process, or opening the page would launch every configured agent.
     */
    agentCatalog(agentId: string): AgentCatalogResult;
    /**
     * The last catalog observed for one agent, or `undefined` when it has never
     * published one. Memory-only (hydrated from disk at boot), never spawns.
     *
     * This is the settings panel's mount read: it fills the model panes with the
     * already-configured selection and the last known model list, so a cache hit
     * is visible without clicking 「检测可用模型」. That button only REFRESHES the
     * cache (newly published models appear, withdrawn ones drop out).
     */
    cachedAgentModels?(agentId: string): AgentProbeModelsResult | undefined;
    /**
     * True when ACP permission asks are routed to the host's native approval
     * service (answered in the chat composer) instead of the settings-panel
     * ledger. Read-only capability report for `agents/list`.
     */
    approvalRouting?(): boolean;
    /**
     * ACP agent sessions backing one DSH chat session (looked up by chat session
     * id), so the composer can offer the agent's OWN mode list. Empty when no
     * agent has run in that chat yet.
     */
    chatSessions?(dshSessionId: string): ChatSessionView[];
    /**
     * Whether ONE DSH chat session runs the ACP agent preset (asked by chat
     * session id). Read-only report for `session/chat-list`; the browser's
     * model-seat gate falls back to it when the client session list does not
     * carry `agentPreset` on its rows.
     */
    chatSessionAcpMode?(dshSessionId: string): boolean;
    /**
     * Awaitable verdict for `session/chat-list`: waits out the cold read behind
     * the synchronous probe, so the browser's one-shot fallback sees the settled
     * answer on the FIRST response instead of a premature `false`.
     */
    chatSessionAcpModeAnswer?(dshSessionId: string): Promise<boolean>;
    /**
     * Drop the cached ACP-mode verdict for one session (or all). The gate's
     * `session/chat-list` path calls this before answering so a preset switch is
     * never masked by a stale cached negative (see the chat-list handler).
     */
    invalidateAcpMode?(dshSessionId?: string): void;
    /**
     * Every ACP session transcript belonging to one DSH chat session, so the
     * conversation can render the agent's real stream (tool calls, plans,
     * diffs) in its own view tab. Read-only: never spawns, never resumes.
     */
    chatTranscripts?(dshSessionId: string, afterSeq?: number): ChatTranscriptView[];
    /**
     * Switch one chat-bound ACP session's mode (`session/set_mode`). `agentId`
     * disambiguates when more than one agent has run in the same chat session;
     * without it the live (non-released) session is picked.
     */
    setChatSessionMode?(dshSessionId: string, modeId: string, agentId?: string): Promise<void>;
    /**
     * Point one DSH chat conversation at an ACP agent — the plugin's own
     * conversation↔agent mapping, never a DSH model route (see
     * `BridgeManager.bindChatAgent`).
     */
    bindChatAgent?(dshSessionId: string, agentId: string): void;
    /**
     * The ACP agent one DSH chat conversation is pointed at — the recorded intent
     * when there is one, else the agent an existing ACP session for that
     * conversation is already served by. The composer's chip and picker read this
     * so a switch shows BEFORE the next turn materializes it.
     */
    chatAgentFor?(dshSessionId: string): string | undefined;
    /**
     * The agent one DSH chat conversation is LOCKED to after its first ACP turn,
     * if any. Read-only report for `session/chat-list`: the composer hides its
     * agent picker and shows the locked agent instead. Unlike `chatAgentFor`,
     * this deliberately ignores the roster — a deleted agent still owns the
     * conversation's context.
     */
    lockedAgentFor?(dshSessionId: string): string | undefined;
    /**
     * The conversation's whole persisted pick — agent, model, thought level —
     * readable BEFORE the conversation has an ACP session. This is what makes a
     * conversation set up ahead of its first message report that set-up instead
     * of the agent's defaults.
     */
    chatChoice?(dshSessionId: string): AcpConversationChoice | undefined;
    /** Switch the bound agent's model (`agentId@choice`) for one chat session. */
    setChatSessionModel?(dshSessionId: string, modelId: string): Promise<void>;
    /** Switch the reasoning effort for one chat session (agentId names the default-agent case). */
    setChatSessionEffort?(dshSessionId: string, effort: string | undefined, agentId?: string): Promise<void>;
    /** Set one of the agent's EXTRA config options for one chat session. */
    setChatSessionConfig?(dshSessionId: string, configId: string, value: string | boolean, agentId?: string): Promise<void>;
    /**
     * State of the ACP-mode agent preset in the harness's OWN roster. Read-only
     * report for the settings panel: the preset is a declaration this package
     * ships (a bundle patch), so there is nothing to install — but a declaration
     * whose activation failed stays on the roster with its diagnostic, and that
     * has to be visible somewhere the user can act on it.
     *
     * Answers `undefined` when the roster cannot be read at all (a host without
     * the registry service), which hides the panel block instead of guessing.
     */
    presetStatus?(): Promise<AcpPresetStatus | undefined>;
}
/** Dispatch one decoded `/acp` channel call. Never rejects; protocol errors come back as `ok:false`. */
export declare function dispatchRpc(manager: AcpManager, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>;
