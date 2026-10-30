/**
 * ACP client bridge: one child process per configured agent definition,
 * multiplexing any number of ACP sessions over the stdio connection.
 *
 * The browser NEVER reaches this layer directly; it goes through the `/acp`
 * Connection RPC channel (authenticated) into `BridgeManager`, which is the
 * only object allowed to spawn a configured command.
 */
import { type InitializeResponse } from '@agentclientprotocol/sdk';
import { EventHub, PermissionLedger, Transcript } from './impl.ts';
import type { AcpToolCallSnapshot, PendingPermissionView, RosterPresetRow } from './impl.ts';
import type { AcpAgentCatalog, AcpAgentDef, AcpApprovalDeadlines, AcpConversationChoice, AcpPresetStatus, AcpTagHalo, AgentCatalogResult, AgentProbeModelsResult, AgentTestResult, AgentView, ChatSessionView, ChatTranscriptView, DetectedAgentInfo, GenerateOptions, LlmAdapterLike, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ApprovalDeadlineKey, PreparedAdapterCall, SessionView, StreamChunk } from './protocol.ts';
interface LiveSession {
    /** Host-minted id (stable across an agent restart; the ACP id is per-connection). */
    sessionId: string;
    agentId: string;
    acpSessionId: string;
    cwd: string;
    title?: string;
    /**
     * The adapter model id this session was last aligned to (`agentId` /
     * `agentId@choice`). Recorded here so the browser can show "which model is
     * this conversation on" from `session/chat-list` alone — the plugin's own
     * binding, not a DSH model route.
     */
    modelId?: string;
    /** The model choice portion of {@link modelId}, when it carries one. */
    choice?: string;
    /** The reasoning effort in force for this session, when one applies. */
    reasoningEffort?: string;
    modes?: SessionView['modes'];
    configOptions?: unknown[];
    availableCommands?: SessionView['availableCommands'];
    plan?: unknown[];
    usage?: SessionView['usage'];
    running: boolean;
    closed: boolean;
    /** The agent process died; the session awaits a `session/load` resume. */
    released: boolean;
    /**
     * Owning DSH chat session id, when the session was opened through the LLM
     * adapter (`AcpLlmAdapter`). `ctx.agents.get()` needs it to name the agent
     * whose open turn carries the native approval question; sessions started
     * over the `/acp` RPC have no chat session and stay on the ledger path.
     */
    dshSessionId?: string;
    /**
     * True when this chat session runs on the ACP-mode agent preset, re-resolved
     * every turn. It is a report for the browser surfaces (which conversation are
     * we in), not a policy switch: an ACP agent decides its own permissions, so
     * the host arbitrates nothing (see docs/acp-convergence.md §2.3).
     */
    acpMode?: boolean;
    /**
     * Resolves when the AGENT has settled the turn it is currently running (its
     * `session/prompt` response, or its acknowledgement of a cancel). This is
     * deliberately not `running`: an aborted turn ends our stream at once,
     * while the agent keeps working until it observes the cancel — and the ACP
     * protocol forbids a second `session/prompt` on a busy session.
     */
    settled?: Promise<void>;
    /**
     * The resolver of {@link settled}, kept alongside so turn-scoped force
     * finalization (the cancel fallback) can open the gate without owning the
     * stream. Cleared by the same settler that clears {@link settled}.
     */
    settledResolve?: () => void;
    /**
     * This session's first turn wrote the conversation's agent lock just now
     * (the conversation had none before). The lock is provisional until that
     * turn produces a visible block: a first turn that delivers nothing — an
     * error, a silent provider failure folded into a normal stop, or even a
     * cancel — rolls the lock back and closes this session, so the user can
     * choose another agent. Cleared as soon as the first turn settles.
     */
    provisionalLock?: boolean;
    /**
     * Monotonic per-session counter, bumped at every turn start (both the
     * `/acp` RPC path and the adapter's `streamPrompt`). Turn-scoped timers —
     * the cancel fallback — capture it when armed and compare when they fire:
     * a timer whose generation has moved on belongs to a turn that already
     * ended, and must not force-finalize the LATER turn now on air.
     */
    turnSeq: number;
    /**
     * The {@link turnSeq} of the turn `session/cancel` was last called for.
     * A `cancelled` stopReason on a turn whose generation does not match is
     * not the user's cancel: some agents answer the NEXT prompt with the
     * PREVIOUS cancel while still cleaning up (the stale-cancel swallow), and
     * that answer means the message was silently dropped.
     */
    cancelRequestedAtTurn?: number;
    transcript: Transcript;
}
/** Reliability tuning, threaded from `AcpPluginConfig` through the manager. */
export interface BridgeTuning {
    startupTimeoutMs?: number;
    permissionTimeoutMs?: number;
    /**
     * Deadline for a permission ask whose native route DEGRADED to unavailable
     * (see {@link LedgerFallbackReason}). Applies when `permissionTimeoutMs` is
     * 0 — its "approvals belong to a person, wait forever" default — because a
     * degraded ask has no visible answer entry in the conversation the user is
     * looking at, and waiting forever would hang the turn on a question nobody
     * can see there. The DESIGNED ledger paths (no approval service at all, a
     * session with no chat identity) keep waiting: their answer entry is the
     * settings panel, which is exactly where the chat line sends the user. `0`
     * disables even this fallback.
     */
    permissionFallbackTimeoutMs?: number;
    /**
     * Deadline for the NATIVE approval route itself: how long
     * {@link AgentBridge.askNativeApproval} waits for the host approval chain to
     * answer before withdrawing the ask and handing it to the settings-panel
     * ledger (`native-timeout`, see {@link LedgerFallbackReason}).
     *
     * A routed ask shows no card and broadcasts no frame — the composer takeover
     * IS the answer entry — so a host that accepts the question and then never
     * renders it (answerer absent from the browser scope, the conversation not
     * mounted, a client that never received the remote event) leaves the turn
     * hanging behind a question the user cannot see anywhere. The deadline is
     * what makes that state bounded: past it the ask is withdrawn (the request
     * signal is aborted, which settles the host ask `cancelled`) and re-asked on
     * the ledger, where the chat line and the settings card are both visible.
     *
     * This is NOT an answer on the human's behalf: a human mid-decision simply
     * finds the same question in the settings panel. `0` disables it (wait for
     * the host forever).
     *
     * Default 300000 ms — the SAME window as
     * {@link BridgeTuning.permissionFallbackTimeoutMs}, so "this route is not
     * working" is one number instead of two arbitrary ones. A takeover that is
     * going to render does so immediately, and the host replays a pending
     * approval across reconnects (verified live on DSH web 0.2.1-rc.2), so the
     * deadline only ever fires for a host that took the question and never showed
     * it. OmniTerm's equivalent is its reaper's permission-timeout threshold
     * (30 min default, 30 s steps, hot-updatable); this is the same knob without
     * their `auto` tier, which this plugin does not have (every ask must reach a
     * human).
     */
    nativeApprovalTimeoutMs?: number;
    cancelFallbackMs?: number;
    /**
     * How long to wait before resending a prompt the agent answered `cancelled`
     * although no cancel was requested for that turn — the stale-cancel swallow
     * (codebuddy answers the NEXT prompt with the PREVIOUS cancel while it is
     * still cleaning up). The delay must outlast the agent's cleanup window;
     * measured at 250ms on codebuddy 2.161.4, so the default is 600ms.
     */
    staleCancelRetryDelayMs?: number;
    /** How many times a stale-cancelled prompt is resent before giving up. */
    staleCancelMaxRetries?: number;
    /**
     * How long a new turn waits for the agent to settle a predecessor that is
     * still running on its side (an aborted turn we already stopped streaming).
     * Zero disables the wait: the next prompt then fails immediately rather than
     * racing a concurrent `session/prompt` into the agent.
     */
    turnSettleMs?: number;
    /**
     * Default idle-release window for agents without their own
     * `AcpAgentDef.idleTimeoutMs`: a READY process that holds no live session
     * and has no work in flight is killed after this long. `0` disables it.
     */
    idleTimeoutMs?: number;
    /**
     * Idle-release window for a bridge that has NEVER hosted a real session —
     * i.e. a process a model-catalog probe spawned (probes bypass session
     * bookkeeping). Applies before and instead of `idleTimeoutMs`/`def.idleTimeoutMs`:
     * those express how long a CHAT process waits for its next message, which a
     * probe-only process has no stake in. `0` disables it.
     */
    probeIdleTimeoutMs?: number;
}
/** One native approval question, as the host approval service defines it. */
export interface ApprovalRequestContext {
    /** DSH chat session that owns the open turn the question is asked in. */
    dshSessionId?: string;
    agentId: string;
    /** Human-facing identity of the operation awaiting a decision. */
    toolName: string;
    reason?: string;
    signal?: AbortSignal;
}
/** Outcome vocabulary of the host approval chain (`'unavailable'` = no answerer). */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
/**
 * Why one permission ask rides the settings-panel ledger instead of the native
 * approval chain, recorded when the ask is broadcast.
 *
 * `no-requester` and `no-chat-session` are the DESIGNED ledger paths: a host
 * without the approval service, and an `/acp`-RPC session that has no chat
 * turn to route into. `unavailable` is a DEGRADATION — the service is wired
 * and this ask still failed, so the conversation the user is looking at will
 * never show the question. `native-timeout` is the other degradation: the host
 * TOOK the question and never answered it inside
 * {@link BridgeTuning.nativeApprovalTimeoutMs}, so it is withdrawn and re-asked
 * here. The last two decide both the chat line's wording (see
 * `BridgeManager.streamPrompt`) and whether a deadline is armed
 * ({@link AgentBridge.handlePermissionRequest}).
 */
