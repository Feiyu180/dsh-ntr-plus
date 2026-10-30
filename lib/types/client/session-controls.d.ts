/**
 * The ACP base in the conversation composer's model seat
 * (`conversation.input.model`) and its picker (`conversation.input.overlay`).
 *
 * WHAT IT IS: the base of an ACP conversation. The first level is WHICH agent
 * serves it; hanging off that are the things the agent itself owns — its own
 * permission preset, its own model, its own thought level, and any further
 * config options it publishes (the "advanced" base). All of them come from the
 * agent (`agent/catalog`, the agent's own mode list), never from DSH's model
 * catalog: an ACP agent is not a DSH provider, and DSH's catalog has no
 * per-session seam to filter it with anyway. See
 * docs/acp-convergence.md §2.1.
 *
 * WHERE IT SITS: the composer's model seat — the trailing group of the bar,
 * immediately before the submit button. That is where the host's own base
 * (the model selector) sits, and it is the cell an ACP conversation must not
 * leave to that selector: it lists DSH's providers, none of which this
 * conversation can use, and clicking one writes the process-wide default
 * model. One cell, one occupant. The base is installed there by the ACP-mode
 * gate in `index.tsx` (see `createModelSeatClaim`), which holds it only while
 * the staged conversation runs the ACP preset — so an ordinary chat gets the
 * native selector back and sees no ACP chrome at all.
 *
 * WHAT IT ADDS over a bare model selector: the axes are separate. A native
 * selector would flatten them into one list of "Agent · Model" rows; here
 * "which agent", "which of ITS models", "how hard it thinks" and every extra
 * option the agent publishes are chips of their own. Before the first turn the
 * agent base is the fixed right-hand anchor; the advanced entry sits left of
 * the model, and model / thought sit between them. Once the lock retires the
 * base, model / thought inherit the right edge (user decision, 2026-10-21).
 *
 * ONE CONVERSATION, ONE AGENT (user decision, 2026-10-20): once this
 * conversation's first turn STARTS — its ACP session materializes, before the
 * prompt is sent — the agent base steps aside and the conversation is LOCKED to
 * that agent. The current agent then lives on a small, read-only tag that rides
 * the composer card's top edge (`AcpComposerAgentTag`, installed in
 * `conversation.input.overlay`). Before that first turn the base stays, so a
 * pick can still be changed before it is committed to a message. See
 * `agentBaseHidden`.
 *
 * The lock is provisional until that first turn delivers something: a turn
 * that ends without any visible block (an error before the first chunk, a
 * silent provider failure, a cancel) is rolled back by the host, the base
 * returns, and the picker works again. The composer learns both transitions
 * from `chat/agent-locked` / `chat/agent-unlocked`, not from a list read.
 *
 * The hand-off is a shatter-and-condense animation (`agent-lock-anim.ts`): the
 * base breaks into debris, then the tag forms from it. The two live in
 * different slots, so they share that module's phase clock rather than trying
 * to animate across slot boundaries.
 *
 * It is deliberately quiet: outside ACP mode the gate never mounts it, and
 * before the host has answered the agent roster it renders nothing. Once the
 * roster is KNOWN to be empty the base stays and its picker carries the
 * "open NTR settings" action — an NTR conversation with nothing configured
 * still has a way forward instead of an empty cell. The ACP view tab remains
 * the entry point for conversations no agent has served.
 */
import type { CSSProperties } from 'react';
import type { AcpChatInjected, AcpMenuKind, AcpMenuSection, AcpSessionHook } from './acp-ui.tsx';
import type { AcpConversationChoice, AcpTagHalo, AgentCatalogResult, AgentView, ChatSessionView } from '../protocol.ts';
/**
 * Props every entry in this file receives: the injected face (built in
 * `index.tsx` where the services live) plus the session id the slot frame
 * passes to `inject`.
 */
