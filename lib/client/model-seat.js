/**
 * The ACP conversation's claim on two cells of the host's composer bar.
 *
 * Both cells are `single`, session-scoped slots the composer bar renders
 * unconditionally, and both are held by claims this module defines — one that
 * REPLACES what is there (`conversation.input.model`, see
 * {@link createModelSeatClaim}) and one that EMPTIES it
 * (`conversation.input.permission`, see {@link createPermissionSeatClaim}).
 *
 * WHAT IT IS: `conversation.input.model` is a `single` slot the host's composer
 * bar renders unconditionally, in the TRAILING group (`margin-left: auto`),
 * immediately before the activity/stop/submit chrome — which is exactly where
 * the host's own model selector sits. Its shipped occupant is
 * `client-ui-model-selection`'s `ModelSelect`, which reads the DSH model
 * directory and submits through `session.selectModel`, which in turn writes
 * `agentDefaultModel.saveSelection` — the process-wide default. On an ACP
 * conversation none of that describes anything real: the models belong to the
 * external agent (`agent/catalog`), so the seat would list providers this
 * conversation cannot use, and clicking one would poison the default for every
 * other conversation. Third-party seat plugins land in this same cell.
 *
 * SO THE CLAIM PUTS THE ACP BASE THERE. The ACP base (`AcpSessionControls`) is
 * the surface that already describes what this conversation runs on, and the
 * seat it has to displace is the one that would otherwise misdescribe it — one
 * cell, one occupant, and the position the host's own base occupied. The base
 * is installed by the ACP-mode gate in `index.tsx`, which holds the claim only
 * while the staged conversation runs the ACP preset and releases it the moment
 * it does not, so an ordinary conversation gets the native selector back and
 * sees no ACP chrome at all. That gate is the whole isolation story: the entry
 * does not exist outside ACP mode, rather than existing and rendering nothing.
 *
 * WHY A CLAIM AND NOT A `priority: -1` REGISTRATION: the declared rank is NOT
 * what decides this cell on the desktop runtime. The client runner (the facade
 * every bundle — including this one — is loaded through) REWRITES the priority
 * of every non-chain registration with its own page-global counter, which only
 * decreases:
 *
 *   // @deepseek-ai/dsh-cordis-client-runner, `guardedSlots`
 *   const spec = slots.spec(slot);
 *   let priority = options.priority;
 *   if (spec === undefined || spec.kind !== "chain") {
 *     priority = env.allocatePriority();   // `allocatePriority: () => --this.nextPriority`
 *     options.priority = priority;
 *   }
 *
 * So in a `single` cell (lowest live rank renders) the winner is simply
 * whoever registered LAST — a rival seat plugin that loads a moment after us
 * takes the cell no matter what either side declares. `dsh-thinking-effort`
 * provably does exactly that: it registers a model + reasoning slider into this
 * very cell, and it is a later registration, so it would stay on screen in ACP
 * conversations regardless of any rank we declare (and its own declared `-10`
 * is discarded just the same).
 *
 * The fix is therefore to treat the cell as a claim we VERIFY and, when a rival
 * took it, retake by registering again (a new registration is the lowest rank
 * on the page, which is what wins). That is the whole mechanism: read the
 * renderer's own winner view (`entriesOfSlot`, the same call the renderer's
 * outlet makes), compare it with our own component identities, and re-register
 * when it is not ours — bounded, and honest about giving up. Nothing else from
 * the retired seat machinery comes back: no abdicate recovery, no session-long
 * `seatBroken`, no rank arithmetic as an end in itself.
 *
 * WHAT THE CLAIM MUST CARRY: the occupant's own inject face. That is not an
 * optional extra — this cell is SESSION-scoped, so the renderer gives an entry
 * only the framework's standard kit (`sessionId`, `useSession`, …) unless the
 * entry declares an `inject`, and the ACP base reads `acp` and `faceFor`, both
 * of which arrive ONLY through it. Registering the occupant without one makes
 * it render with `acp === undefined`; the slot's error boundary catches the
 * resulting crash and reports it as an ABDICATION, which retires our entry from
 * the cell for the rest of that registration's life and hands the cell back to
 * the shipped `ModelSelect` — the native seat returns, the ACP base is gone,
 * and the gate never hears about it because `sync()` already verified the cell
 * and reported "held by the ACP base". So `inject` is a required option (a
 * compile error at the one call site) instead of an optional one (a silent
 * abdication at runtime). See {@link ModelSeatClaimOptions.inject}.
 *
 * The gate reads the session's own preset (`stagedIsAcpMode` in `acp-ui.tsx`)
 * rather than anything the plugin recorded, so it can never drift from the
 * roster.
 */
