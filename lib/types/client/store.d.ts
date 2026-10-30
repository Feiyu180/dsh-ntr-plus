/**
 * Browser-side state store for the ACP panel. Owns: the `/acp` RPC calls, the
 * `/api/acp/stream` EventSource, per-session block folding (raw ACP
 * `session/update` → render blocks), and the pending permission set.
 *
 * Deliberately framework-free: React binds through `useSyncExternalStore`.
 */
import type { AcpApprovalDeadlines, AcpConversationChoice, AcpPresetStatus, AcpTagHalo, AgentCatalogResult, AgentProbeModelsResult, AgentSavePayload, AgentTestResult, AgentView, ChatSessionView, ApprovalDeadlineKey, DetectedAgentInfo, SessionView } from '../protocol.ts';
/** One slash command the ACP agent declared, whole row (the menu draws name, description and `input.hint`). */
export type AgentCommand = NonNullable<ChatSessionView['availableCommands']>[number];
/** The unary RPC face (narrowed `ctx.connection.rpc.call`). */
export type RpcCall = (channel: string, endpoint: string, payload: unknown) => Promise<{
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}>;
export type Block = {
    kind: 'user';
    text: string;
} | {
    kind: 'agent';
    messageId?: string;
    text: string;
} | {
    kind: 'thought';
    text: string;
} | {
    kind: 'tool';
    toolCallId: string;
    title: string;
    status: string;
    toolKind?: string;
    lines: string[];
    /**
     * Structured ACP diffs (`content: [{type:'diff'}]`). Kept apart from
     * {@link lines} because a diff is the one tool payload worth rendering as
     * a diff: flattening it to `diff <path>` throws away everything that makes
     * an edit reviewable.
     */
    diffs?: Array<{
        path: string;
        oldText: string | null;
        newText: string;
    }>;
    /** Text items the card cannot render (diff output, an unknown content kind's JSON). */
    extras?: string[];
    /**
     * The call's arguments, as the agent sent them (`rawInput` / `arguments`).
     * Rendered read-only under the header: the real model's view of "it ran
     * `ls -la`" is that line, and the old fold dropped it entirely.
     */
    input?: string;
    /** The call's other named fields (`kind`, `status`, `locations`, `terminalId`, `meta`), one `key: value` per line. */
    details?: string[];
    /** The whole notification this block was last written from, pretty-printed. */
    raw?: string;
} | {
    kind: 'plan';
    entries: Array<{
        content: string;
        status: string;
        priority?: string;
    }>;
}
/**
 * Any other ACP notification, kept whole: an available-commands list, a mode
 * change, or a kind newer than this build. `text` is the readable fold and
 * `raw` the untouched payload — an agent's word the ACP view cannot format is
 * still an agent's word.
 */
 | {
    kind: 'event';
    event: string;
    text: string;
    raw?: string;
    status?: string;
} | {
    kind: 'notice';
    tone: 'info' | 'error';
    text: string;
};
export interface PendingPermission {
    requestId: string;
    sessionId: string;
    title: string;
    options: Array<{
        optionId: string;
        name: string;
        kind: string;
    }>;
}
/**
 * One observed ACP transcript, keyed by ACP session id. This is the ACP view
 * tab's data source: the native chat plane can only render text/reasoning
 * (that is the LLM adapter's entire chunk vocabulary), so the real tool calls,
 * plans and diffs live here and nowhere else.
 */
