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
import type { AcpStore, UiState } from './store.ts';
import type { AcpAgentDef, AgentSavePayload, AgentView, DetectedAgentInfo } from '../protocol.ts';
interface WithStore {
    acp: AcpStore;
}
/**
 * Equivalence test between the form payload and what is already persisted.
 * Order-insensitive on purpose: `env` is a map and `args`/`allowedCwdRoots`
 * keep their order, but a reordered allow-list is not a change worth warning
 * about; `exposedModels === undefined` means "offer no variants", which is the
 * same state as an empty list.
 */
export declare function payloadEquals(payload: AgentSavePayload, current: AcpAgentDef): boolean;
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
export declare function permissionLedgerCard(ui: Pick<UiState, 'approvalRouted' | 'permissions'>): {
    visible: boolean;
    fellBackFromConversation: boolean;
};
/** Settings configuration section for ACP agents. */
export declare function AcpSettingsSection(props: WithStore): import("react").JSX.Element;
/** Everything the connection form edits, in one object (kept in the row). */
interface AgentForm {
    agentId: string;
    title: string;
    /**
     * ONE command line — program first, arguments after, quoting to keep a path
     * with spaces in one piece (`splitCommandLine`). The old split into
     * `command` + `argsStr` invited the single most common misconfiguration
     * there is: pasting `codebuddy --acp` into the program box, which the host
     * then looked for as a file literally named `codebuddy --acp`.
     */
    commandLine: string;
    npmPackage: string;
    cwd: string;
    /** Advanced: edit every allowed root, not just the single workspace dir. */
    rootsOpen: boolean;
    roots: string[];
    envRows: Array<{
        key: string;
        value: string;
    }>;
    exposed?: string[];
    /** Auto-append models the agent newly publishes to {@link exposed}. */
    autoDiscoverModels: boolean;
    /** Raw text of the idle-release window in ms ('' = host default, '0' = never). */
    idleStr: string;
    /**
     * Raw JSON text of the agent's MCP server list (the plugin's normalized
     * shape — every entry carries a `transport`). '' = no extra MCP servers.
     *
     * Kept as TEXT so a half-typed value survives editing instead of being
     * silently reshaped; it is parsed on the way out.
     */
    mcpText: string;
}
export declare function initialForm(detected: DetectedAgentInfo, activeAgent: AgentView | undefined): AgentForm;
export declare function buildPayload(form: AgentForm, detected: DetectedAgentInfo, newCustom: boolean): AgentSavePayload;
export {};