export interface AcpClusterProps extends AcpChatInjected {
    sessionId: string;
    /**
     * The framework's session snapshot hook (`SessionStandardProps.useSession`,
     * see `AcpSessionHook`). The cluster watches `running` alone: a fresh
     * conversation has no ACP binding until its first turn settles, so the binding
     * read is repeated then.
     */
    useSession: AcpSessionHook;
}
/** Everything the chips need to describe the current agent binding. */
interface RouteInfo {
    /** The agent serving this conversation. */
    agentId?: string;
    agentTitle?: string;
    modelId?: string;
    modelLabel?: string;
    efforts: readonly {
        id: string;
        name: string;
        description?: string;
    }[];
    /** `current.reasoningEffort` folded over the model's default (native seat semantics). */
    effectiveEffort?: string;
    effortLabel?: string;
}
/**
 * Whether the agent base has anything honest to show.
 *
 * An empty roster has two meanings, and they must not be conflated: before the
 * host answers `agents/list` it means "not read yet" (rendering a setup entry
 * there would accuse a correctly configured deployment on every page load),
 * while after the answer it means "nothing is configured" — exactly the state
 * that must keep the base and offer the way into NTR settings.
 */
export declare function agentBaseHasData(bound: ChatSessionView | undefined, agents: readonly AgentView[], rosterLoaded: boolean): boolean;
/**
 * The agent this conversation is LOCKED to, if its first ACP turn has run.
 *
 * The host's `lockedAgentId` is the durable answer: it is written when the
 * first ACP session materializes and it survives restarts, so it is the only
 * source that can still answer after the session is gone. The live/released
 * session is the fallback for a host half from before the lock existed — the
 * moment a session exists, the conversation already has context with it.
 *
 * There is deliberately no roster check: a deleted agent still owns the
 * conversation's context, and pretending the conversation is unbound would
 * bring back a picker the turn path has to refuse. The tag names the id even
 * when no title is left.
 */
export declare function lockedAgentOf(hostLockedAgentId: string | undefined, bound: ChatSessionView | undefined): string | undefined;
/**
 * Whether the composer's agent base has done its job and should step aside.
 *
 * The timing is the product decision (2026-10-20): at the START of this
 * conversation's first turn. A conversation that merely recorded a pick is
 * still being set up; the user may change their mind before sending, and
 * hiding the base there would strand the pick. Once locked, the base only
 * comes back if the host ROLLS THE LOCK BACK — a first turn that delivered
 * nothing, so there is no context to protect. It also stays retired when the
 * locked agent has been deleted from the roster: the conversation's context
 * still belongs to it.
 */
export declare function agentBaseHidden(lockedTo: string | undefined): boolean;
/**
 * Whether the composer-edge `NTR · <agent>` tag should render.
 *
 * The tag is the locked agent's nameplate: it appears exactly when the base
 * has stood down. The `acpMode` gate matters because the overlay entry is
 * registered for EVERY conversation while `ui.chatSessions` can still carry an
 * ACP session record after a conversation switched back to an ordinary preset:
 * an explicit `false` verdict must win over that lingering record, or the tag
 * would keep advertising an agent the conversation no longer runs. `undefined`
 * is "the host has not answered yet" and falls back to the lock itself, which
 * is proof this conversation was served by an agent.
 */
export declare function agentTagVisible(acpMode: boolean | undefined, lockedTo: string | undefined): boolean;
/**
 * Whether the tagged agent is LIVE: an ACP session serves this conversation
 * right now and it is not released (the process is up, or at least the host
 * has not marked the session suspended). This drives the tag's breathing
 * halo — released must turn it off, and the named agent must be the one the
 * live session actually serves. No session view at all reads as not alive:
 * before the first answer the state says nothing about the process.
 */
