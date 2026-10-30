/**
 * The NTR settings dialog, opened from the agent base's empty-roster menu.
 *
 * WHY A DIALOG OF OUR OWN: the host settings shell owns its open state and
 * exposes no programmatic way in. The sidebar seat that receives `openSettings`
 * (`settings.launcher`) is a single-occupant slot already held by the account
 * menu, and `openSection` is only handed to `settings.onboarding` registrants —
 * so a conversation surface cannot drive the shell's modal. This dialog mounts
 * the SAME `AcpSettingsSection` the shell mounts, on the frame's overlay layer
 * (`shell.overlay`): one settings surface, two entrances, no duplicated
 * configuration logic.
 *
 * The trigger (composer model seat) and this dialog (root overlay) live in
 * unrelated slot trees, so the open state is the module-level store in
 * `acp-ui.tsx` (`openAcpSettingsDialog`).
 */
import type { AcpStore } from './store.ts';
/** The root overlay entry's inject face. */
export interface AcpSettingsDialogProps {
    acp: AcpStore;
}
/** Frame-wide NTR settings surface; renders nothing while closed. */
export declare function AcpSettingsDialog(props: AcpSettingsDialogProps): import("react").JSX.Element | null;