export type LedgerFallbackReason = 'no-requester' | 'no-chat-session' | 'unavailable' | 'native-timeout';
/** One recorded ledger fallback: why the ask is here, and the deadline armed for it. */
export interface LedgerFallback {
    reason: LedgerFallbackReason;
    /** Effective deadline in ms; `0` = no timer (wait for the human). */
    timeoutMs: number;
    /**
     * How long the NATIVE route waited before withdrawing this ask, on the
     * `native-timeout` path only. The chat line reports it as an observed fact
     * ("no answer in the conversation within Ns") rather than guessing a cause:
     * a slow human and a host that never rendered the question look identical
     * from here.
     */
    waitedMs?: number;
}
/**
 * Asks the host approval service (`ctx.approval`) for one decision. Never
 * throws: any failure is reported as `'unavailable'` so the caller can fall
 * back to the settings-panel ledger.
 */
export type ApprovalRequester = (request: ApprovalRequestContext) => Promise<ApprovalOutcome>;
/**
 * Resolves the workspace root of one chat session (`dshSessionId` = DSH session
 * id) — the sidebar's selected workspace, which the host's sandbox policy keeps
 * for the session. Never throws; `undefined` means "no workspace available" (an
 * `/acp`-RPC session, an unknown session, or a host without the service), and
 * the caller falls back to the agent's configured cwd.
 */
export type SessionWorkspaceResolver = (dshSessionId: string) => {
    workspaceRoot?: string;
} | undefined;
/** Reports whether one DSH chat session runs the ACP-mode agent preset. */
/**
 * Whether ONE DSH chat session runs the ACP agent preset. May be async: a cold
 * session (the process restarted since its last turn) has to be read from the
 * persistence store, and only the answer is worth the wait — the asker is the
 * browser's seat gate, which polls.
 */