export interface ChatTranscript {
    /** The DSH chat session this ACP session belongs to (its refetch address). */
    owner: string;
    session: SessionView;
    blocks: Block[];
    /** Highest folded transcript seq (gap detection for the live stream). */
    seq: number;
}
export interface UiState {
    open: boolean;
    /**
     * Bumped by {@link AcpStore.refreshLocale}. Labels resolve while rendering,
     * but memoized transcript rows compare props — this counter is what tells
     * them the language switched.
     */
    localeRev: number;
    stream: 'init' | 'live' | 'down';
    agents: AgentView[];
    /**
     * Whether the host has answered `agents/list` at least once in this page.
     * `agents: []` alone cannot tell "no agent configured" from "not read yet";
     * a surface that offers a setup entry on an empty roster must wait for this.
     */
    agentsLoaded: boolean;
    sessions: SessionView[];
    activeSessionId?: string;
    blocks: Block[];
    permissions: PendingPermission[];
    busy: boolean;
    notice?: string;
    /**
     * The plugin's OWN default ACP agent (the panel's ★ gesture) — which agent a
     * new ACP-mode conversation starts on. NOT the deployment default model: that
     * one is global to every mode, and nothing in this bundle writes it.
     */
    defaultAgent?: string;
    detectedAgents: DetectedAgentInfo[];
    detecting: boolean;
    /**
     * Outcome of the last explicit re-detect (`重新检测与刷新`). Detection
     * usually finds exactly what the panel already renders — without this line
     * the button reads as dead. Set only by an explicit click, not the ambient
     * resync, and cleared again when that click's detection fails (a stale success
     * line next to the failure notice reads as if nothing happened).
     */
    detectSummary?: string;
    /** Probed model catalogs per agent id (from `agent/probe-models`). */
    modelCatalogs: Record<string, AgentProbeModelsResult>;
    /**
     * Per-agent ACP model surfaces (from `agent/catalog`) — the data source for
     * the conversation-side chips and the ACP-mode model seat. Kept apart from
     * {@link modelCatalogs} on purpose: that one is the panel's full probe
     * result (every choice an agent published), while this is the filtered,
     * ready-to-render list the seats offer.
     */
    seatCatalogs: Record<string, AgentCatalogResult>;
    probingModels: Record<string, boolean>;
    /**
     * Last probe failure per agent id, rendered next to the button that
     * triggered it. `notice` alone is not enough: it lives at the top of the
     * settings panel, so a probe failing below the fold (missing cwd, an agent
     * that never answers, …) reads as a dead button.
     */
    probeErrors: Record<string, string>;
    /**
     * Host reports that it HAS the native approval chain (permission asks are
     * answered in the chat composer). This is a capability report, not a
     * per-ask promise: an individual ask still falls back to the settings-panel
     * ledger when the service is unavailable this time, or when the session has
     * no chat identity behind it (`AgentBridge.askNativeApproval`). The panel
     * therefore answers ANY pending ask, whatever this flag says — see
     * `permissionLedgerCard` in panel.tsx. False on an older host or when the
     * approval service is missing, in which case the ledger is the only path.
     */
    approvalRouted: boolean;
    /**
     * ACP agent sessions backing the chat session the composer control sits in.
     * Only meaningful together with {@link chatSessionsFor}: the control reads it
     * by chat session id, so a stale list from another conversation never renders.
     */
    chatSessions: ChatSessionView[];
    /** The DSH chat session id {@link chatSessions} was loaded for. */
    chatSessionsFor?: string;
    /**
     * The agent tag's halo preference (settings-editable display choice). The
     * tag reads it per render; the host answer in `resync` is the authority and
     * a write lands optimistically first.
     */
    tagHalo: AcpTagHalo;
    /**
     * The approval deadlines in force, as the settings card edits them. Absent on
     * a host half from before the card existed, which hides the card rather than
     * showing a number this browser invented. Writes land optimistically and the
     * host answer (returned by the same route) is the authority.
     */
    approvalDeadlines?: AcpApprovalDeadlines;
    /**
     * Per-chat-session "does this conversation run the ACP preset" verdicts, as
     * reported by `session/chat-list` (host-read from the session log). The
     * composer surfaces fall back to this when the client runtime's session rows
     * carry no `agentPreset` (older hosts); a session never asked about is simply
     * absent.
     */
    acpMode: Record<string, boolean>;
    /**
     * Per-chat-session ACP agent binding, as reported by `session/chat-list`'s
     * `boundAgentId` (the host's intent map plus its live-session fallback): who
     * serves this conversation's NEXT message. `session/chat-bind` writes the
     * optimistic entry here the moment the click succeeds — the live session
     * list cannot reflect a switch until a turn materializes a session for the
     * new agent, and the chip would otherwise keep naming the previous agent.
     */
    chatBoundAgent: Record<string, string>;
    /**
     * Per-chat-session agent lock, as reported by `chat/agent-locked` (the live
     * path) or `session/chat-list`'s `lockedAgentId` (the fallback): the first
     * ACP turn has STARTED, so this conversation belongs to that agent and
     * cannot be switched. The lock is provisional until that turn shows
     * something; `chat/agent-unlocked` removes it when it delivers nothing. The
     * composer hides its agent base and shows a read-only tag for this agent.
     * The id is kept even when the agent has been deleted from the roster — the
     * conversation is still locked to it.
     */
    chatLockedAgent: Record<string, string>;
    /**
     * Per-chat-session serial for a lock THIS page saw arrive — bumped by the
     * `chat/agent-locked` frame (the live path, sent when the first turn starts)
     * or by a later `session/chat-list` answer that first reports `lockedAgentId`
     * (the fallback when the frame was missed). A rolled-back first turn followed
     * by a retry therefore gets a fresh serial, and its ceremony plays again.
     *
     * This is the animation's trigger, and the reason it cannot replay on a page
     * load: a conversation that is already locked when its list is first read
     * has no entry here. The composer's base and its edge tag
     * (`agent-lock-anim.ts`) play the shatter/condense hand-off only for a serial
     * they have not consumed.
     */
    agentLockReveal: Record<string, number>;
    /**
     * The conversation's persisted pick — model and thought level — as reported by
     * `session/chat-list`'s `choice`, and written optimistically the moment a
     * picker commits one.
     *
     * This is the record that makes a conversation usable BEFORE it has ever run
     * a turn: without it the model / thought-level chips can only reflect a live
     * ACP session, which does not exist until the first message has already gone
     * out on whatever the agent's defaults were.
     */
    chatChoice: Record<string, AcpConversationChoice>;
    /**
     * The model-seat shadow gate's own account of what it last decided, and why
     * (`src/client/index.tsx`'s `syncAcpMode`). Read-only, human-facing, and
     * rendered by the ACP view: every branch of that gate ends with the native
     * model seat either shadowed or not, and without this line the four ways it
     * can end "not shadowed" are indistinguishable from the outside — which is
     * exactly how "the ACP base still has not been replaced" became unreadable.
     */
    seatDiag: string;
    /**
     * Diagnostic summary from the permission-seat blanking gate (`conversation.input.permission`).
     */
    permissionSeatDiag: string;
    /**
     * Why slash isolation is not in force, when it is not (`idle` while it is).
     * Isolation degrades OPEN — an unrecognized source shape leaves the host's
     * commands in charge — so without this line the only symptom would be a menu
     * that quietly lists the wrong commands.
     */
    slashDiag: string;
    /**
     * Observed ACP transcripts keyed by ACP session id. Only sessions the
     * conversation's ACP view asked for are watched (live `session/update`
     * frames fold straight into them), and the map is capped so a long browsing
     * session cannot accumulate every transcript it ever looked at.
     */
    chatTranscripts: Record<string, ChatTranscript>;
    /**
     * State of the host's ACP-mode agent preset IN THE HARNESS ROSTER (the entry
     * the new-session picker shows). `undefined` when the host serves no roster
     * (`preset/status` answering `null`), in which case the panel hides the block.
     */
    preset?: AcpPresetStatus;
}
interface Listener {
    (): void;
}
/** Pretty-printed JSON of an agent message (never throws, cuts only at {@link RAW_MAX} with a marker). */
export declare function jsonText(value: unknown): string;
/**
 * The call's arguments as the agent sent them. Accepts every spelling seen in
 * the wild (`rawInput` / `arguments`, string / object / array) and never
 * invents one: a call with no input gets `undefined`.
 */
