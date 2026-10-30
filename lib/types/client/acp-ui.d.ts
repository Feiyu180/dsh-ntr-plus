/**
 * Shared browser-side kit for the ACP *conversation* surfaces: the composer
 * base (agent / model / thought level), its picker and the ACP view tab.
 *
 * Everything here is deliberately structural. The ACP plugin's client half may
 * not import the host runtime or any client package at runtime — the seats it
 * takes (`conversation.input.model`, `conversation.input.overlay`,
 * `conversation.view`) are declared by `dsh-client-ui-conversation`, and the
 * services it reads (`sessions`) are resolved by the entry in `index.tsx` and
 * handed over as plain functions. That is what keeps this bundle loadable in a
 * deployment that composes only a subset of the official client modules: an
 * absent service yields `undefined` and the surface hides itself instead of
 * breaking the plugin.
 *
 * NO MODEL DIRECTORY. This bundle used to read and write the host's per-session
 * model directory (`ctx.modelDirectories`) so an ACP agent could be expressed as
 * a route. That axis is retired: ACP is not a DSH provider, the route write
 * polluted the deployment default, and the GUI's catalog gate then refused the
 * plugin's own route with `session/model-unavailable`. The agent identity now
 * lives in this plugin's own state (`session/chat-list`), reached by its own
 * RPC — see docs/acp-convergence.md §2.2.
 *
 * THE ONE DUPLICATED CODEC: `splitAcpModelId` mirrors the host's
 * `splitAdapterModelId` (src/impl.ts). It cannot be imported from there — the
 * browser half must not pull host-plane modules into the bundle — and the
 * shared contract file is types-only by rule. Keep the two in step: they are
 * the only place that knows how `agentId` and `agentId@choice` are spelled.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { AcpStore, UiState } from './store.ts';
/** One adapter-provided reasoning effort (DSH `ModelReasoningEffort`). */
export interface AcpReasoningEffort {
    id: string;
    name: string;
    description?: string;
}
/**
 * One model inside a provider group of the agent's OWN catalog (from
 * `agent/catalog`). Deliberately NOT DSH's model catalog: an ACP agent's models
 * are the agent's business, and DSH's directory has no per-session seam to
 * filter them with anyway (see the module header).
 */
export interface AcpModelEntry {
    id: string;
    name: string;
    description?: string;
    reasoning?: {
        efforts: readonly AcpReasoningEffort[];
        defaultEffort?: string;
    };
}
/** One provider group inside an agent's own model catalog. */
export interface AcpModelGroup {
    id: string;
    name: string;
    models: readonly AcpModelEntry[];
}
/** The session's command + projection face (`SessionFace`), narrowed to what the cluster reads. */
export interface AcpSessionFace {
    command(line: string): Promise<{
        ok: true;
        value: {
            matched: boolean;
        };
    } | {
        ok: false;
        error: {
            code: string;
            message: string;
        };
    }>;
    projections: {
        faceOf(key: string): {
            getSnapshot(): unknown;
            subscribe(listener: () => void): () => void;
        };
    };
}
/** What `index.tsx` hands every ACP conversation entry. */
export interface AcpChatInjected {
    acp: AcpStore;
    /** Resolve the session's command/projection face; `undefined` before the session materializes. */
    faceFor(sessionId: string): AcpSessionFace | undefined;
}
/**
 * The slice of the client runtime's `ConversationSnapshot` our composer entries
 * read: `running` is the only field we watch, and the only re-read trigger we
 * have for the host's ACP chat-session binding (a fresh conversation gets its
 * binding when its first turn creates one, and no SSE frame announces that).
 */
export interface AcpSessionSnapshot {
    running: boolean;
}
/**
 * `SessionStandardProps.useSession`: the selector hook the renderer binds per
 * session binding (see `standardKit` in `dsh-client-ui-renderer` —
 * `standard['sessionId'] = info.sessionId` and every `hooks` source becomes a
 * `use<Name>` selector hook).
 *
 * Declared structurally, like every other host-facing type here, because the
 * client runtime that merges `SessionStandardProps` is not part of a plugin's
 * dependency closure: `PropsRuntime<K>` resolves to `object` in a plugin's own
 * build, so the type cannot name these members even though the runtime hands
 * them over. THE MEMBERS ARE `sessionId` + `useSession` — owners pass neither,
 * and there is no `session` prop on any of these seats (reading one was a
 * shipped crash: `Cannot read properties of undefined (reading 'sessionId')`).
 */
