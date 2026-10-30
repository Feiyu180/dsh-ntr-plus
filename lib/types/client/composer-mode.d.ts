/**
 * ACP-native mode control for the conversation composer
 * (`conversation.input.left` — the seat the slot contract reserves for a small
 * native control).
 *
 * THE TWO MODE CONTROLS NEVER SHARE A SCREEN (audit finding F27): the ACP-mode
 * gate that lets this entry render also occupies the host's Access mode seat
 * with a claim that renders nothing (`createPermissionSeatClaim` in
 * model-seat.tsx) — the host's write policy (仅可查看 / 工作区内修改 / 完全权限)
 * says nothing about an external agent process, so showing it next to an ACP
 * conversation only misleads. This select is therefore NOT "complementary" to
 * the Access mode: in the only conversation where it appears, the Access mode is
 * hidden and this IS the mode switch. What it switches is the agent's own
 * `session/set_mode` vocabulary (`plan`, `acceptEdits`, …). An ordinary
 * conversation renders nothing here at all — the entry is registered
 * unconditionally and gates itself (see `isAcp` below).
 *
 * The host supplies the data by chat session id (`session/chat-list`), so the
 * control renders nothing until an ACP agent has actually run in this
 * conversation, and nothing at all for an agent that declares no modes.
 */
import type { AcpSessionHook } from './acp-ui.tsx';
import type { AcpStore } from './store.ts';
/**
 * The props this occupant actually receives: our injected face (which carries
 * the chat session id, like every other entry in this plugin) plus the
 * framework's session standard kit, of which only `useSession` is read.
 *
 * `conversation.input.left` declares no `owner` share — the composer bar calls
 * `renderSlot('conversation.input.left', {})` — so the ONLY props that exist are
 * the standard kit (session-scope `sessionId` + the bound `use<Name>` selector
 * hooks + `useProjection`/`inputActions`) and whatever our `inject` returns. The
 * session id deliberately rides the injected face rather than the standard kit:
 * the kit's top-level `sessionId` is a newer renderer addition, while the
 * positional inject argument (`binding.key`) is the contract every version in
 * play honors. Inventing a prop here is a render crash, not a silent undefined.
 */
export interface ComposerModeProps {
    /** Injected face: the chat session id this control belongs to. */
    sessionId: string;
    /** Framework-bound conversation snapshot hook (`SessionStandardProps.useSession`). */
    useSession: AcpSessionHook;
    acp: AcpStore;
}
/**
 * The mode select's tooltip (audit finding F27). It must not call the host's
 * Access mode "complementary": the ACP-mode gate that puts this select on screen
 * also hides that control (`createPermissionSeatClaim` renders nothing in the
 * permission seat), so in the conversation where this appears the Access mode is
 * gone and this select is the mode switch the user actually has.
 */
export declare function agentModeTitle(agentId: string | undefined, acp: AcpStore): string;
export declare function AcpComposerMode({ acp, sessionId, useSession }: ComposerModeProps): import("react").JSX.Element | null;