export declare function agentTagAlive(bound: ChatSessionView | undefined, lockedTo: string | undefined): boolean;
/** One breath cycle per halo speed, in seconds. Settings card offers these three. */
export declare const TAG_HALO_PERIODS: Record<AcpTagHalo['speed'], string>;
/**
 * The tag's halo presentation for one setting: the extra classes for the tag
 * span (`alive` — the session is live; steady mode replaces the pulse with a
 * constant glow) and the CSS variable the stylesheet reads for the period.
 * The variable is set for breath mode only: in steady mode nothing animates,
 * so a stale variable could never leak into the reduced-motion fallback.
 */
export declare function agentTagHaloPresentation(halo: AcpTagHalo, alive: boolean): {
    classes: string;
    style: CSSProperties;
};
/**
 * Describe this conversation's ACP agent from the binding (the host's record of
 * which agent actually serves it) + the agent roster + the agent's own model
 * surface (`agent/catalog`).
 *
 * An `undefined` agentId means nothing serves this conversation's next message
 * (see `routeAgentId`); every axis then degrades to nothing rather than naming
 * an agent the request path will never use.
 *
 * The model axis reads the ACP catalog, NOT any DSH model directory: an ACP
 * agent's models are the agent's own (see the module header), so there is
 * nothing to look up in DSH's catalog — and reading `current` off a directory
 * was the retired route axis.
 */
export declare function describeRoute(agents: readonly AgentView[], bound: ChatSessionView | undefined, defaultAgent: string | undefined, catalog?: AgentCatalogResult, boundAgentId?: string, choice?: AcpConversationChoice): RouteInfo;
/** One extra config option as the advanced base presents it. */
export interface AdvancedOption {
    configId: string;
    name: string;
    /** `'boolean'` for an on/off toggle (`value` is `'true'` / `'false'`, no choices). */
    kind?: 'boolean';
    /** The conversation's pick, else the value the agent reports as current. */
    value?: string;
    choices: readonly {
        id: string;
        name: string;
        description?: string;
    }[];
}
/**
 * The agent's extra config options for one conversation, with the
 * conversation's own pick folded over the agent-reported current value.
 *
 * `choice` only applies when it belongs to the catalog's agent: a stale pick
 * from a previous agent is the previous agent's vocabulary and must not label
 * the new one's menu (same rule as `describeRoute`). Options are whatever the
 * agent publishes beyond model / thought level / mode — those have their own
 * controls, and duplicating them here would present two truths for one axis.
 */
export declare function advancedOptions(catalog: AgentCatalogResult | undefined, choice?: AcpConversationChoice): AdvancedOption[];
/**
 * The agent base chip's label and tooltip (audit findings F5 and F26).
 *
 * The label names an agent ONLY when one actually serves this conversation:
 * `route.agentId` is the binding, the live session or the plugin default, and
 * each of those is a name the request path uses (see `routeAgentId`). With none
 * of them the chip is the "选择 Agent" entry point and says so — the old
 * `agents[0]` fallback put a stranger's name on a conversation whose next
 * message would run on the deployment default provider.
 *
 * The tooltip claims only what the menu behind the chip does: switch the agent.
 * The agent's models and thought levels have chips of their own (user decision,
 * 2026-10-17), so the previous wording — "switch the agent, its model and the
 * thought level" — promised a menu that holds the roster alone. An EMPTY
 * roster is its own case: the menu cannot switch to anything, it offers the
 * way into NTR settings, so the tooltip says that instead of promising a pick.
 */
export declare function agentBaseChip(route: RouteInfo, routed: boolean, acp: AcpChatInjected['acp'], rosterEmpty?: boolean): {
    label: string;
    title: string;
};
/**
 * The composer-edge tag's label and tooltip.
 *
 * This tag is where the agent identity lives once the composer base steps
 * aside (see `agentBaseHidden`), so it names the agent unconditionally — the
 * caller only mounts it when the conversation is locked. It is a nameplate,
 * not a control: the tooltip says the lock is one-way and points at the only
 * way to use another agent (a new conversation).
 */