export type AcpModeResolver = (dshSessionId: string) => boolean | undefined | Promise<boolean | undefined>;
type BridgeState = 'stopped' | 'starting' | 'ready' | 'error';
export declare class AgentBridge {
    readonly def: AcpAgentDef;
    private readonly hub;
    private readonly transcriptMax;
    /** Called when the connection dies so the manager can settle outstanding prompts. */
    private readonly onConnectionLost;
    /**
     * Observes `configOptions` from any real session so the manager's model
     * catalog stays warm. `shapeOnly` marks a per-session answer (a
     * `session/set_config_option` response): only the option SHAPE belongs in
     * the agent-level catalog, never its `currentValue` — see
     * {@link BridgeManager.absorbCatalogShape}.
     */
    private readonly onCatalog?;
    /** Observes `availableCommands` from any real session so the agent's slash menu survives its sessions. */
    private readonly onCommands?;
    /**
     * Resolved per ask (not captured) so a requester wired after this bridge
     * was built still applies. Absent → every ask rides the ledger.
     */
    private readonly approvalRequester?;
    /**
     * Resolved per turn, like {@link approvalRequester}: the host entry may
     * wire the access-mode mapping after this bridge was built.
     */
    private readonly sessionWorkspace?;
    state: BridgeState;
    initResult?: InitializeResponse;
    lastError?: string;
    stderrTail: string[];
    private child?;
    private conn?;
    private starting?;
    private readonly sessions;
    private readonly acpIndex;
    /** Sessions whose process died but whose ACP id can be resumed via `session/load`. */
    private readonly released;
    /** Inflight `session/load` resumes, shared so concurrent prompts don't double-resume. */
    private readonly resuming;
    readonly permissions: PermissionLedger;
    /**
     * Why each outstanding ledger ask is on the ledger, keyed by request id and
     * recorded before the `permission/request` broadcast (the hub is
     * synchronous, so a subscriber can read it the moment the frame goes out).
     * Entries live exactly as long as the ask: the ledger's resolve callback
     * deletes them, and every terminal path (answer, timeout, session close,
     * process death) resolves through it.
     */
    private readonly ledgerFallbacks;
    private readonly startupTimeoutMs;
    private readonly permissionTimeoutMs;
    /**
     * The two approval deadlines are NOT readonly, unlike their neighbors: the
     * settings page rewrites them on a running bridge
     * ({@link AgentBridge.applyApprovalDeadlines}), so a user editing the window
     * does not have to kill every live session to see it take effect. Both are
     * read per ask — `nativeApprovalTimeoutMs` when the native ask is armed,
     * `permissionFallbackTimeoutMs` when the ledger ask's deadline is chosen — so
     * a reassignment reaches every ask from that moment on. An ask already
     * holding an armed timer keeps the window it was started with.
     */
    private permissionFallbackTimeoutMs;
    private nativeApprovalTimeoutMs;
    private readonly cancelFallbackMs;
    private readonly staleCancelRetryDelayMs;
    private readonly staleCancelMaxRetries;
    private readonly turnSettleMs;
    private readonly defaultIdleTimeoutMs;
    private readonly probeIdleTimeoutMs;
    /** Armed while READY; fires the idle-release check. */
    private idleTimer?;
    /** Last observable activity; the idle window is measured from here. */
    private lastActivityAt;
    /** Throwaway catalog probes in flight — they hold no live session of their own. */
    private pendingProbes;
    /** Host→agent session commands in flight (mode / config); not turns. */
    private pendingCommands;
    /**
     * Whether a REAL session has ever been registered on this bridge. Probes
     * bypass session bookkeeping, so a bridge that has never hosted anything was
     * spawned by a probe and honors {@link probeIdleTimeoutMs}; the first
     * registered session flips it to the agent's own residency semantics.
     */
    private everHostedSession;
    /** cwd the CURRENT child was spawned with (undefined while there is no child). */
    private spawnCwd?;
    /**
     * Workspace a chat session wants the agent PROCESS to run in (see
     * `ensureReady`). Some agents fix their whole workspace at process start —
     * cwd-derived project state, the environment block they show the model, the
     * files their tools may touch — so `session/new`'s cwd arrives too late for
     * them (observed on codebuddy: it logs `Workspace Path: <process cwd>` before
     * any ACP request is read). For those agents the spawn cwd is the only lever
     * there is.
     */
    private wantedSpawnCwd?;
    constructor(def: AcpAgentDef, hub: EventHub, transcriptMax: number, 
    /** Called when the connection dies so the manager can settle outstanding prompts. */
    onConnectionLost: (bridge: AgentBridge, reason: string) => void, 
    /**
     * Observes `configOptions` from any real session so the manager's model
     * catalog stays warm. `shapeOnly` marks a per-session answer (a
     * `session/set_config_option` response): only the option SHAPE belongs in
     * the agent-level catalog, never its `currentValue` — see
     * {@link BridgeManager.absorbCatalogShape}.
     */
    onCatalog?: ((agentId: string, configOptions: unknown, shapeOnly?: boolean) => void) | undefined, 
    /** Observes `availableCommands` from any real session so the agent's slash menu survives its sessions. */
    onCommands?: ((agentId: string, commands: NonNullable<SessionView["availableCommands"]>) => void) | undefined, tuning?: BridgeTuning, 
    /**
     * Resolved per ask (not captured) so a requester wired after this bridge
     * was built still applies. Absent → every ask rides the ledger.
     */
    approvalRequester?: (() => ApprovalRequester | undefined) | undefined, 
    /**
     * Resolved per turn, like {@link approvalRequester}: the host entry may
     * wire the access-mode mapping after this bridge was built.
     */
    sessionWorkspace?: (() => SessionWorkspaceResolver | undefined) | undefined);
    /**
     * Adopt a rewritten approval deadline (the settings page's write). Only the
     * two degraded-route windows live here; every other tuning value is fixed at
     * construction, because a live bridge cannot meaningfully adopt a new startup
     * or cancel window mid-flight.
     *
     * Deliberately does NOT re-arm anything: an ask that already holds a timer
     * keeps the window it was started with, and the next ask reads the new value.
     * Re-arming would move the goalposts under a human who is already deciding.
     */
    applyApprovalDeadlines(patch: {
        nativeApprovalTimeoutMs?: number;
        permissionFallbackTimeoutMs?: number;
    }): void;
    /**
     * The idle-release window this agent honors for its CHAT process: its own
     * field, else the host default. This is the number the panel prefills and
     * displays (`AgentView.idleTimeoutMs`), so it must keep meaning "the chat
     * residency the user configured" even while the current child is a probe
     * spawn that will actually die much sooner.
     */
    private get idleTimeoutMs();
    /**
     * The window that governs THIS child right now. A bridge that has never
     * hosted a real session exists only because a probe spawned it, and a probe
     * process has no stake in how long a CHAT process may wait for its next
     * message — it gets the short probe window unconditionally (even when
     * `def.idleTimeoutMs` asks for permanent residency, which is a promise about
     * the chat process). The first registered session flips the bridge to the
     * agent's own semantics.
     */
    private get currentIdleTimeoutMs();
    /**
     * Restart the idle-release clock. Every observable activity calls this, so a
     * bridge is only ever released after a FULL quiet window — never while it is
     * being used. Rescheduling here keeps the window measured from the LATEST
     * activity; letting an already-armed timer fire early would not.
     */
    private touch;
    /**
     * Arm the single idle timer for a full window from the last activity. The
     * callback re-checks {@link canIdleRelease} anyway, so a late activity that
     * lands while it runs can only postpone the release.
     */
    private armIdleRelease;
    private clearIdleTimer;
    /**
     * Release a READY agent that has been quiet for a full window. The window is
     * {@link currentIdleTimeoutMs}: the short probe window for a child that has
     * never hosted a session (model-catalog probes and post-save probes spawn
     * exactly such children, see {@link probeConfigOptions}), the agent's own
     * residency window once a real session has landed.
     *
     * Scoped to bridges with no ACTIVE work, not merely no live session: an idle
     * conversation should not keep a process resident forever. Releasing parks its
     * sessions as `released` (not closed), and the next prompt resumes them on a
     * fresh child through `session/load` — the same path a crash uses.
     *
     * `releaseAll` (not `stop`) is the right teardown: `stop` drops resumable
     * records, which would destroy the context of sessions parked by an earlier
     * crash just because this bridge went quiet.
     *
     * The teardown is SILENT by design: an idle release is the expected lifecycle
     * of a resting process, not a fault — the panel's status simply falls back to
     * "configured", and a notice would only train the user to ignore notices.
     * Abnormal disappearances (crashes) surface through `session/released`
     * events instead.
     */
    private releaseIfIdle;
    /**
     * Claim this bridge's single prompt slot for one turn, waiting (bounded) for
     * a predecessor the agent has not finished yet.
     *
     * WHY the wait: `onAbort` finishes OUR stream the moment the user hits stop,
     * but the cancel is a notification the agent may not have processed yet. A
     * prompt sent into that window is a second concurrent `session/prompt` on the
     * same session — forbidden by the protocol and rejected (or worse, mishandled)
     * by the agent. Waiting turns a protocol error into a short delay.
     *
     * @param session - the session asking for the slot.
     * @returns whether the slot was claimed, and why not when it was not.
     */
    claimTurn(session: LiveSession): Promise<{
        ok: true;
    } | {
        ok: false;
        reason: 'busy' | 'unsettled';
    }>;
    /**
     * Mark the agent-side turn as in flight and hand back the settler its stream
     * owner must call once the agent is actually done with it.
     *
     * @param session - the session whose turn is starting.
     * @returns the settler (idempotent; also used by connection loss).
     */
    beginTurn(session: LiveSession): () => void;
    view(): AgentView;
    /**
     * Work a teardown would interrupt: a turn in flight (or one the agent is
     * still settling after an abort), a permission ask waiting for an answer, a
     * probe, a resume, or a start. A registered-but-idle session is NOT work.
     */
    private hasActiveWork;
    /**
     * Nothing depends on this child's identity right now: no live session and no
     * work. This is the WORKSPACE MOVE's predicate. It stays stricter than the
     * idle release on purpose: an idle live session still pins the process to its
     * spawn cwd (see `ensureReady`), so moving would trade workspace-aware agent
     * state for a restart on every cross-workspace turn.
     */
    private isQuiet;
    /**
     * An idle teardown is safe when nothing is WORKING. Idle live sessions do not
     * block it: `releaseAll` parks them as `released` (never closed), and the next
     * prompt brings them back with `session/load`. The exception is an agent that
     * does not advertise `loadSession`: releasing would lose a conversation it
     * cannot reload, so there the old session-less rule stands.
     */
    private canIdleRelease;
    /**
     * Memoized spawn + `initialize`; failures reset so the next call can retry.
     *
     * @param spawnCwd - the workspace the caller needs the PROCESS to run in; a
     *   chat session passes its DSH session workspace. A ready child cannot be
     *   moved (its cwd is fixed at spawn), so a quiet bridge — nothing above to
     *   lose — is restarted in the wanted workspace instead of inheriting the
     *   directory some probe happened to spawn it in. A busy bridge keeps the
     *   child it has: `session/new` still tells the agent where that session
     *   lives, and killing a live conversation to move a process never is worth
     *   it.
     */
    ensureReady(spawnCwd?: string): Promise<void>;
    private spawnAndConnect;
    /**
     * Bound one agent-startup request (`initialize`, `session/new`,
     * `session/load`). The SDK's `cancellationSignal` is cooperative — a wedged
     * agent never answers `$/cancel_request` either — so the only real timeout
     * is a race, and the losing call tears the child down: a process that stops
     * answering protocol requests is dead for every session it owns.
     */
    private withStartupTimeout;
    private noteStderr;
    private publishStatus;
    /**
     * @param cwd - the ACP session's cwd (validated against the agent's roots).
     * @param extraRoots - roots trusted for THIS session only (a chat session's
     *   DSH workspace; see `resolveSessionCwd`).
     * @param spawnCwd - where the agent PROCESS should run; see `ensureReady`.
     */
    createSession(cwd: string | undefined, extraRoots?: readonly string[], spawnCwd?: string): Promise<LiveSession>;
    /**
     * Spawn a throwaway ACP session purely to read its `configOptions` (the
     * model catalog probe). Deliberately bypasses the live-session bookkeeping
     * so probe sessions never surface in the browser session list.
     *
     * THE PROBE SENDS THE AGENT'S OWN MCP LIST, not an empty one. Measured
     * against codebuddy: the servers handed to `session/new` land in the
     * agent PROCESS's dynamic MCP scope, so a probe that sent an empty list
     * would REPLACE that scope and drop the MCP servers of the live sessions
     * on the same connection (the agent logged
     * `serverManager.delete("injected")` and the live session's
     * `mcp__injected__*` tools disappeared). One list per agent process is the
     * only shape that keeps every session of that process consistent.
     */
    probeConfigOptions(): Promise<unknown[]>;
    /**
     * Fire one prompt turn. Returns after the agent settles the turn; the caller
     * (manager) keeps the UI informed through broadcast events, so the RPC that
     * started the turn can answer `accepted` immediately.
     *
     * A `cancelled` stop on a turn the user never cancelled is the stale-cancel
     * swallow (the agent is still cleaning up the PREVIOUS cancel and answers
     * the new prompt from it — observed on codebuddy, which drops the message
     * without generating a turn). The same prompt is resent after
     * {@link BridgeTuning.staleCancelRetryDelayMs}, out-waiting the cleanup
     * window, bounded by {@link BridgeTuning.staleCancelMaxRetries}; a genuinely
     * requested cancel (`cancelRequestedAtTurn` still names this generation)
     * returns as-is.
     */
    runPrompt(session: LiveSession, text: string, turnId: string): Promise<string>;
    cancel(session: LiveSession): Promise<void>;
    /**
     * An agent that ignores the `session/cancel` notification must not wedge the
     * session in `running` forever (every later prompt would fail with
     * `turn_in_flight`), nor leave the adapter turn's settle gate hanging (every
     * later prompt would fail with `unsettled`). Force-finalize the turn after
     * the grace period; the real `session/prompt` response may still arrive
     * later and is folded in by the manager as usual.
     *
     * The timer is generation-guarded: it belongs to the turn `cancel` was
     * called for. If that turn already ended and a LATER turn is on air (the
     * agent settled late, the user moved on), firing would murder the innocent
     * successor — so a moved-on {@link LiveSession.turnSeq} disarms it.
     */
    private armCancelFallback;
    /**
     * Bring a released session back on a fresh agent process via
     * `session/load` ("send to recover"). Concurrent callers share one inflight
     * resume. The agent replays its history as fresh `session/update`s while
     * the load request is still in flight, so the session re-registers with the
     * update router and broadcasts `session/reset` BEFORE the request goes out;
     * on failure the record is parked back into the released map so a later
     * prompt can retry.
     */
    resumeSession(session: LiveSession): Promise<LiveSession>;
    private doResumeSession;
    /** Release all live sessions (process died or went idle): keep them resumable, settle permissions, drop the connection. */
    releaseAll(reason: string): void;
    /** Detach one released session record for a resume attempt. */
    takeReleased(sessionId: string): LiveSession | undefined;
    /** Drop a released session record for good (user closed it or the agent was stopped). */
    dropReleased(sessionId: string): boolean;
    get releasedList(): LiveSession[];
    hasReleased(sessionId: string): LiveSession | undefined;
    inflightResume(sessionId: string): Promise<LiveSession> | undefined;
    /** Run one host→agent command as work, so an idle teardown cannot cut it. */
    private runCommand;
    setMode(session: LiveSession, modeId: string): Promise<void>;
    setConfigOption(session: LiveSession, configId: string, value: string | boolean): Promise<void>;
    private publishMeta;
    closeSession(session: LiveSession, reason: 'closed' | 'agent-stopped' | 'agent-died'): Promise<void>;
    get sessionList(): LiveSession[];
    hasSession(sessionId: string): LiveSession | undefined;
    /** Kill the child and drop every local session bound to this connection. */
    stop(reason?: 'closed' | 'agent-stopped' | 'agent-died'): Promise<void>;
    private killChild;
    /**
     * Answer one ACP permission ask. Every ask reaches a human: the native
     * approval chain first (answered in the chat composer), the settings-panel
     * ledger otherwise.
     */
    private handlePermissionRequest;
    /**
     * Why one ledger ask is on the ledger, as recorded by
     * {@link handlePermissionRequest}. The manager's `streamPrompt` reads it to
     * word the chat line by the path the ask took; `undefined` once the ask is
     * answered, timed out, or settled.
     */
    ledgerFallbackOf(requestId: string): LedgerFallback | undefined;
    /**
     * Ask the host approval service for this permission (`ctx.approval` → the
     * browser's composer takeover). Only sessions bound to a DSH chat session
     * qualify: the service appends its audit pair to that session inside an
     * open turn, so a session started over `/acp` (no chat turn) cannot be
     * routed and must stay on the ledger path.
     *
     * The ask is raced against {@link BridgeTuning.nativeApprovalTimeoutMs}. A
     * routed ask has exactly one answer entry — the composer takeover — and no
     * broadcast at all, so a host that takes the question and never renders it
     * would leave the turn hanging behind something invisible. Past the deadline
     * the ask is WITHDRAWN (the signal handed to the host aborts, which settles
     * its waterfall `cancelled` and drops the composer panel) and reported as
     * `native-timeout`, sending the question to the ledger where the chat line
     * and the settings card are both visible. Withdrawing is not answering: a
     * human mid-decision finds the same question in the settings panel.
     *
     * No deadline is armed on the ledger paths (`no-requester`,
     * `no-chat-session`): those never reach the host, and their answer entry is
     * the settings panel the chat line already points at.
     *
     * @returns the agent-facing response, or the reason the ask must fall back
     * to the ledger (see {@link LedgerFallbackReason}).
     */
    private askNativeApproval;
    private settlePermissions;
    /** `fs/read_text_file` for agents that fetch workspace content through the
     * client. Every path passes the same workspace guard as session cwds
     * (resolveFsPath); violations answer as JSON-RPC internal errors so the
     * agent sees a refusal instead of file contents.
     */
    private handleFsRead;
    /**
     * `fs/write_text_file`; parent directories are created inside the boundary.
     *
     * The workspace guard (`guardFsPath`) is the only fence, and it is the one
     * that has always applied: a write outside the session's resolved roots is
     * refused. There is deliberately NO extra access-mode layer — DSH's sandbox
     * cannot reach into the agent's own process, so a second gate here would only
     * be a fiction in front of a tool that can write without asking us at all.
     * What the agent chooses to ask about goes to the human unchanged
     * (`askNativeApproval`). See docs/acp-convergence.md §2.3.
     */
    private handleFsWrite;
    private guardFsPath;
    private handleSessionUpdate;
    private applyDerived;
}
/** Human-facing identity of an ACP tool call (the approval headline). */
/**
 * Human-facing name of the tool an ask is about, for the chat line and the
 * timeout notice.
 *
 * The ACP `toolCall.title` is the declared field, but it is OPTIONAL and real
 * agents omit it: codebuddy puts the name in `_meta["codebuddy.ai/toolName"]`
 * (observed live — without the fallback the notice reads `for "tool call"`,
 * which tells the human nothing about what they missed). So read `title` first,
 * then any `_meta` key whose last segment is `toolName`, then the standard
 * `kind`, and only then give up with the generic phrase. Nothing is invented:
 * every step reads a key the agent itself declared.
 */
