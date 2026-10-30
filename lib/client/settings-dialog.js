import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect } from 'react';
import { AcpSettingsSection } from "./panel.js";
import { closeAcpSettingsDialog, ensureAcpStyle, useAcpSettingsDialogOpen, } from "./acp-ui.js";
/** Frame-wide NTR settings surface; renders nothing while closed. */
export function AcpSettingsDialog(props) {
    ensureAcpStyle();
    const { acp } = props;
    const open = useAcpSettingsDialogOpen();
    useEffect(() => {
        if (!open)
            return;
        const onKey = (event) => {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            event.stopPropagation();
            closeAcpSettingsDialog();
        };
        document.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('keydown', onKey, true); };
    }, [open]);
    if (!open)
        return null;
    const title = acp.label('NTR 设置', 'NTR settings');
    return (_jsxs("div", { className: "ntr-acp-dialog-layer", children: [_jsx("div", { className: "ntr-acp-dialog-mask", "aria-hidden": true, onClick: closeAcpSettingsDialog }), _jsxs("div", { className: "ntr-acp-dialog", role: "dialog", "aria-modal": "true", "aria-label": title, children: [_jsxs("div", { className: "ntr-acp-dialog-head", children: [_jsx("span", { className: "ntr-acp-dialog-title", children: title }), _jsx("button", { type: "button", className: "ntr-acp-dialog-close", title: acp.label('关闭', 'Close'), "aria-label": acp.label('关闭 NTR 设置', 'Close NTR settings'), autoFocus: true, onClick: closeAcpSettingsDialog, children: "\u2715" })] }), _jsx("div", { className: "ntr-acp-dialog-body", children: _jsx(AcpSettingsSection, { acp: acp }) })] })] }));
}