export interface AcpSessionHook {
    <S>(selector: (snapshot: AcpSessionSnapshot) => S): S;
}
/** Split `agentId` / `agentId@choice`; mirrors the host's `splitAdapterModelId`. */
export declare function splitAcpModelId(model: string): {
    agentId: string;
    choice?: string;
};
/**
 * Build `agentId` / `agentId@choice`; mirrors the host's `buildAdapterModelId`.
 *
 * The inverse of {@link splitAcpModelId}, and a hand copy for the same reason:
 * the browser half cannot import the host plane. Needed where the browser has a
 * bare choice value (the agent's own current model, as `agent/catalog` reports
 * it) and must compare it against adapter model ids.
 */
export declare function buildAcpModelId(agentId: string, choice?: string): string;
/**
 * Whether a form value looks like an absolute path on some platform the plugin
 * runs on: POSIX (`/…`), a Windows drive path (`C:\…`, `C:/…`), or a UNC path
 * (`\\host\share…`, `//host/share…`). Mirrors the host's `isAbsolutePath`
 * (src/impl.ts) — the browser must pre-reject exactly what `validateAgentDef`
 * would reject, or a save the form enables dies on the host
 * (tests/acp-view.spec.ts asserts equivalence on a shared sample set).
 *
 * The extended-length `\\?\…` / `//?/…` family is rejected here too: the host's
 * workspace guard cannot interpret it, so a config written that way could never
 * resolve a cwd.
 */
export declare function isAbsolutePathLike(p: string): boolean;
/**
 * Hand copies of the host's `tokenizeCommandLine` / `splitCommandLine` /
 * `quoteCommandToken` (src/impl.ts). The 命令 field is ONE command line — the
 * whole thing a user would paste into a terminal — and the panel has to parse
 * it exactly the way `validateAgentDef` will, or the "程序 / 参数" preview under
 * the field would lie about what the host is about to run. Same discipline as
 * `splitAcpModelId`: browser half cannot import the host plane, so
 * tests/acp-view.spec.ts asserts equivalence on a shared sample set.
 */
export declare function tokenizeCommandLine(raw: string): string[];
/** First token = program, rest = arguments. Mirrors the host's `splitCommandLine`. */
export declare function splitCommandLine(raw: string): {
    command: string;
    args: string[];
};
/** Quote one token for a command line — only when it needs it. */
export declare function quoteCommandToken(token: string): string;
/** Join a parsed command back into the single editable field (round-trips through `splitCommandLine`). */
export declare function formatCommandLine(command: string, args?: readonly string[]): string;
/** Subscribe to the ACP store (the panel and every chat surface share this). */
export declare function useUi(acp: AcpStore): UiState;
/**
 * The ACP agent preset's id. THREE places must agree on it (no type system
 * spans them): the declaration's `config.id` in `presets/acp/acp.patch.yml`
 * (this bundle's own patch, carried by package.json `dsh.bundle.patch` — no
 * install step), the host half's `ACP_PRESET_ID` (`src/bridge.ts`), and this
 * constant (the browser cannot read the host plane). `acp` is the value the
 * session list reports for an ACP-mode session and the same string the host's
 * own `sessionAgentPreset` resolver reads back from the session log.
 */
export declare const ACP_PRESET_ID = "acp";
/**
 * The bits of the client session list this plugin reads.
 *
 * Structural on purpose: the client runtime package is not a dependency of
 * this bundle, so the list is resolved as a plain observable at call time and
 * an unexpected shape simply reads as "no ACP session" — which leaves every ACP
 * surface hidden rather than broken.
 *
 * TWO SHAPES ship in the wild. DSH 0.1.7-rc.2's session controller
 * (`dsh-api-session-controller`) builds `{ ids, byId, phase,
 * projectionsBySession }` with NO `current` field at all — the staged session
 * is the row whose `retainedBy.mainView` count is positive (the same rule
 * `dsh-client-ui-session` uses to pick its main view), and the session's
 * preset rides `projectionValues.agentPreset` (folded from the
 * `agent-preset/selected` log event; the value is the preset's `id`).
 * Older runtimes carried a literal `current` plus a top-level `agentPreset`
 * on the row and a `currentAddress` marker for addressed subagent routes.
 */