export declare function permissionToolName(toolCall: unknown): string;
/**
 * This plugin's OWN state directory, `~/.dsh/dsh-ntr-plus`.
 *
 * Everything this plugin persists belongs in here — the agent registry, the
 * probed model catalog, and the default ACP execution workspaces. `~/.dsh` is
 * the HOST's shared root: it holds the host's own `sessions/`, `storages/`,
 * `skills/`, `profiles/`, credentials and so on. Dropping a plugin's files
 * loose in there makes them indistinguishable from the host's state, and two
 * unrelated `acp-*.json` names at that level read as host config to anyone
 * (user or agent) looking at the directory. One owner, one subdirectory —
 * same convention `~/.dsh/skills/<owner>` and `~/.dsh/dsh-runtimes/<owner>`
 * already follow.
 *
 * `DSH_NTR_STATE_DIR` overrides the location (tests, and power users with a
 * relocated state root).
 */
export declare function pluginStateDir(home?: string): string;
/**
 * Rewrite an agent definition's recorded workspace paths onto
 * {@link pluginStateDir} after the migration.
 *
 * `cwd` and `allowedCwdRoots` are absolute, user-visible paths stored verbatim,
 * and `resolveSessionCwd` REJECTS a cwd that does not exist — so moving the
 * directory without rewriting the agents that point into it breaks every saved
 * agent. Returns the definition unchanged when it never named the old root.
 */
export declare function rewriteLegacyWorkspaceRoots(def: AcpAgentDef, home?: string): AcpAgentDef;
/**
 * Plugin-owned default execution workspace, anchored to the plugin state dir
 * (`~/.dsh/dsh-ntr-plus/workspaces`).
 *
 * It deliberately does NOT derive from `process.cwd()`: that is wherever the
 * DSH host happened to be launched from, so the "default workspace" used to
 * move around per launch — and, via the `allowedCwdRoots` fallback, it could
 * widen an agent's sandbox to the entire launch directory (in practice `$HOME`
 * when `dsh web` is started from the home dir).
 */
export declare function defaultAgentWorkspace(home?: string): string;
/**
 * Preset id of the ACP-mode composition.
 *
 * THREE places must agree on it (no type system spans them): the declaration's
 * `config.id` in `presets/acp/acp.patch.yml` (the bundle patch the roster row
 * comes from), the browser half's `ACP_PRESET_ID` (`src/client/acp-ui.tsx`), and
 * this constant, which the host's session-log readers compare against.
 */
export declare const ACP_PRESET_ID = "acp";
/** Same as {@link defaultAgentWorkspace}, best-effort creating it on disk. */
export declare function ensureDefaultWorkspace(home?: string): string;
export interface AgentPreset {
    id: string;
    name: string;
    description: string;
    executables: string[];
    defaultCommand: string;
    defaultArgs: string[];
}
export declare const AGENT_PRESETS: AgentPreset[];
export declare function findExecutable(command: string): string | undefined;
export interface ShimLaunch {
    command: string;
    args: string[];
    /** The caller must pass `windowsVerbatimArguments: true` (see below). */
    verbatim: boolean;
}
/**
 * Turn a resolved executable + argv into a spawnable launch.
 *
 * WHY: on Windows every npm-installed ACP agent is a generated `.cmd` shim
 * (`codebuddy`, `pi-acp`, `omp`, `npx` — `findExecutable` finds them through
 * PATHEXT), and Node ≥ 20.12 refuses to spawn a `.cmd`/`.bat` with `shell:false`
 * (the BatBadBut fix): it throws `EINVAL` before the process exists. The shim is
 * therefore handed to `cmd.exe`, which is what CreateProcess used to do for us.
 *
 * The two non-obvious details, both measured on Windows:
 *  - `windowsVerbatimArguments` — otherwise libuv re-quotes our argument with
 *    MSVCRT rules, turning the embedded quotes into `\"`, which cmd.exe does not
 *    treat as an escape; the whole line then fails as "not recognized".
 *  - the outer quote pair — `/s` strips the first and last quote of the `/c`
 *    string, so the line must be wrapped for the quoted program path to survive.
 *
 * `cmd` expands `%VAR%` even inside quotes; that is the one thing this cannot
 * neutralize (a literal `%` in a shim path or argument is not a real case).
 */
export declare function windowsShimLaunch(command: string, args: readonly string[], platform?: NodeJS.Platform, comspec?: string): ShimLaunch;
/**
 * Kill a Windows process tree — the counterpart of the POSIX process-GROUP kill
 * the bridge does elsewhere (see `AgentBridge.killChild`).
 *
 * It must run while the tree is intact: a `.cmd` shim is launched through
 * `cmd.exe`, so killing the direct child first re-parents the agent and
 * `taskkill /T` can no longer reach it (measured: the agent survived `stop()`).
 * Best effort — `taskkill` is absent from no Windows this runs on, and a
 * failure here only means the OS reclaims the process later.
 */
export declare function killProcessTree(pid: number): void;
/**
 * Globally install an agent's npm package. The package name reaches the
 * installer as a spawn argv item; on Windows the installer needs a shell,
 * which is exactly why `validateAgentDef` restricts `npmPackage` to a
 * charset with no shell metacharacters.
 */
export declare function npmInstallGlobal(pkg: string, onLog?: (line: string) => void): Promise<void>;
export interface ExecutableResolution {
    command: string;
    /** True when the npm auto-install ran during this resolution. */
    installed: boolean;
}
/**
 * Resolve the spawn command for an agent def: PATH lookup first, then — when
 * the command is missing and the def carries `npmPackage` — a global install
 * and a second lookup. When nothing resolves the original command comes back
 * untouched so the spawn itself fails with the familiar ENOENT.
 */
export declare function ensureAgentExecutable(def: Pick<AcpAgentDef, 'command' | 'npmPackage'>, install?: (pkg: string, onLog: (line: string) => void) => Promise<void>, onLog?: (line: string) => void): Promise<ExecutableResolution>;
export declare function detectHostAgents(configuredDefs: readonly AcpAgentDef[]): DetectedAgentInfo[];
/**
 * The conversation→agent binding the REQUEST path honors.
 *
 * `session/chat-bind` records which ACP agent serves one DSH chat session — the
 * plugin's own mapping, deliberately not a DSH model route (see
 * `bindChatAgent`). But a route is exactly what the host driver reads per turn
 * (`selectionFor(agent).current`: pending selection → last request header →
 * deployment default), and a session that has never run an ACP turn resolves to
 * the DEPLOYMENT DEFAULT — so without a rewrite the driver never reaches this
 * adapter at all, and a session already on `acp/<old>` replays `<old>` forever.
 *
 * The rewrite lives in `presets/acp/acp-guard.mjs` (an `agent/request` waterfall
 * listener, registered with `prepend` so it lands OUTSIDE the harness's own
 * `installModelSelection` rewrite and wins). The guard is loaded by the
 * harness's Loader as its own module instance, so the two halves share state
 * through this registry on `globalThis` rather than through a module import —
 * same-package, cross-instance, like a service. The guard reads it defensively
 * and degrades to "no rewrite" (the harness default plays out) when it is
 * absent; `ACP_ROUTE_BINDING_KEY` is therefore a hand-copy discipline with the
 * guard's `BINDING_KEY` (see tests/register.spec.ts for the equivalence).
 */
export declare const ACP_ROUTE_BINDING_KEY: unique symbol;
/** The registry shape the guard reads. Values are adapter model strings. */
export interface AcpRouteBindingRegistry {
    /** DSH chat session id → the adapter model (`agentId` | `agentId@choice`) its next turn runs on. */
    readonly conversations: Map<string, string>;
    /**
     * ACP tool call id → the tool's output folded to plain text. The guard's
     * `tools/execute` listener answers the host loop's execution of an ACP
     * display card from here, so the card records the tool's REAL output
     * instead of an `unknown tool` error (see `recordAcpToolOutput`).
     */
    readonly toolResults: Map<string, string>;
    /**
     * Resolvers waiting for a call's output to land, keyed by call id. Under the
     * segmented turn shape the host loop executes a card the moment its segment
     * settles — often BEFORE the agent has reported the tool's output — so the
     * guard's virtual tool parks here until `recordAcpToolOutput` (or the turn's
     * settlement, or the bounded timeout) releases it.
     */
    readonly toolOutputWaiters: Map<string, Set<(text: string | undefined) => void>>;
    /** Bare agent id served when a conversation carries no explicit binding (`undefined`: no rewrite). */
    defaultModel?: string;
    /**
     * Wait for a call's output to land (the plugin's implementation, shared via
     * the registry so the preset's separate module instance can reach it). The
     * guard's virtual tools call this when the host loop executes a card whose
     * tool is still running inside the ACP agent.
     */
    waitForToolOutput?: (callId: string, timeoutMs: number) => Promise<string | undefined>;
}
/**
 * Install (or reuse) the process-wide registry. Idempotent: the guard and the
 * plugin load in either order, and a hot reload must not orphan bindings the
 * previous instance recorded.
 */
