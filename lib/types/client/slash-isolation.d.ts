/**
 * Slash isolation for ACP conversations.
 *
 * In an ACP conversation the composer's `/` menu belongs to the AGENT: the
 * commands it declared over `available_commands_update`. The host's own slash
 * machinery (`dsh-client-ui-commands` plus the client skill source) describes
 * commands THIS runtime would execute — `/model`, `/permission`, `/export`,
 * the DSH skill catalog — and a name it recognizes is consumed before the
 * draft ever reaches the prompt sink, so the agent never sees the line.
 *
 * There is no supported seam for "this session only": `InputTriggerService`
 * adjudicates in REGISTRATION order (`order` only sorts the menu), duplicate
 * `(trigger, name)` registration throws, and sources get no per-session
 * availability hook — so a source registered later can never outrank the
 * host's `command` source for one conversation. Replacing the whole composer
 * is the other option and is not worth the price (attachments, queue, draft,
 * shortcuts).
 *
 * What remains is wrapping the LIVE source objects in memory: same
 * registration, same menu group, different answers while the session is in ACP
 * mode. Nothing on disk is patched or imported, so an upstream change cannot
 * make a replacement file go missing — the worst case is that the source no
 * longer looks like what this module knows, and then nothing is wrapped and
 * the conversation keeps the host's behaviour (fail-open; a diagnostic line is
 * reported instead of an error).
 *
 * The wrappers are per CALL, not per instance: the source objects are shared
 * by every conversation, and the session id each hook receives is what tells
 * an ACP conversation from an ordinary one.
 */
import type { AcpSessionsSnapshot } from './acp-ui.tsx';
import type { AgentCommand } from './store.ts';
/** One menu row: the ACP command name, plus whatever makes it findable. */
export interface SlashCandidate {
    name: string;
    label?: string;
    description?: string;
    hint?: string;
}
/** The only field these hooks receive about the owning conversation. */
export interface SlashSession {
    readonly sessionId: string;
}
export interface SlashCandidateRequest {
    readonly query: string;
    /** Leading token vs. a `/` inside running text; hint-bearing rows are leading-only. */
    readonly position?: 'leading' | 'inline';
    readonly signal?: AbortSignal;
}
export interface SlashPick {
    readonly candidate: SlashCandidate;
    readonly session: SlashSession;
}
/**
 * One registered trigger source, narrowed to what isolation touches. Every
 * hook is optional because the contract makes them optional — a source that
 * never participated in Enter adjudication must not start participating just
 * because we wrapped its `candidates`.
 */
export interface SlashSource {
    readonly trigger: string;
    readonly name: string;
    candidates?: (session: SlashSession, req: SlashCandidateRequest) => Promise<readonly SlashCandidate[]>;
    matchEnter?: (session: SlashSession, line: string, signal: AbortSignal, envelope: {
        attachments: number;
    }) => Promise<unknown>;
    matchSpace?: (session: SlashSession, token: string) => unknown;
    onPick?: (pick: SlashPick) => unknown;
    warm?: (session: SlashSession) => void;
    lexicon?: (session: SlashSession) => readonly string[] | undefined;
    header?: (session: SlashSession, req: {
        query: string;
    }) => readonly unknown[] | undefined;
}
export interface SlashIsolationOptions {
    /** The live source registry (`inputTriggers.live.sources`), re-read on every sync. */
    sources(): readonly SlashSource[] | undefined;
    /** The ACP verdict this page holds; `undefined` = no answer yet. */
    verdict(sessionId: string): boolean | undefined;
    /** Ask the host and wait for the in-flight read, then answer again. */
    ensureVerdict(sessionId: string): Promise<boolean | undefined>;
    /**
     * The agent's declared commands for this conversation (live session first,
     * agent-level cache second); `undefined` = nothing known yet. May load the
     * cached surface first — that read is pure memory on the host.
     */
    commands(sessionId: string): readonly AgentCommand[] | undefined | Promise<readonly AgentCommand[] | undefined>;
    /** Kick a fresh `session/chat-list` read (fire and forget). */
    refresh(sessionId: string): void;
    /** Fail-open reports (console and the caller's own sink). */
    onDiag?(line: string): void;
}
export interface SlashIsolation {
    /**
     * Find and wrap every live `/` source. Idempotent and safe to re-run.
     * Returns whether isolation is in force (at least one `/` source is wrapped)
     * — `false` is what lets the caller keep retrying until the source exists.
     */
    sync(): boolean;
    /** Restore every wrapped source — only where our wrapper is still installed. */
    dispose(): void;
}
/**
 * Whether one chat session runs the ACP preset, under the same two fact
 * sources the seat gate uses: the staged row's own preset when it speaks, and
 * the host-read verdict otherwise. `undefined` = no evidence yet, which every
 * caller reads as "not ACP" (fail-open: an ordinary conversation must never
 * lose its native commands to a guess).
 */
export declare function slashAcpVerdict(snapshot: AcpSessionsSnapshot | undefined, sessionId: string, verdict: (sessionId: string) => boolean | undefined): boolean | undefined;
/**
 * The agent's commands as menu rows, ranked the way the host ranks its own
 * menu: the query matches as a case-insensitive ordered subsequence of the
 * command name; prefix hits come first, then the strongest alignment score,
 * then the agent's own order (empty query = everything, in that order).
 *
 * Matching is name-only, like `rankByName`: fuzzy-matching whole descriptions
 * surfaced rows nobody would think to look for, and the native menu has never
 * searched them.
 */
export declare function commandCandidates(commands: readonly AgentCommand[], query: string): SlashCandidate[];
export declare function createSlashIsolation(options: SlashIsolationOptions): SlashIsolation;