export interface AcpSessionsSnapshot {
    /** Old runtimes only: the currently selected session id. */
    current?: string;
    /** Old runtimes only: set when the current route is an addressed subagent session. */
    currentAddress?: unknown;
    /** List rows by session id (both runtime shapes). */
    byId?: Record<string, AcpSessionsRow | undefined>;
    /**
     * rc.2 shape: row ids in display order. A TIE-BREAK hint, never the
     * candidate set: `byId` is a superset of `ids` (the session controller adds
     * catalog-only and retained-scope rows to `byId` without giving them an
     * `ids` entry), so walking `ids` alone can miss the row the main view
     * actually retains. See {@link stagedSessionOf}.
     */
    ids?: readonly string[];
    phase?: string;
}
/** One session-list row, narrowed to what the gate reads (both shapes). */
export interface AcpSessionsRow {
    id?: string;
    /** Old runtimes: the preset at the top level. */
    agentPreset?: string;
    /** rc.2: session projections, `agentPreset` among them. */
    projectionValues?: {
        agentPreset?: string;
    } | undefined;
    /** rc.2: per-surface retain counts; `mainView > 0` marks the staged session. */
    retainedBy?: {
        mainView?: number;
    } | undefined;
    /** rc.2: `"subagent"` marks addressed subagent rows. */
    origin?: string;
}
/**
 * The preset the row records, under either runtime spelling. `undefined` means
 * the row is silent (projections not loaded yet, or a runtime without presets)
 * — never "definitely not ACP".
 */
export declare function rowAgentPreset(row: AcpSessionsRow | undefined): string | undefined;
/** The session the composer is staged on, derived per runtime shape. */
export interface AcpStagedSession {
    sessionId: string;
    row?: AcpSessionsRow;
    /** Addressed subagent route: it is not a conversation this plugin may drive. */
    subagent: boolean;
}
/**
 * Which session the composer is currently staged on.
 *
 * Old runtimes answer from `snapshot.current` (with `currentAddress` as the
 * subagent marker). rc.2 has no `current`: the staged session is the row the
 * main view retains (`retainedBy.mainView > 0`) — the exact rule
 * `dsh-client-ui-session` applies, walked in the list's own `ids` order — and a
 * row with `origin === "subagent"` is an addressed subagent route. `undefined`
 * when nothing is staged yet (the list has not loaded, or no row holds the main
 * view): callers must stand down rather than guess.
 */
export declare function stagedSessionOf(snapshot: AcpSessionsSnapshot | undefined): AcpStagedSession | undefined;
/** Whether the staged session runs the ACP agent preset. */
export declare function stagedIsAcpMode(snapshot: AcpSessionsSnapshot | undefined, acpMode?: (sessionId: string) => boolean | undefined): boolean;
/**
 * The ACP-mode verdict a committed `agent-preset/selected` frame carries. The
 * frame is `[sessionId, agentPreset]` and the runtime broadcasts it the moment
 * a switch commits — before the appended session-log row is visible to a fresh
 * `session/chat-list` cold read, so re-reading the log from that frame folds the
 * PREVIOUS preset and the surface would lag one switch behind until a reload.
 * The frame's own preset is therefore the live path's fact source; the host read
 * only seeds a session this tab has never seen a frame for.
 */
export declare function acpModeFromPresetEvent(agentPreset: unknown): boolean;
/** The session list store as this bundle reads it (structural, see {@link AcpSessionsSnapshot}). */
export interface SessionListSource {
    getSnapshot(): AcpSessionsSnapshot | undefined;
    subscribe(listener: () => void): () => void;
}
/** Which picker the composer overlay is showing. */
export type AcpMenuKind = 'agent' | 'model' | 'thought' | 'advanced';
interface MenuState {
    sessionId: string;
    kind: AcpMenuKind;
    /** The control that opened the picker; the popup docks to it. */
    trigger?: HTMLElement;
    /** Last pick failure, rendered inside the open picker (its own retry surface). */
    error?: string;
}
/** Toggle-style open: pressing the same chip twice closes its menu. */
export declare function openAcpMenu(sessionId: string, kind: AcpMenuKind, trigger?: HTMLElement): void;
/** Close whatever picker is open (Escape, pick, outside pointer). */
export declare function closeAcpMenu(): void;
/**
 * Report a pick failure inside the open picker. The menu stays open on
 * purpose: a failed switch must not leave the user staring at a closed chip
 * with no idea whether it took effect.
 */