/** Exact key of the composer's model seat (a `single`, session-scoped slot). */
export const MODEL_SEAT_KEY = 'conversation.input.model';
/**
 * Exact key of the composer's permission seat (a `single`, session-scoped
 * slot): the cell the host's Access mode control occupies. It selects the
 * file-write policy the HOST applies to its own tools, read from the
 * `permissions` projection `dsh-permission-presets` owns. An ACP conversation's
 * writes belong to the external agent's process, which never consults that
 * policy, so there is nothing to put in this cell in ACP mode — which is why
 * {@link createPermissionSeatClaim} installs a `null`-rendering occupant rather
 * than a replacement control, and why its lifetime must be exactly the ACP-mode
 * verdict's lifetime (see the claim's own note in `index.tsx`).
 */
export const PERMISSION_SEAT_KEY = 'conversation.input.permission';
/**
 * Declared rank of the first occupant we install.
 *
 * Honoured only by a registry that keeps what we declare (a statically composed
 * client, or a future runner that stops rewriting non-chain priorities): it
 * displaces a shipped occupant registering at the default rank 0. Under the
 * desktop runner the rank is overwritten with its own counter — see the module
 * header — which is why the claim verifies ownership instead of trusting this.
 */
export const MODEL_SEAT_PRIORITY = -1;
/**
 * Rank of the first occupant the permission claim installs. Same meaning (and
 * same caveat) as {@link MODEL_SEAT_PRIORITY}; see {@link createSeatClaim} for
 * why a declared rank is never trusted as proof of ownership.
 */
export const PERMISSION_SEAT_PRIORITY = -1;
/**
 * How many times ONE claim may retake the cell before it stops and says so.
 *
 * Each retake is triggered by evidence (the cell's winner is not ours), so a
 * normal page needs at most one; the cap only bounds a rival that registers in
 * a loop, and reaching it is reported rather than hidden.
 */
export const MAX_SEAT_CLAIMS = 4;
/**
 * Core generic slot claim engine.
 *
 * Installs and holds an occupant into a single-occupant slot, verifying via
 * `entriesOfSlot` and performing bounded retakes if displaced by later registrations.
 */
