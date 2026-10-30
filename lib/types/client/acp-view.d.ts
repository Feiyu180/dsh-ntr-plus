/**
 * The conversation's ACP view tab: the agent's REAL stream, as the agent
 * produced it.
 *
 * WHY A TAB AS WELL AS THE CHAT: the native chat plane renders what the LLM
 * adapter emits, and the adapter's chunk vocabulary is text + reasoning — so
 * the agent's prose and thinking ride the native plane, while a fuller card (a
 * tool call with its arguments, a plan, a unified diff) has no chunk to ride
 * there. This view renders those as themselves.
 *
 * It is a VIEW, not a second client: it never prompts, never cancels, never
 * spawns. Everything it shows is host state.
 */
import type { AcpChatInjected } from './acp-ui.tsx';
import type { AgentView, ChatSessionView } from '../protocol.ts';
/** Props of the ACP view entry (injected face + the frame's session id). */
export interface AcpViewProps extends AcpChatInjected {
    sessionId: string;
}
/**
 * The store's bilingual label function (`AcpStore.label`). Exported because the
 * empty-state copy builder takes one and the bundle emits declarations.
 */
export type Translate = (zh: string, en: string) => string;
/** One line of a rendered unified diff. */
interface DiffRow {
    sign: '+' | '-' | ' ';
    text: string;
}
/**
 * Line diff with a common prefix/suffix trim plus an LCS over the remaining
 * middle — the standard shape that keeps an edit reviewable without pulling a
 * diff library into a browser bundle.
 */
export declare function diffRows(oldText: string | null, newText: string): DiffRow[];
/**
 * Whether one structured edit is a NEW FILE.
 *
 * Decided by the old side, never by the removal count: an existing file that
 * only gained lines also diffs to zero removals, and labelling that "new file"
 * hid a real edit behind a wrong badge (the audit's F8). The only old sides
 * that mean "nothing was there" are an absent one and one byte-identical to
 * the new content — the degenerate case where there is no edit at all.
 */
export declare function isNewFileDiff(oldText: string | null, newText: string): boolean;
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
export declare function boundAgentOf(session: ChatSessionView | undefined, hostBoundAgentId: string | undefined, pickedAgentId: string | undefined, agents: readonly AgentView[]): {
    id: string;
    title: string;
} | undefined;
/** What the view knows about this conversation when it has no transcript. */
export interface AcpEmptyFacts {
    /** The agent this conversation is set up on, when there is one. */
    bound?: {
        id: string;
        title: string;
    };
    /** Whether any agent is configured at all. */
    hasAgents: boolean;
    /**
     * This conversation's NTR-mode verdict, as the seat gate reads it
     * (`UiState.acpMode`). `undefined` while the host has not answered: the view
     * must not claim either way.
     */
    acpMode?: boolean;
}
/** The three lines of the empty state, already localized. */
export interface AcpEmptyCopy {
    title: string;
    body: string;
    /** The "what to do next" line; absent when nothing honest can be said. */
    hint?: string;
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
export declare function acpEmptyCopy(facts: AcpEmptyFacts, t: Translate): AcpEmptyCopy;
/**
 * The ACP view tab body: who serves this conversation and how it is doing,
 * then the agent's own stream.
 */
export declare function AcpConversationView(props: AcpViewProps): import("react").JSX.Element;
export {};