export declare function setAcpMenuError(error?: string): void;
/** Subscribe to the open-picker state (both the chips and the overlay read it). */
export declare function useAcpMenu(): MenuState | null;
/** Open the NTR settings dialog (the empty agent roster's way forward). */
export declare function openAcpSettingsDialog(): void;
/** Close the NTR settings dialog (close button, mask click, Escape). */
export declare function closeAcpSettingsDialog(): void;
/** Current dialog state, for tests and non-React readers. */
export declare function acpSettingsDialogIsOpen(): boolean;
/** Subscribe to the dialog state (the root overlay entry reads it). */
export declare function useAcpSettingsDialogOpen(): boolean;
/** One selectable row of a picker. */
export interface AcpMenuItem {
    id: string;
    label: string;
    detail?: string;
    /** Current value (rendered with the accent + a check). */
    active?: boolean;
    disabled?: boolean;
    /** Leading status dot color (agent process state). */
    dot?: string;
    /**
     * Render as a checkbox row (`menuitemcheckbox`) rather than a radio row.
     * The advanced base uses it for the agent's boolean config options: one row
     * whose check IS the current value, whose `id` is the value a click sets.
     */
    checkbox?: boolean;
}
/** One titled block of rows. */
export interface AcpMenuSection {
    id: string;
    title?: string;
    note?: string;
    items: readonly AcpMenuItem[];
}
/** Props of the picker shell rendered into `conversation.input.overlay`. */
export interface AcpMenuProps {
    /** Menu model; `undefined` renders nothing (closed). */
    model?: {
        title: string;
        note?: string;
        sections: readonly AcpMenuSection[];
        error?: string;
        loading?: boolean;
    };
    /** The control that opened the menu; the popup docks above it (see `placeMenu`). */
    anchor?: HTMLElement | null;
    onPick(itemId: string, sectionId: string): void;
    onClose(): void;
}
/**
 * Pure popup placement, viewport coordinates: the menu docks with its right
 * edge under the trigger's, `gap`px above it — and only then clamps to the
 * viewport (flip below when the top has no room, slide left at the right edge).
 * Separated from the DOM measurement so the geometry stays testable.
 */
export declare function placeMenu(trigger: {
    left: number;
    right: number;
    top: number;
    bottom: number;
}, menu: {
    width: number;
    height: number;
}, viewport: {
    width: number;
    height: number;
}, gap?: number): {
    x: number;
    y: number;
};
/**
 * The picker shell. It rides the composer's overlay anchor (the card's top
 * edge) — the seat the platform reserves for menus, so the popup is never
 * clipped by the card's own scrollport — and then docks itself to the control
 * that opened it (`anchor`): the seat or a chip is a dropdown trigger, and a
 * menu that materializes elsewhere on the card reads as "nothing happened".
 */
export declare function AcpMenu({ model, anchor, onPick, onClose }: AcpMenuProps): import("react").JSX.Element | null;
/**
 * One composer chip. With `onClick` it is the trigger of a picker; without it
 * it is a static nameplate (the locked agent on the composer edge) — same
 * shape and no button semantics, so it does not read as a control that does
 * nothing. Neither variant draws a caret: the chips are a compact status row,
 * and the disclosure arrow added visual noise without carrying information.
 *
 * `className` exists for the lock hand-off: the base needs the shatter
 * keyframes (`ntr-acp-shatter`) while it is still mounted, and that class must
 * ride the chip itself to keep the cluster's `:last-child` layout rule intact.
 */
export declare function AcpChip(props: {
    label: string;
    title?: string;
    active?: boolean;
    onClick?: (trigger: HTMLElement) => void;
    children?: ReactNode;
    style?: CSSProperties;
    className?: string;
}): import("react").JSX.Element;
export declare function AcpShatterParts(props: {
    mode: 'out' | 'in';
}): import("react").JSX.Element;
/** Mount the shared stylesheet once (same pattern as the settings panel's). */
export declare function ensureAcpStyle(): void;
export {};