export function createSeatClaim(options) {
    const { slots, slotKey, basePriority, occupant, inject } = options;
    const label = options.label ?? slotKey;
    const onDiag = options.onDiag;
    const maxClaims = options.maxClaims ?? MAX_SEAT_CLAIMS;
    const ours = new Set();
    const declared = new Set();
    const installed = [];
    let retakes = 0;
    let holding = false;
    const say = (line) => onDiag?.(line);
    const describe = (entry) => {
        if (entry === undefined)
            return 'no occupant';
        const who = entry.options?.registrant;
        const rank = entry.options?.priority;
        if (who === undefined && rank === undefined)
            return 'another entry';
        return `${who ?? 'an unnamed entry'} (rank ${rank ?? 0})`;
    };
    const cell = () => {
        let isDeclared = true;
        if (typeof slots.spec === 'function') {
            try {
                isDeclared = slots.spec(slotKey) !== undefined;
            }
            catch {
                isDeclared = false;
            }
        }
        if (typeof slots.entriesOfSlot !== 'function')
            return { declared: isDeclared, verified: false };
        try {
            const heads = slots.entriesOfSlot(slotKey) ?? [];
            return { declared: isDeclared, verified: true, ...heads[0] === undefined ? {} : { entry: heads[0] } };
        }
        catch {
            return { declared: isDeclared, verified: false };
        }
    };
    const install = (head) => {
        const base = installed.length === 0 ? basePriority : basePriority - 1 - retakes;
        let rank = Math.min((head?.options?.priority ?? 0) - 1, base);
        while (declared.has(rank))
            rank -= 1;
        const component = (props) => {
            const target = occupant();
            return target(props);
        };
        ours.add(component);
        declared.add(rank);
        try {
            installed.push(slots.inject(slotKey, () => slots.register({
                name: slotKey,
                priority: rank,
                ...(inject ? { inject } : {}),
            }, component)));
            return true;
        }
        catch (error) {
            ours.delete(component);
            declared.delete(rank);
            say(`${label}: registration failed (${error instanceof Error ? error.message : String(error)})`);
            return false;
        }
    };
    return {
        get holding() { return holding; },
        sync() {
            if (installed.length === 0 && !install(undefined))
                return;
            const view = cell();
            if (!view.declared) {
                holding = false;
                say(`${slotKey}: waiting for the host to declare the seat`);
                return;
            }
            if (!view.verified) {
                holding = true;
                say(`${slotKey}: occupied (ownership is not verifiable on this runtime)`);
                return;
            }
            if (ours.has(view.entry?.component)) {
                holding = true;
                say(`${slotKey}: held by the ACP base${retakes === 0 ? '' : ` (retook it ${retakes}×)`}`);
                return;
            }
            const incumbent = view;
            if (retakes >= maxClaims) {
                holding = false;
                say(`${slotKey}: taken by ${describe(incumbent.entry)} — gave up after ${maxClaims} retakes`);
                return;
            }
            retakes += 1;
            if (!install(incumbent.entry))
                return;
            const settled = cell();
            if (settled.verified && ours.has(settled.entry?.component)) {
                holding = true;
                say(`${slotKey}: retook it from ${describe(incumbent.entry)} (retake ${retakes})`);
                return;
            }
            holding = false;
            say(`${slotKey}: still held by ${describe(settled.entry ?? incumbent.entry)} after retake ${retakes}`);
        },
        release() {
            while (installed.length > 0) {
                try {
                    installed.pop()?.();
                }
                catch { }
            }
            ours.clear();
            declared.clear();
            retakes = 0;
            holding = false;
        },
    };
}
/**
 * Take and hold the composer's model seat for one ACP-mode spell.
 *
 * Lifecycle: the gate creates a claim when the staged conversation enters ACP
 * mode, calls `sync()` on every evaluation (store mutation, session-list
 * notification, preset frame, and any change to the cell itself), and calls
 * `release()` when the conversation leaves ACP mode or the gate tears down.
 */
export function createModelSeatClaim(options) {
    return createSeatClaim({
        slots: options.slots,
        slotKey: MODEL_SEAT_KEY,
        basePriority: MODEL_SEAT_PRIORITY,
        occupant: options.occupant,
        inject: options.inject,
        label: 'model seat',
        onDiag: options.onDiag,
        maxClaims: options.maxClaims,
    });
}
/** Null placeholder component for blanking a slot. */
const BlankSlotOccupant = () => null;
/** Empty inject face provider for slots that require an inject definition. */
const emptyInject = () => ({});
/**
 * Take and hold the composer's permission seat for one ACP-mode spell.
 *
 * Same lifecycle as {@link createModelSeatClaim} — created when the staged
 * conversation enters ACP mode, `sync()`ed on every gate evaluation,
 * `release()`d the instant it leaves — with one difference worth saying out
 * loud: this claim has NO occupant to show for itself. Its entire product is
 * the ABSENCE of the host's Access mode control, and absence is exactly what
 * cannot be inspected after the fact. A permission claim that outlives its
 * reason does not render an obvious wrong thing on an ACP conversation; it
 * silently removes a control from ordinary ones, and every path through the
 * gate that cannot confirm the verdict releases it.
 */
export function createPermissionSeatClaim(options) {
    return createSeatClaim({
        slots: options.slots,
        slotKey: PERMISSION_SEAT_KEY,
        basePriority: PERMISSION_SEAT_PRIORITY,
        occupant: options.occupant ?? (() => BlankSlotOccupant),
        inject: options.inject ?? emptyInject,
        label: 'permission seat',
        onDiag: options.onDiag,
        maxClaims: options.maxClaims,
    });
}