export declare function agentTagChip(agentTitle: string, acp: AcpChatInjected['acp']): {
    label: string;
    title: string;
};
/**
 * The agent tag riding the composer card's top edge
 * (`conversation.input.overlay`).
 *
 * The composer's agent base retires when the conversation's first ACP turn
 * starts, and that turn LOCKS the conversation to its agent (user decision,
 * 2026-10-20): a different agent would have none of the context. This tag is
 * therefore a NAMEPLATE, not a control — it keeps "who serves this
 * conversation" on screen and says why it cannot change. It deliberately has
 * no click target and no caret: the only way to use another agent is a new
 * conversation. If the turn delivered nothing, the host rolls the lock back
 * and this tag leaves with it.
 *
 * WHERE IT SITS: the overlay anchor is a zero-height absolute box at the top
 * edge of the composer card, so the tag's wrapper straddles that edge (see
 * `.ntr-acp-tag` in acp-ui.tsx) — half above the card, half inside it, like a
 * small nameplate hung on the box. This is deliberately NOT the session
 * header: the tag belongs to the input it describes, and the header is shared
 * with conversation chrome that is not about the agent.
 *
 * It gates itself: the overlay slot is registered for EVERY conversation, so
 * it must not leak `NTR · <agent>` into ordinary chats, and it may only appear
 * once the base has actually stood down (see `agentTagVisible`).
 */
export declare function AcpComposerAgentTag(props: AcpClusterProps): import("react").JSX.Element | null;
/** The composer cluster: agent, model and thought level — or nothing at all. */
export declare function AcpSessionControls(props: AcpClusterProps): import("react").JSX.Element | null;
/** Inputs one picker model is built from (kept explicit so the shape stays reviewable). */
export interface MenuContext {
    acp: AcpChatInjected['acp'];
    agents: readonly AgentView[];
    route: RouteInfo;
    /** The bound agent's own model surface (`agent/catalog`), if it has loaded. */
    catalog?: AgentCatalogResult;
    /** The conversation's persisted pick (the advanced menu overlays its extras). */
    choice?: AcpConversationChoice;
    /** A `agent/probe-models` request for this agent is in flight. */
    probing?: boolean;
    error?: string;
}
/**
 * The model picker's explicit refresh row. It is an ACTION, not a model: the
 * pick handler intercepts it and probes the agent instead of recording a pick.
 * The id cannot collide with a real row — agent ids match
 * `[a-z0-9][a-z0-9._-]{0,63}` (no underscores) and variant ids always carry
 * `agentId@value`.
 */
export declare const REFRESH_CATALOG_ITEM = "__refresh-catalog__";
/**
 * The empty roster's setup action. Like the model picker's refresh row it is an
 * ACTION inside the picker, not an agent: agent ids match
 * `[a-z0-9][a-z0-9._-]{0,63}` (no leading underscore), so no real id can
 * collide with it.
 */
export declare const OPEN_SETTINGS_ITEM = "__open-settings__";
/**
 * REMOVED on purpose (2026-10-17): the agent's own `session/set_mode` list used
 * to ride inside the agent base's menu. It has its own control
 * (`AcpComposerMode`, the native-mode select in `conversation.input.left`), so
 * duplicating it in the base made two entries for one setting and put four
 * unrelated axes behind a control whose only job is "who serves this
 * conversation". Do not reintroduce it here — the editor belongs to
 * composer-mode.tsx.
 */
/** Build the picker model for one kind. */
export declare function menuFor(kind: AcpMenuKind, context: MenuContext): {
    title: string;
    note?: string;
    sections: AcpMenuSection[];
    error?: string;
    loading?: boolean;
};
/**
 * The picker itself, living in the composer's overlay seat. It renders nothing
 * unless a chip of THIS session opened it, so a stale menu can never leak
 * across a session switch.
 */
export declare function AcpSessionMenu(props: AcpClusterProps): import("react").JSX.Element | null;
export {};