export declare function routeBindingRegistry(): AcpRouteBindingRegistry;
/**
 * Record one ACP tool call for the guard's virtual tools. The host loop
 * "executes" every tool-call block in a settled ACP message (that execution
 * record is what draws the card); the preset registers no tools, so each call
 * would record `Error: unknown tool "<name>"`. The guard's `tools/execute`
 * listener instead registers a scoped virtual tool per name, and its body
 * answers with THIS record — the tool's real output, folded by the same helper
 * the ACP view uses. Every seen call id is recorded, even with empty output:
 * the guard's pre-step gate identifies its own continuation batches by exactly
 * this membership. Bounded: entries are transient, but an agent that inlines
 * whole files must not grow the process-wide map without limit.
 */
export declare function recordAcpToolOutput(callId: string, text: string): void;
/**
 * Wait for a tool call's output to land in the shared registry. The host loop
 * executes a card as soon as its segment settles, which routinely happens
 * while the ACP agent is still running the tool; the guard's virtual tool
 * parks here so the card's execution record ends up with the real output.
 *
 * Resolves with the output text, or `undefined` when the bounded timeout
 * elapses or the turn settles first (the caller then answers with a pointer to
 * the ACP transcript view). Never rejects and never waits past the timeout.
 */
export declare function waitForToolOutput(callId: string, timeoutMs: number): Promise<string | undefined>;
/** Release every output waiter (a turn settled; nothing more can land for it). */
export declare function releaseAllToolOutputWaiters(): void;
/**
 * One driver step's stream: its own chunk queue and block state. A turn is
 * MANY segments when it carries tool calls — each segment ends where a tool
 * card should sit as the LAST block of the settled assistant message, so the
 * host loop executes the card between two assistant messages exactly like a
 * native multi-step turn (see docs/acp-convergence.md §1.7).
 */
interface SegmentState {
    queue: AsyncQueue<StreamChunk>;
    /** Block index within THIS segment (the host accumulator is per-stream-call). */
    index: number;
    activeType: 'reasoning' | 'text' | 'tool-call' | null;
    activeText: string;
    /** The open tool-call block's snapshot, while `activeType === 'tool-call'`. */
    activeToolCall: AcpToolCallSnapshot | undefined;
    /** Whether this segment opened at least one tool-call block. */
    hasCard: boolean;
    finished: boolean;
}
/** How one segment's stream ends, in `StreamChunk.finish` terms. */
type SegmentFinishReason = {
    kind: 'stop';
} | {
    kind: 'aborted';
    failure?: {
        message: string;
        code: string;
    };
} | {
    kind: 'error';
    failure?: {
        message: string;
        code: string;
    };
};
/** Why a turn ended, as seen by {@link TurnStreamController.settle}. */
type TurnSettle = {
    kind: 'stop';
    stopReason: string;
} | {
    kind: 'cancelled';
} | {
    kind: 'error';
    message: string;
};
/**
 * The state of ONE ACP prompt, shared across every driver step of the turn.
 *
 * The controller owns the hub subscription (for the whole agent-side turn, not
 * per stream() call), the transcript cursor (segments resume by replaying
 * `transcript.since(cursor)` — events that arrive while no segment is open are
 * recorded, never lost), the seen-call registry (a call id gets exactly one
 * card per turn, wherever its restatements land), and the turn-level facts
 * (`sawVisibleBlock`, usage) that outlive any single segment.
 */