export declare function toolInputOf(update: Record<string, unknown>): string | undefined;
/** The call's other named fields, one `key: value` per line. */
export declare function toolDetailsOf(update: Record<string, unknown>): string[];
/** The readable fold of a notification the view has no card of its own for. */
export declare function describeEvent(kind: string, update: Record<string, unknown>): string;
export declare const DEFAULT_KNOWN_PRESETS: DetectedAgentInfo[];
export declare class AcpStore {
    private readonly rpc;
    private readonly locale;
    private state;
    private readonly listeners;
    private source?;
    private readonly lastSeq;
    /** Sessions with a finalized turn (dedups the cancel-fallback + late real turn/end pair). */
    private readonly openTurns;
    /** In-flight `session/chat-list` reads, keyed by chat session id. */
    private readonly chatSessionReads;
    /**
     * Chat sessions whose list has answered at least once in this page. The
     * FIRST answer only seeds the lock; a lock appearing on a later answer is a
     * transition this page actually witnessed, and only that one is announced via
     * {@link UiState.agentLockReveal}.
     */
    private readonly chatListLoaded;
    /**
     * Conversations whose provisional first-turn lock the host rolled back
     * (`chat/agent-unlocked`, no visible output in the first turn). A
     * `session/chat-list` read that started BEFORE the rollback can still name
     * `lockedAgentId`; it must not revive the lock. A new `chat/agent-locked`
     * frame clears the entry (the user retried and the turn really started).
     */
    private readonly chatUnlocked;
    /**
     * Sessions whose ACP-mode verdict a committed `agent-preset/selected` frame
     * settled. A frame settles the verdict; the host's log read can lag a switch
     * by one (the appended row is not yet visible to a fresh read, and the seat
     * taking the model cell re-mounts readers), so a read may only settle a
     * session no frame has spoken for — otherwise a stale answer would regress a
     * verdict the runtime already told us the truth about.
     *
     * The ONE exception is the gate's own re-ask ({@link loadChatSessions} with
     * `settleVerdict`): a verdict the gate has held as its only fact source for
     * longer than its TTL is exactly the case where the frame path has gone
     * quiet, and without an authorized re-read a switch the runtime never framed
     * could never be corrected.
     */
    private readonly acpModeLive;
    /**
     * Chat sessions whose host read came back WITHOUT a verdict (no `acpMode`
     * field, or the read failed). The seat gate consults this to retract its
     * one-shot ask ledger entry, so a read that could not answer costs one retry
     * instead of leaving the native model seat visible for the rest of the page.
     */
    private readonly acpModeUnsettled;
    /** In-flight `agent/catalog` reads, keyed by agent id. */
    private readonly seatCatalogReads;
    /** In-flight `agent/cached-models` reads, keyed by agent id. */
    private readonly cachedModelReads;
    /** Counts behind the last successful explicit re-detect, so a locale switch can re-render its summary. */
    private detectCounts;
    constructor(rpc: RpcCall, locale: (zh: string, en: string) => string);
    subscribe(listener: Listener): () => void;
    getSnapshot(): UiState;
    private mutate;
    /**
     * Live `session/update` frames waiting to be folded. Agents stream at token
     * granularity — hundreds of frames a second with usage ticks interleaved —
     * and folding plus notifying listeners per frame re-rendered every store
     * consumer per chunk. Frames are coalesced into ONE fold + ONE mutate per
     * animation frame instead; the order inside a batch is preserved, and the
     * transcript watermark (`lastSeq`) advances per batch.
     */
    private readonly pendingUpdates;
    private updateFlushArmed;
    /** Fold everything pending now (idempotent; the scheduler clears its flag). */
    flushUpdates(): void;
    private armUpdateFlush;
    /** Open the shared event stream once; schedule first snapshot fetch. */
    start(): void;
    private connectStream;
    private call;
    /** Snapshot refresh used on panel open and after a stream outage. */
    resync(): Promise<void>;
    detectAgents(): Promise<void>;
    private detectSummaryOf;
    saveAgent(payload: AgentSavePayload): Promise<void>;
    /**
     * Dry-run the connection form: the host spawns a throwaway process from
     * these exact values, handshakes, and tears it down. A reachable-but-broken
     * agent arrives as `{ ok: false }`, not a thrown error; only transport or
     * validation failures reject.
     */
    testAgent(payload: AgentSavePayload): Promise<AgentTestResult>;
    /**
     * Seed one agent's model panes from the host's PERSISTENT catalog cache
     * (`agent/cached-models`, memory-only: it never spawns).
     *
     * The settings card used to learn a catalog only from `agent/probe-models`,
     * so its panes stayed blank until the user clicked 「检测可用模型」 on every
     * visit — including the models already configured, which are known from the
     * agent definition and the on-disk catalog. This read fills both panes on
     * mount; the probe stays the explicit REFRESH (add what the agent newly
     * publishes, drop what it stopped advertising).
     */
    loadCachedModels(agentId: string): Promise<void>;
    /** Ask the host to probe one agent's model catalog (spawn + throwaway session). */
    probeModels(agentId: string): Promise<void>;
    private clearProbeError;
    /**
     * Read one agent's ACP model surface (`agent/catalog`) — what the composer
     * chips and the ACP-mode model seat render. Cached per agent, because the
     * list only changes when the agent's catalog is re-probed or its exposure
     * filter is edited (both of which drop the cache below), and deduped because
     * every ACP surface asks for it on mount.
     *
     * The host answers from memory, so this is safe to call from a render effect;
     * a probe it may trigger runs in the background on the host side.
     */
    loadAgentCatalog(agentId: string): Promise<void>;
    /** Drop one agent's cached seat catalog (its model surface just changed). */
    private invalidateSeatCatalog;
    /**
     * Persist the ACP-seat model filter for one agent. `undefined` clears the
     * filter — same as an empty list, i.e. no `agentId@choice` variants, only
     * the agent's base entry. Uses the dedicated lightweight RPC so the agent
     * process and its live sessions are never restarted.
     */
    setExposedModels(agentId: string, exposedModels: string[] | undefined): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;
    /**
     * Persist the auto-discovery switch for one agent. Lightweight like
     * {@link setExposedModels}: no process restart, and the current selection is
     * left exactly as it is.
     */
    setAutoDiscoverModels(agentId: string, autoDiscoverModels: boolean): Promise<void>;
    toggle(): void;
    close(): void;
    selectSession(sessionId: string): void;
    private loadTranscript;
    startSession(agentId: string, cwd?: string): Promise<void>;
    sendPrompt(text: string): Promise<void>;
    cancelActive(): Promise<void>;
    closeActive(): Promise<void>;
    setMode(modeId: string): Promise<void>;
    /**
     * Load the ACP agent sessions backing one DSH chat session. The composer
     * control calls this per chat session (and again whenever a turn settles, so
     * the binding a fresh conversation just created shows up).
     */
    /**
     * Load the ACP agent sessions backing one DSH chat session. The composer
     * control calls this per chat session (and again whenever a turn settles, so
     * the binding a fresh conversation just created shows up).
     *
     * `settleVerdict` is the seat gate's own re-ask and the ONLY read allowed to
     * settle a verdict a frame had already settled (see {@link acpModeLive}): the
     * gate holds such a verdict as its only fact source while the session row
     * stays silent, and a host read is the one place a switch the runtime never
     * framed can still be learned from. Composer readers pass nothing and keep
     * the frame's authority.
     */
    loadChatSessions(dshSessionId: string, options?: {
        settleVerdict?: boolean;
    }): Promise<void>;
    private readChatSessionList;
    /**
     * Abandon the in-flight `session/chat-list` read for one session (or all of
     * them): a committed `agent-preset/selected` frame carries the authoritative
     * verdict, and the late answer to an ask that predates the frame describes
     * the log from before the switch — it must not land in the store.
     */
    abandonChatSessionRead(dshSessionId?: string): void;
    /**
     * The slash commands the LIVE ACP session declared for one chat session, as
     * read by {@link loadChatSessions} (`available_commands_update` →
     * `session/chat-list`).
     *
     * `undefined` covers both "no answer has landed yet" and "there is no live
     * session (or it has not declared anything)" — in every one of those cases
     * the caller falls back to the agent-level cache ({@link agentCommands}),
     * which is what makes `/` list commands before the first message exists.
     */
    chatSessionCommands(dshSessionId: string): readonly AgentCommand[] | undefined;
    /**
     * The slash commands the agent declared in its most recent session, from
     * `agent/catalog` (host-cached per agent, see `AgentCatalogResult.commands`).
     * The pre-first-turn source for the `/` menu.
     */
    agentCommands(agentId: string | undefined): readonly AgentCommand[] | undefined;
    /**
     * Which agent serves one conversation as far as this page can tell, without
     * reading any catalog: live ACP session → agent lock → host/optimistic
     * binding → persisted pick → plugin default. Used to find the agent whose
     * cached commands the `/` menu should offer before a session exists.
     */
    chatAgentFor(dshSessionId: string): string | undefined;
    /**
     * Record the verdict a committed `agent-preset/selected` frame carries, folded
     * from the frame's own preset field ({@link acpModeFromPresetEvent}). The
     * frame is authoritative: it marks the session live-settled, so no later host
     * read may regress it (see {@link acpModeLive}) — the gate's own TTL re-ask
     * being the one authorized exception. Same no-op-when-unchanged discipline as
     * the other accessors, so a frame restating the held verdict costs no
     * listener churn.
     */
    noteAcpMode(dshSessionId: string, acpMode: boolean): void;
    /**
     * Record the model-seat gate's last decision (see the `seatDiag` field). The
     * gate owns the string; the store only carries it so the ACP view can render
     * *why* the native seat is or is not shadowed. No-op when unchanged, so the
     * gate can call this on every evaluation without churning listeners.
     */
    noteSeatDiag(text: string): void;
    /**
     * Record the permission-seat gate's last decision (`conversation.input.permission`).
     */
    notePermissionSeatDiag(text: string): void;
    /**
     * Record the slash-isolation seam's last verdict (`idle` = in force, or no
     * problem to report). No-op when unchanged, like the seat lines.
     */
    noteSlashDiag(text: string): void;
    /**
     * Whether a chat session's host read produced a verdict the seat gate can
     * rely on. `false` means "asked but not answered" — the read returned no
     * `acpMode` field or failed outright — and is the signal for the gate to
     * retract its one-shot ask ledger entry for this id so it can ask again.
     *
     * A verdict handed down by a committed `agent-preset/selected` frame is
     * authoritative and outranks everything (see {@link acpModeLive}); such a
     * session always answers `true` here, settled or not.
     */
    hasAcpModeVerdict(dshSessionId: string): boolean;
    /**
     * Drop one chat session's ACP-mode verdict — or the whole map. The preset
     * switch a session committed is announced by the host (`agent-preset/selected`)
     * and folded by the runtime into its own rows, but NOT into this map, so the
     * gate re-asks instead of trusting a verdict the session log has moved past.
     */
    invalidateAcpMode(dshSessionId?: string): void;
    /**
     * Switch the ACP agent's own mode for one chat session (`session/set_mode`),
     * then re-read the binding so the control reflects what the agent actually
     * reports (a rejected switch must not leave an optimistic lie on screen).
     */
    setChatSessionMode(dshSessionId: string, modeId: string, agentId?: string): Promise<void>;
    /**
     * Start (or refresh) observation of every ACP transcript behind one DSH chat
     * session. Blocks are rebuilt from scratch — the host buffer is the record,
     * and this view is the only consumer that needs the raw agent stream.
     */
    loadChatTranscript(dshSessionId: string): Promise<void>;
    /** Observed transcript for one ACP session id (undefined → nobody is watching it). */
    transcriptOf(acpSessionId: string): ChatTranscript | undefined;
    /** The observed transcript of one chat session (the live binding wins over a released one). */
    chatTranscriptOf(dshSessionId: string): ChatTranscript | undefined;
    /** Keep the resident transcript map at its bound, newest insertion first. */
    private evictTranscripts;
    /** Re-publish an observed transcript's session snapshot (mode / released flips). */
    private watchedSessionPatch;
    /** Mirror the running flag onto a transcript the ACP view is showing. */
    private markWatchedRunning;
    setConfigOption(configId: string, value: string): Promise<void>;
    respondPermission(requestId: string, optionId?: string): Promise<void>;
    stopAgent(agentId: string): Promise<void>;
    /**
     * Set the plugin's OWN default ACP agent (the panel's ★ gesture): which agent
     * an ACP-mode conversation starts on. Plugin-private state — the host keeps it
     * in its own agent registry file, and nothing here touches DSH's model
     * selection (see docs/acp-convergence.md §2.2).
     */
    setDefaultAgent(agentId: string | undefined): Promise<void>;
    /**
     * Write the agent tag's halo preference (settings card). The value is
     * validated host-side; this side writes optimistically first so the tag's
     * look changes with the click, and reverts to the host answer on a failure.
     */
    setTagHalo(halo: AcpTagHalo): Promise<void>;
    /**
     * Write one approval deadline (settings card), or drop the persisted override
     * with `reset` so the `cordis.patch.yml` baseline applies again.
     *
     * The host answer — the same route returns the deadlines now in force — is the
     * authority, so an optimistic write that the host trims (out of range, or
     * merged with a value this browser did not know about) self-corrects instead
     * of drifting from what runs.
     */
    setApprovalDeadline(key: ApprovalDeadlineKey, ms: number): Promise<void>;
    /** Drop the persisted override: the config file (or the built-in default) decides again. */
    resetApprovalDeadlines(): Promise<void>;
    private writeApprovalDeadlines;
    /**
     * Bind one DSH chat session to an ACP agent. This is the plugin's own
     * conversation↔agent mapping: it does NOT write a DSH model route, so it
     * cannot pollute the deployment default model and cannot be refused by the
     * GUI's catalog gate (the retired `session/model-unavailable` failure).
     *
     * The mapping is host-side and keyed by chat session id; the browser learns
     * the binding back through `session/chat-list`.
     */
    bindChatAgent(dshSessionId: string, agentId: string): Promise<void>;
    /** Switch the bound agent's model (`agentId@choice`) for one chat session. */
    setChatSessionModel(dshSessionId: string, modelId: string, agentId?: string): Promise<void>;
    /** Switch the bound agent's reasoning effort for one chat session. */
    setChatSessionEffort(dshSessionId: string, effort: string | undefined, agentId?: string): Promise<void>;
    /** Set one of the bound agent's EXTRA config options for one chat session. */
    setChatSessionConfig(dshSessionId: string, configId: string, value: string | boolean, agentId?: string): Promise<void>;
    /**
     * Patch one conversation's optimistic pick. The agent half is required by the
     * record (a model or thought level belongs to an agent). Its owner is the
     * route the picker used, else the recorded pick, the optimistic binding, or
     * the plugin default — that last one really serves a never-bound conversation
     * (the guard routes to it), so waiting for `session/chat-list` would leave the
     * chip behind the click. Only a conversation with none of those is left alone.
     */
    private writeChoice;
    /**
     * Localize one string. BOUND to the instance in the constructor: the ACP
     * view hands this reference to memoized rows, so it must stay stable across
     * renders or every row re-renders on every store notification.
     */
    label: (zh: string, en: string) => string;
    /**
     * Republish the snapshot after a locale switch. Every `label()` resolves
     * against the current language while rendering, so a notification is all
     * that is needed — except the detect summary, which the store owns as an
     * already-resolved string and rebuilds from its counts here.
     */
    refreshLocale(): void;
    clearNotice(): void;
    private flashError;
    private applyEvent;
}
/** Merge a raw ACP update into the block list (mutates in place). */
/**
 * Fold one transcript update into a block list. IMMUTABLE per block: the ACP
 * view memoizes rows on the block object, so an appended chunk replaces the
 * tail block instead of mutating it (array copies stay the caller's job, one
 * per folded batch). Returns whether any block changed — a usage-only tick
 * folds to `false` and the batch skips copying the array.
 *
 * `raw` is a lazy getter: pretty-printing a tool payload costs up to
 * {@link RAW_MAX} characters of JSON per call, and progress ticks restate
 * whole calls at high frequency — the cost is paid once, by the view that
 * actually shows the card, never by the fold loop.
 */
export declare function foldUpdate(blocks: Block[], update: Record<string, unknown>): boolean;
/** Notifications that update the SessionView snapshot instead of the block stream. */
export declare const STATE_ONLY_UPDATES: ReadonlySet<string>;
export {};