declare class TurnStreamController {
    private readonly manager;
    private readonly hub;
    private readonly bridge;
    readonly session: LiveSession;
    readonly turnId: string;
    /** Releases the agent-side turn slot (the `beginTurn` settler; idempotent). */
    private readonly endTurn;
    private readonly rollbackFirstTurn;
    private segment;
    private settled;
    private disposed;
    private readonly seenCalls;
    private readonly announcedKinds;
    private latestUsage;
    /** Narrative lines (permission asks) that arrived while no segment was open. */
    private readonly pendingProse;
    sawVisibleBlock: boolean;
    private cursorSeq;
    constructor(manager: BridgeManager, hub: EventHub, bridge: AgentBridge, session: LiveSession, turnId: string, 
    /** Releases the agent-side turn slot (the `beginTurn` settler; idempotent). */
    endTurn: () => void, rollbackFirstTurn: (session: LiveSession) => void);
    private readonly unsubscribe;
    private readonly turnSeqAtStart;
    /** The transcript cursor: everything at or below it is already folded or recorded. */
    get replayCursor(): number;
    /** Whether the agent already settled its `session/prompt` for this turn. */
    get hasSettled(): boolean;
    /** Generation guard: a controller whose turn has been superseded must not touch the session. */
    get stale(): boolean;
    /**
     * Open the next segment and replay everything that landed since the cursor.
     * Visible events fold into the new segment (a card that was announced
     * between segments opens here); tool records are idempotent. Replaying may
     * itself finish the segment (card followed by prose — the prose belongs to
     * the NEXT message): the replay stops AT the cutting event without
     * consuming it, so the next segment replays it again.
     */
    startSegment(): SegmentState;
    /** Finish the segment on air (if any). Used by cancel paths and teardown. */
    finishActive(reason: SegmentFinishReason): void;
    /** The agent settled its `session/prompt`. Ends the turn's streaming face. */
    settle(outcome: TurnSettle): void;
    /** Cancelled by the user: finish the on-air segment and release the turn's slots. */
    abortActiveSegment(): void;
    /** Stop observing and release the manager's index. Idempotent. */
    dispose(): void;
    private finishSegment;
    /** A segment opened on an already-settled turn: replay, then close it out. */
    private finishAfterSettle;
    private onEvent;
    /** Events that arrive between segments: recorded, replayed into the next one. */
    private recordWithoutSegment;
    private noteUsage;
    /** Record a tool call's output (idempotent) and wake any waiter. */
    private noteToolRecord;
    /**
     * The turn's whole fold, shared by live events and segment replay. Visible
     * non-tool events END a card-bearing segment instead of joining it — that is
     * the segmentation rule that puts each card between two assistant messages.
     * Returns whether the event was consumed into this segment: the cutting
     * event is left unconsumed (and thus behind the cursor) for the next one.
     */
    private foldInto;
    private emitProse;
    /**
     * Open a tool-call block for one call. Two adjacent tool calls share a block
     * TYPE, so the switch helper's type-equality early return cannot be used
     * here — every call needs its own block.
     */
    private openToolCallBlock;
    private permissionLine;
}
/** Routes host session ids to their owning bridge. */
export declare class BridgeManager {
    readonly hub: EventHub;
    private readonly transcriptMax;
    private readonly configStoragePath?;
    private readonly catalogStoragePath?;
    /** Auto-probe agents for model catalogs (boot + lazy); manual probes always run. */
    private readonly probeModelsOnBoot;
    private readonly bridges;
    private readonly defsMap;
    /** The plugin's own default ACP agent id (persisted; see `persistAgents`). */
    private defaultAgentId?;
    /** The agent tag's halo preference (persisted; see `persistAgents`). */
    private tagHaloSetting;
    /**
     * What `cordis.patch.yml` asked for, by key — ONLY the keys it actually
     * names. This is the deployment baseline, kept apart from
     * {@link deadlineOverride} so the settings card can tell the user which of
     * the two is winning. Empty when the file says nothing about either window,
     * in which case {@link baselineDeadlines} (the built-in default) applies.
     */
    private configuredDeadlines;
    /**
     * The value each deadline had before any override — the tuning this manager
     * was constructed with, which already carries the validated config file (the
     * host entry passes `validateConfig`'s output) or the built-in default.
     *
     * Held separately from {@link configuredDeadlines} because the two answer
     * different questions: this one is what RUNS when nothing is overridden, that
     * one is what the config file NAMED (which the card shows as the reset target
     * and a bare default does not deserve). A manager built without tuning at all
     * — a direct consumer, a test — gets `DEFAULT_TUNING` here and stays correct.
     */
    private baselineDeadlines;
    /**
     * The settings page's own write, persisted with the agent registry. Merged
     * OVER {@link baselineDeadlines}: once a user picks a window in the UI, that
     * pick is what runs, and the config file becomes the value the reset button
     * returns to. Without this split a hand-edited `cordis.patch.yml` and a UI
     * write would fight with no way to tell which one is live.
     */
    private deadlineOverride;
    /**
     * Tuning in force, defaults applied. The two approval deadlines are rewritten
     * IN PLACE by {@link applyDeadlineTuning}, which is why this is a live object
     * rather than the constructor's parameter: every bridge built afterwards
     * inherits the rewrite instead of the boot-time value.
     */
    private readonly tuning;
    /**
     * The in-flight (or just-settled) segmented turn of one DSH chat session.
     * Keyed by chat session id because the continuation steps of a segmented
     * turn arrive as fresh `streamPrompt` calls that must find the SAME
     * controller — its transcript cursor, seen-call registry and turn facts are
     * what let them resume the prompt instead of re-sending it. An entry is
     * replaced by the conversation's next turn and removed on cancel, session
     * close/release, or agent stop.
     */
    private readonly turnStreams;
    /** The segmented turn a continuation step of one chat session must resume. */
    turnStreamFor(dshSessionId: string): TurnStreamController | undefined;
    /** Index a turn's controller, retiring whatever turn it supersedes. */
    rememberTurnStream(dshSessionId: string, controller: TurnStreamController): void;
    /** Drop a controller from the index (its own `dispose` calls back into this). */
    forgetTurnStream(controller: TurnStreamController): void;
    /** Tear down the turn streams of every session of one bridge (close/release/stop). */
    private disposeTurnStreamsOf;
    constructor(defs: readonly AcpAgentDef[], hub: EventHub, transcriptMax: number, configStoragePath?: string | undefined, catalogStoragePath?: string | undefined, 
    /** Auto-probe agents for model catalogs (boot + lazy); manual probes always run. */
    probeModelsOnBoot?: boolean, tuning?: BridgeTuning);
    private makeBridge;
    /**
     * Route ACP permission asks through the host approval service (answered in
     * the chat composer). Absent → every ask stays on the settings-panel ledger.
     * Setting it also flips {@link approvalRouting}, which the browser reads to
     * stop rendering the settings-panel permission card.
     */
    setApprovalRequester(requester?: ApprovalRequester): void;
    /** True when permission asks go to native approval instead of the settings panel. */
    approvalRouting(): boolean;
    /**
     * Every outstanding ledger ask, across all agents, with the view the browser
     * was shown it — the source of the reconnect replay (see
     * `permissionReplayFrames`). Asks on the native route are deliberately
     * absent: they broadcast nothing and their answer entry is the composer
     * takeover the client already holds.
     */
    pendingPermissionViews(): PendingPermissionView[];
    /**
     * Let the host resolve a chat session's workspace root — the sidebar's
     * selected workspace, which the agent's session and its process both run in.
     * Absent resolver → every chat session falls back to the agent's configured
     * cwd (`~/.dsh/dsh-ntr-plus/workspaces`), which is the right answer for `/acp`-RPC
     * sessions and headless deployments.
     */
    setSessionWorkspaceResolver(resolver?: SessionWorkspaceResolver): void;
    /**
     * Wire the ACP-mode probe: given a DSH session id, report whether that
     * session runs the ACP agent preset. The host half reads it back from the
     * session log (`sessionAgentPreset`); an absent resolver means the browser
     * falls back to its own session-list rows.
     */
    setAcpModeResolver(resolver?: AcpModeResolver): void;
    /**
     * Whether ONE DSH chat session runs the ACP agent preset, asked by chat
     * session id. The browser's composer surfaces consume this: on hosts whose
     * client runtime does not carry `agentPreset` on the session-list row (their
     * preferred fact source), this is the only way to know which conversation is
     * an ACP one.
     *
     * The resolver may await a persistence read (a cold session has to be read
     * from disk), so answers are CACHED per session id and served synchronously:
     * the first ask returns `false` while the read is in flight and the caller
     * re-asks on the next tick — a one-turn delay, never a wrong verdict.
     * A cached verdict is dropped when the session's log moves (preset switch,
     * new turn), so a stale answer cannot outlive the fact it was folded from.
     */
    chatSessionAcpMode(dshSessionId: string): boolean;
    /**
     * The awaitable form of `chatSessionAcpMode`, served by the `session/chat-list`
     * RPC: the first ask WAITS for the cold read instead of answering early, so
     * the browser's one-shot fallback sees the settled verdict immediately —
     * a synchronous first answer of `false` would be remembered by the gate and
     * the seat would never take over. Concurrent asks for the same session share
     * one read (in-flight dedup); a failed lookup returns `false` for that ask
     * but is NOT cached, so the next ask retries.
     */
    chatSessionAcpModeAnswer(dshSessionId: string): Promise<boolean>;
    /** Drop cached ACP-mode verdicts: one session's, or all of them. */
    invalidateAcpMode(dshSessionId?: string): void;
    /**
     * The ACP agent sessions backing one DSH chat session. The composer uses this
     * to offer the agent's OWN modes next to the host's Access mode control —
     * "how the agent works" beside "what it may touch", which is the split that
     * keeps the two controls from reading as duplicates.
     */
    chatSessions(dshSessionId: string): ChatSessionView[];
    /**
     * Bind one DSH chat session to an ACP agent.
     *
     * This is the plugin's OWN conversation↔agent mapping. It deliberately does
     * NOT write a DSH model selection: the retired "express the agent as a
     * `provider: 'acp'` route" axis forced `session.selectModel`, which both
     * polluted the deployment default model and got refused by the GUI's catalog
     * gate (`session/model-unavailable`) — even though the prompt admission path
     * never checked catalog membership in the first place. See
     * docs/acp-convergence.md §1.1 and §2.2.
     *
     * The host half records the intent; the actual ACP session is created on the
     * next turn (which is also what resumes a released one).
     */
    bindChatAgent(dshSessionId: string, agentId: string): void;
    /** The ACP agent a chat session was last pointed at, when one is known. */
    chatAgentFor(dshSessionId: string): string | undefined;
    /**
     * The agent a conversation is LOCKED to, if its first ACP turn has run.
     *
     * The persisted `locked` flag is the durable answer and deliberately ignores
     * the roster: a deleted agent still owns the conversation's context, and the
     * conversation must not pretend it is unbound (that would offer a switch the
     * turn path then has to refuse). The live/released session fallback covers
     * conversations recorded before the flag existed; the next turn writes the
     * flag (`lockChatAgent`).
     */
    lockedAgentFor(dshSessionId: string): string | undefined;
    /**
     * Write the conversation's agent lock and announce it once.
     *
     * Called at the START of the conversation's first ACP turn (the session was
     * just materialized), so the composer can play its base→tag hand-off while
     * the turn is running instead of waiting for it to settle. Returns true when
     * this call created the lock; the caller marks a newly created session
     * `provisionalLock`, and a first turn that delivers nothing rolls it back
     * (`rollbackFirstTurn`). The broadcast is what lets the browser react at
     * once: a `session/chat-list` read is a round-trip behind.
     */
    private lockChatAgent;
    /**
     * Undo the provisional lock of a first turn that delivered nothing, and drop
     * the failed session with it.
     *
     * A turn that produced an error before any text/reasoning, or a silent
     * provider failure folded into a normal stop, exchanged nothing with the
     * agent: there is no context to protect, so the conversation may choose
     * another agent. The session is CLOSED rather than kept, because both lock
     * readers (`lockedAgentFor` here and `lockedAgentOf` in the browser) treat a
     * live session as a lock — keeping it would leave a visually locked
     * conversation whose picker the host still accepts.
     *
     * The pick itself (agent/model/effort/mode/extra configs) stays recorded: the
     * base comes back showing the same agent, ready to be changed or retried.
     */
    private rollbackFirstTurn;
    /**
     * The conversation's persisted pick (agent + model + thought level). This is
     * the record that survives a host restart and is readable BEFORE the
     * conversation has ever run a turn — the composer shows it, and the turn path
     * applies it to a freshly created or resumed session.
     */
    chatChoice(dshSessionId: string): AcpConversationChoice | undefined;
    /**
     * Publish one conversation's pick onto the request-path binding.
     *
     * The guard's `agent/request` rewrite and this class's own turn admission read
     * `routeBindingRegistry().conversations`, whose values are adapter model ids.
     * The MODEL half of the pick therefore rides there, so a turn that starts
     * with `agentId` alone does not silently drop a variant chosen up front; with
     * no model picked the binding is the bare agent id (the agent's default).
     *
     * Only ever WRITES: a conversation with no recorded pick keeps whatever the
     * turn path pinned to it (the agent that actually served its last turn), which
     * is the honest answer for a session whose intent map was never seeded.
     */
    private syncConversationRoute;
    /**
     * The adapter model string one chat conversation's next turn runs on — the
     * request-path binding, when it names a CONFIGURED agent. `undefined` leaves
     * the turn on whatever route the driver resolved (the allowed failure: the
     * harness default plays out).
     */
    private conversationRouteModel;
    /**
     * The agent's own default thought level — the effort the driver MATERIALIZES
     * into a request that did not ask for one (`resolveCallWithInfo` fills
     * `reasoning.defaultEffort` in and marks it adapter-defaulted). Re-applying
     * that as a per-turn choice would revert a pick the user just made through
     * the seat, so the turn path treats it as "no effort requested".
     */
    private modelDefaultEffort;
    /**
     * Record one field of a conversation's pick and persist it.
     *
     * Every bottom-bar control (agent, model, thought level, the agent's own mode,
     * the advanced base's extra config values) is one field of the SAME record,
     * and the setters used to spell the record
     * out by hand each time — which is exactly how `mode` ended up as the one
     * control that reset on every restart: no setter wrote it. Patch through here
     * so a new axis cannot be half-wired.
     *
     * `undefined` CLEARS the field (the "follow the agent's default" choice).
     */
    private patchChatChoice;
    /** Switch the bound agent's model for one chat session (`agentId@choice`). */
    setChatSessionModel(dshSessionId: string, modelId: string): Promise<void>;
    /**
     * Switch the reasoning effort for one chat session.
     *
     * `agentId` names the agent that serves a conversation nobody has bound —
     * the plugin default the guard's route rewrite falls back to. The browser
     * knows it (its composer chip is built from the same route), and without it
     * `chatAgentFor` answers undefined before the first session exists, so the
     * pick would be silently dropped.
     */
    setChatSessionEffort(dshSessionId: string, effort: string | undefined, agentId?: string): Promise<void>;
    /**
     * Set one of the agent's EXTRA config options for one chat session (the
     * composer's advanced base). The value is validated against what the agent
     * actually publishes — the live session's own options first, the cached
     * catalog second — and recorded even when no session exists yet, so the pick
     * applies when the first turn materializes one (`applyChatChoice`).
     *
     * A live session is updated immediately; a failure there is warned about and
     * the pick still stands, exactly like the model/effort alignment path.
     */
    setChatSessionConfig(dshSessionId: string, configId: string, value: string | boolean, agentId?: string): Promise<void>;
    /**
     * Apply a conversation's persisted pick to a session that just materialized —
     * created by the first turn, or resumed through `session/load` after a crash.
     *
     * This is what makes an up-front choice real rather than decorative: the
     * session/new and session/load answers come back with the AGENT's defaults,
     * which would otherwise run the first message on a model the user already
     * replaced. Best effort, exactly like the turn path's alignment: a stale
     * model is not applied (and NOT dropped — `streamPrompt` refuses to run a
     * turn on an unknown model until the user reselects), a stale thought level
     * is dropped with a notice, and the agent's own configuration is used in the
     * meantime. Never turned into a different model than the one selected.
     */
    private applyChatChoice;
    /**
     * Every ACP session's transcript that belongs to one DSH chat session, so the
     * conversation can render the REAL agent stream (tool calls, plans, diffs) as
     * its own view tab. Released sessions keep serving their pre-crash buffer —
     * a dead agent must not blank the history the user is reading.
     *
     * Read-only and synchronous: like `transcript`, it never spawns and never
     * resumes (a `session/load` resume is triggered by *sending*, not looking).
     */
    chatTranscripts(dshSessionId: string, afterSeq?: number): ChatTranscriptView[];
    /**
     * Switch one chat-bound session's ACP mode. A released session is resumed
     * first (`session/load`), matching the "send to recover" promise — the mode
     * switch is itself a reason to bring the agent back.
     */
    setChatSessionMode(dshSessionId: string, modeId: string, agentId?: string): Promise<void>;
    /**
     * Wire the harness's preset roster (`ctx.agentPresets`) into `presetStatus`.
     *
     * Optional on purpose: a deployment without the registry service has no
     * roster to report and the panel card hides itself, which is strictly better
     * than inventing a second truth about where presets come from.
     */
    setPresetRosterReader(reader?: () => Promise<readonly RosterPresetRow[] | undefined>): void;
    /**
     * Read-only state of the ACP-mode preset in the harness's own roster.
     *
     * The preset is a declaration this package SHIPS (its own bundle patch), so
     * there is nothing to install — what the panel needs to know is whether the
     * roster carries the row and can compose a session from it. `undefined` when
     * the roster cannot be read (no registry service wired): the panel then hides
     * the block rather than claiming the preset is gone.
     */
    presetStatus(): Promise<AcpPresetStatus | undefined>;
    private getStoragePath;
    /**
     * Read the agent registry file.
     *
     * TWO shapes on purpose: version 1 was a bare array of agent definitions,
     * while `defaultAgentId` (the panel's ★ gesture — the agent an ACP-mode
     * conversation should start on) needs a home that is not the deployment
     * default model. A legacy bare array still loads; it is rewritten in the
     * current shape on the next persist.
     */
    private loadPersistedAgents;
    /**
     * Read the per-conversation picks back. Tolerant on purpose, one row at a
     * time: a single corrupt entry must not cost the user every other
     * conversation's set-up. Entries are kept even when the named agent is not
     * configured on this boot — `chatChoice` filters those out, so a temporarily
     * missing agent does not erase the choice it was made for.
     */
    private loadPersistedChoices;
    private persistAgents;
    private readonly catalogs;
    /**
     * The slash commands each agent declared in its most recent session, cached
     * per agent and persisted alongside the model catalog.
     *
     * This is what makes `/` list an agent's commands in a conversation that has
     * not sent its first message yet: before `session/new` there is no live
     * session to ask, and the native menu's immediacy is the bar. A live
     * session's own declaration always outranks this cache. It is learned, never
     * probed — a `session/new` for a menu would spawn an agent (constraint 8).
     */
    private readonly commandCache;
    /**
     * Catalog schema the persisted file was written with. Bumped when a parser
     * gains a category, so a cache written by an older build is KNOWN to be
     * incomplete — a persisted `{model, thought}` catalog from v1 would otherwise
     * keep an agent looking like it has no `mode` axis forever.
     *
     * A stale entry is still SERVED (dropping it would blank the seats across an
     * upgrade) and is repaired for free the next time that agent's own session
     * publishes `configOptions` (`absorbCatalog`). It is NOT re-probed at boot:
     * a probe spawns a process, and starting agents nobody is talking to is the
     * defect this marker used to cause (user report, 2026-10-18).
     *
     * v2 = `mode` (`category: 'mode'`) joined `model` / `thought_level`.
     * v3 = every other select joined as `extras` (the composer's advanced base).
     */
    private static readonly CATALOG_SCHEMA;
    /** Agents whose persisted catalog predates {@link CATALOG_SCHEMA}. */
    private readonly catalogStale;
    /** Auto-spawning probes are suppressed under test runners so suites stay deterministic. */
    private readonly autoProbeEnabled;
    private getCatalogStoragePath;
    private loadPersistedCatalogs;
    private persistCatalogs;
    /**
     * Merge `configOptions` observed on any real session into the agent's catalog.
     *
     * This is the SECOND way a catalog gets refreshed (the first being an explicit
     * `probeAgentModels`), and the only one that happens for free: it rides a
     * session the user is already running. It therefore also discharges the
     * {@link CATALOG_SCHEMA} staleness mark — whatever an older parser missed, the
     * current `parseCatalogOptions` has now seen this agent's real answer.
     */
    private absorbCatalog;
    /**
     * Fold a per-session option answer's SHAPE into the agent's catalog.
     *
     * The counterpart of {@link absorbCatalog} for `session/set_config_option`
     * responses: which options exist and which choices they offer is agent
     * knowledge the seat must show (the composer's thought chip only renders
     * when the catalog has `thought_level`, and some agents publish it only in
     * the answer to a model change), while a per-session `currentValue` stays
     * out of it. No auto-exposure and no staleness discharge either — this is
     * one session's answer, not the agent-level observation those marks track.
     */
    private absorbCatalogShape;
    /**
     * Remember the slash commands an agent declared in a real session.
     *
     * Unlike {@link absorbCatalog} this does NOT feed a model surface — it keeps
     * the agent's `/` menu populated before the next conversation has a session
     * of its own. The live session's declaration is still the authority; this is
     * only what a fresh conversation has to draw from.
     *
     * Deduped on content: agents restate their list freely, and a broadcast per
     * restatement would make every open composer re-read `agent/catalog`.
     */
    private absorbCommands;
    /**
     * Append models this observation newly introduced to the agent's selection.
     *
     * "Newly introduced" means present in `next` but absent from the catalog
     * known `before` — NOT "absent from the selection". Comparing against the
     * selection would resurrect a model the user deliberately unchecked every
     * time the agent repeats its catalog. The first observation has no baseline
     * (`before === undefined`), so it adds nothing; the user can still add the
     * whole list with one click in the settings card. Discovery is ON unless the
     * agent definition explicitly opts out with `autoDiscoverModels: false`.
     */
    private autoExposeNewModels;
    /** Tell the browser an agent's model-visibility surface changed outside `agent/save`. */
    private broadcastExposure;
    catalogFor(agentId: string): AcpAgentCatalog | undefined;
    /**
     * The settings panel's PERSISTENT catalog read: the last catalog observed for
     * one agent, or `undefined` when it has never published one.
     *
     * Pure memory (the same map `agentCatalog` reads, hydrated from
     * `model-catalog.json` at boot), so opening the settings page costs no agent
     * process. This is what lets the model panes show the configured selection
     * and the last known model list on mount instead of staying blank until
     * someone clicks 「检测可用模型」 — that button is a REFRESH of this cache
     * (models the agent newly publishes appear, models it stopped advertising
     * drop out), not the price of admission.
     */
    cachedAgentModels(agentId: string): AgentProbeModelsResult | undefined;
    /**
     * Probe one agent right now: spawn (if needed), open a throwaway session,
     * read its `configOptions`, close it. Errors propagate to the caller (the
     * RPC result or a notice broadcast).
     */
    probeAgentModels(agentId: string): Promise<AgentProbeModelsResult>;
    /**
     * Boot-time catalog warm-up.
     *
     * DELIBERATELY DOES NOTHING (user report, 2026-10-18: an unbound conversation
     * showed "Oh My Pi 已连接" in the agent picker, i.e. a second agent process was
     * running for a conversation served by another one).
     *
     * A probe SPAWNS A PROCESS. That is only defensible for an agent the user is
     * actually engaging with, so every probe now has a gesture behind it:
     *
     *  - a conversation bound to that agent → its first `session/new` fills the
     *    catalog in via `absorbCatalog` (that is the agent the user is talking to,
     *    already running);
     *  - the settings card's own button → `agent/probe-models`, one explicit click
     *    on one agent;
     *  - a STALE on-disk entry → repaired by `absorbCatalog` the next time that
     *    agent's own session publishes its options, not at boot.
     *
     * Probing every configured agent at startup — which is what this did — turns
     * "open the app" into "start N agent processes", and the picker then honestly
     * reports them as connected, which is exactly the confusion reported.
     */
    bootstrapCatalogs(): void;
    /**
     * The ACP model surface for ONE agent — the seats' own list (see
     * `AgentCatalogResult`). This is what the chat composer's ACP cluster and the
     * ACP-mode model seat render; DSH's native selector has no ACP entries at all
     * (`AcpLlmAdapter.listModels` advertises nothing), because the host builds one
     * global provider catalog with no per-session seam and every session would
     * then be offered ACP agents as if they were just another model.
     *
     * Variants are opt-in: an agent with no `exposedModels` (or an empty list)
     * offers only its base entry. Offering the whole catalog by default is not a
     * feature — these menus have no search, and a real agent publishes hundreds
     * of choices (pi: 500, omp: 581), so "everything by default" is a list storm
     * the user cannot navigate. The base entry is never filtered out.
     *
     * Pure memory — NEVER spawns and NEVER starts a probe. This is a RENDER path:
     * the composer entries call it on every store change, so anything that spawns
     * here turns "open a conversation" into "start every agent" (user report,
     * 2026-10-18: a conversation served by `codebuddy` had `omp` running). A
     * missing or stale catalog is reported honestly (`probed: false`, or the stale
     * entry's contents), and the probe is started by an explicit gesture:
     * `agent/probe-models` (the settings card's button) or a session's own
     * `session/new`, both of which are about ONE agent the user is actually using.
     */
    agentCatalog(agentId: string): AgentCatalogResult;
    /**
     * Resolve one exact ACP route id for validation/streaming. Unknown agents
     * throw (that is what turns `selectModel` into `model-unavailable`); known
     * agents NEVER throw — a stale variant degrades to a bare-id entry, because
     * the agent may have dropped a model it used to publish and an
     * already-selected session must keep working.
     */
    resolveAdapterModel(provider: string, model: string): LlmResolvedModelInfo;
    /**
     * DSH reasoning metadata built from the agent's `thought_level` option:
     * efforts come from its choices and `defaultEffort` from the current value
     * (only when it is one of the choices — DSH rejects unknown defaults).
     */
    private reasoningMeta;
    /**
     * Bring the live ACP session's model / thought level in line with what the
     * chat UI selected: diff the session's current `configOptions` and call
     * `session/set_config_option` only for drifting entries. Best effort by
     * design — failures broadcast a notice and the turn proceeds with the
     * agent's current configuration.
     *
     * A requested model the agent no longer offers (it publishes a non-empty
     * choice list without it) is STALE. Alignment does NOT apply it and does NOT
     * delete the pick: the caller refuses the turn so another model is never run
     * unexpectedly (see `staleModelChoice` / `streamPrompt`), and the user can
     * see which selection needs replacing. A stale thought level is still
     * dropped with a one-time notice: it does not change WHICH model runs.
     * The notice is tied to that transition, not to every turn — the turn path
     * aligns twice (session materialization, then the prompt) and both calls
     * would otherwise report the same drop.
     */
    private alignSessionConfig;
    /**
     * Remove one persisted pick the agent no longer honours. Only the thought
     * level uses this today: a stale MODEL pick is deliberately kept and the
     * turn refused, so the user can see which selection must be replaced.
     * Returns true only when a record actually changed — that transition is the
     * news the notice reports.
     */
    private dropStalePick;
    /**
     * The requested model value this session's agent no longer offers, if any —
     * the gate the turn path uses to refuse before sending anything.
     *
     * Reads only the session's OWN latest `configOptions` (the same authority
     * alignment uses): a non-empty choice list without the value means the agent
     * dropped it, and applying is impossible. `undefined` means either no model
     * was requested, it is in force, or nothing authoritative is available (no
     * selector, or a selector without choices) — those keep the previous
     * best-effort behavior instead of wedging the conversation.
     *
     * Falling back to "whatever the agent runs" here is exactly the surprise this
     * gate forbids: a different model can differ in price and capability. The
     * pick is kept so the failure names a selection the user can act on.
     */
    private staleModelChoice;
    private bridge;
    private find;
    private tryLocate;
    /**
     * Locate a session for an interaction, resuming it first when it was
     * released by an agent crash ("send to recover"). Resuming spawns a fresh
     * process and runs `session/load`, so the first prompt after a crash pays
     * the restart cost once and the conversation continues.
     */
    private locateOrResume;
    private connectionLost;
    agentViews(): AgentView[];
    detectAgents(): Promise<DetectedAgentInfo[]>;
    saveAgent(def: AcpAgentDef): Promise<void>;
    /**
     * Lightweight model-visibility update: mutates the def in place (the live
     * bridge shares the same object, so nothing needs restarting), persists, and
     * republishes status. `undefined` clears the filter, which — being the same
     * as `[]` — leaves only the agent's base entry in the ACP seats.
     */
    setExposedModels(agentId: string, exposedModels: readonly string[] | undefined): Promise<void>;
    /**
     * Toggle auto-discovery of newly published models. Lightweight like
     * `setExposedModels`: the def is mutated in place (live bridges share the
     * object) and persisted; no process is restarted, and the current selection
     * is left exactly as it is. On is the default, so only the opt-out
     * (`false`) is written to the file.
     */
    setAutoDiscoverModels(agentId: string, autoDiscoverModels: boolean): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;
    /**
     * Spawn a throwaway agent process from raw form values and run the ACP
     * handshake against it. The bridge is never registered in `defsMap` /
     * `bridges` and broadcasts on a private hub with no sinks, so a test cannot
     * touch persisted config, real sessions, or the browser event stream. The
     * process is torn down in every outcome.
     */
    testAgent(def: AcpAgentDef): Promise<AgentTestResult>;
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
    shutdownAll(): Promise<void>;
    /** Host-side reader of the harness preset roster (`ctx.agentPresets`), for `presetStatus`. */
    private presetRosterReader?;
    /**
     * The plugin's own default ACP agent (the panel's ★ gesture): which agent an
     * ACP-mode conversation starts on. Host-side state in the agent registry
     * file — deliberately NOT a DSH model route: nothing here ever writes to the
     * host's model selection (see docs/acp-convergence.md §2.2).
     */
    defaultAgent(): string | undefined;
    setDefaultAgent(agentId: string | undefined): Promise<void>;
    /** The agent tag's halo preference (composer display, plugin-private). */
    tagHalo(): AcpTagHalo;
    setTagHalo(halo: AcpTagHalo): Promise<void>;
    /**
     * Declare the deployment baseline for the two approval deadlines — the values
     * `cordis.patch.yml` names, passed RAW (only the keys it actually contains).
     *
     * Kept separate from the validated tuning because "the file says 600000" and
     * "the file says nothing, so 300000 applies" are different facts: the settings
     * card shows the first as the reset target and the second as a built-in
     * default. Called once by the host entry, before any bridge exists — and it
     * also moves the baseline, so a manager built without tuning (a direct
     * consumer, a test) still runs what the deployment asked for.
     */
    setConfiguredApprovalDeadlines(values: Partial<Record<ApprovalDeadlineKey, number>>): void;
    /**
     * The approval deadlines in force, plus the two facts that explain a value the
     * user did not pick: the config-file baseline an override is outranking, and a
     * `permissionTimeoutMs` that overrides BOTH windows when non-zero. Both are
     * reported only when they are actually in play, so the card can stay silent
     * about a plain default.
     */
    approvalDeadlines(): AcpApprovalDeadlines;
    /**
     * Write one or both approval deadlines (omitted keys keep their value), or
     * drop the persisted override with `reset` so the config-file baseline — or
     * the built-in default — applies again.
     *
     * HOT: the rewrite reaches every live bridge, so a user changing the window
     * never has to kill a running session to see it take effect (the one thing an
     * `agent/save`-style restart would cost them). Only asks armed AFTER the
     * write see the new window; an ask already holding a timer keeps the one it
     * started with.
     */
    setApprovalDeadlines(patch: Partial<Record<ApprovalDeadlineKey, number>>, reset?: boolean): Promise<void>;
    /**
     * Recompute the two deadlines from override → deployment baseline, and push
     * the result to every live bridge.
     */
    private applyDeadlineTuning;
    private readonly dshSessionMap;
    /**
     * What each DSH chat session has chosen for its ACP agent — the agent itself
     * plus the agent's model and thought level. Persisted with the agent registry
     * (`conversations`), so the pick survives a host restart and is readable
     * before the conversation has ever run a turn. This is the plugin's own
     * conversation↔agent mapping, never a DSH model route (see `bindChatAgent`).
     */
    private readonly chatAgentIntent;
    /** Drop every chat-keyed record pointing at one host session (close/stop paths). */
    private forgetDshSession;
    /**
     * Latest native-approval requester. Held as a field (read through a thunk by
     * each bridge) so a requester wired after bridges were built still applies.
     */
    private approvalRequester?;
    private sessionWorkspaceResolver?;
    private acpModeResolver?;
    /** Cached `chatSessionAcpMode` answers, keyed by DSH chat session id. */
    private readonly acpModeCache;
    /** In-flight cold reads behind `chatSessionAcpModeAnswer`, keyed by session id. */
    private readonly acpModeInflight;
    /**
     * The agent values the composer is showing for a conversation that has not
     * picked them — the catalog's current model, thought level and extra config
     * values.
     *
     * Captured BEFORE `session/new`: materializing the session absorbs its own
     * defaults into the catalog (`absorbCatalog`), which would overwrite exactly
     * the values the user saw and leave the first turn running the agent's
     * defaults instead. Reading is pure memory, same as `agentCatalog`.
     */
    private displayedChatDefaults;
    /**
     * Record what the composer showed as this conversation's pick before the
     * first prompt runs.
     *
     * A conversation with no explicit pick displays the agent catalog's current
     * model / thought level / extras, while the ACP session `session/new` just
     * created starts on whatever the agent itself defaults to. Without this the
     * user is shown one model and the agent runs another — the defect reported
     * as "the displayed model was not used". Values the fresh session does not
     * offer are skipped (its `configOptions` are the authority, and the catalog
     * update that rode `session/new` will correct the display), never turned
     * into a failed first turn. Explicit picks always win: only missing fields
     * are filled.
     */
    private seedChatChoiceFromCatalog;
    getOrCreateDshSession(dshSessionId: string | undefined, agentId: string, cwd?: string): Promise<LiveSession>;
    streamPrompt(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export declare class AcpLlmAdapter implements LlmAdapterLike {
    private readonly manager;
    constructor(manager: BridgeManager);
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): undefined;
    imageRequestPricing(_provider: string, _model: string): undefined;
    /**
     * Advertise NOTHING, on purpose (see `AgentCatalogResult` and
     * `BridgeManager.agentCatalog`).
     *
     * DSH's model catalog is per request, not per session (`buildModelCatalog(ctx)`
     * takes no session id), so an `acp` that listed models would list them in
     * every conversation — including the ones with no ACP agent behind them. The
     * catalog is advisory (its own contract: "an adapter may accept unlisted model
     * ids, and consumers must not turn absence into request rejection"), and route
     * liveness is judged by registration, not by this list, so `acp@agent` and
     * `acp@agent@choice` still resolve and stream while being advertised nowhere.
     * An empty list also keeps this hot path (every `session.models` / `llm.models`
     * request) allocation-free: there is no per-session seam to filter with, so
     * nothing may be listed until there is. The ACP seats read the per-agent view
     * through `agent/catalog` instead.
     */
    listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export declare class AsyncQueue<T> {
    private queue;
    private resolvers;
    private closed;
    push(item: T): void;
    close(): void;
    [Symbol.asyncIterator](): AsyncIterator<T>;
}
export {};
