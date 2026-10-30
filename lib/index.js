/**
 * dsh-ntr host entry: mounts the `/acp` Connection RPC channel and the
 * `/api/acp/stream` SSE route, owns every spawned ACP child, and tears all of
 * them down with the plugin fiber. Named exports only (a default export would
 * hide the loader metadata — see harness postmortem 0001).
 */
import { ACP_PRESET_ID, AcpLlmAdapter, BridgeManager, routeBindingRegistry } from "./bridge.js";
import { EventHub, dispatchRpc, permissionReplayFrames, sessionAgentPreset, sessionAgentPresetFromLog, validateConfig } from "./impl.js";
export const name = 'dsh-ntr';
// `approval` / `agents` are deliberately NOT listed here: they are optional
// collaborators probed structurally below. A hard dependency would make the
// whole plugin fail to load on a deployment without them (see the LLM service
// probe, which follows the same shape).
export const inject = ['webServer', 'connection'];
/** How many stored events the cold-read folds before giving up on scanning. */
const COLD_READ_MAX_EVENTS = 4096;
/** Browser-safe encoder of `AcpEvent` frames; one SSE `data:` line per event. */
function formatSse(event) {
    return `data: ${JSON.stringify(event)}\n\n`;
}
export function apply(ctx, config) {
    const resolved = validateConfig(config);
    const hub = new EventHub();
    const manager = new BridgeManager(resolved.agents, hub, resolved.transcriptMaxEntries ?? 600, undefined, undefined, resolved.probeModelsOnBoot ?? true, {
        startupTimeoutMs: resolved.startupTimeoutMs,
        permissionTimeoutMs: resolved.permissionTimeoutMs,
        nativeApprovalTimeoutMs: resolved.nativeApprovalTimeoutMs,
        permissionFallbackTimeoutMs: resolved.permissionFallbackTimeoutMs,
        cancelFallbackMs: resolved.cancelFallbackMs,
        staleCancelRetryDelayMs: resolved.staleCancelRetryDelayMs,
        staleCancelMaxRetries: resolved.staleCancelMaxRetries,
    });
    const adapter = new AcpLlmAdapter(manager);
    // The RAW patch-file deadlines, before validation filled the defaults in.
    // `validateConfig` returns a number for every knob, so the validated object
    // cannot tell "the deployment asked for 10 minutes" from "the deployment said
    // nothing and 5 minutes is the built-in default" — and the settings card has
    // to say which of the two the user is looking at (and what the reset button
    // returns to). Only the keys the file actually names are declared.
    const rawConfig = (config ?? {});
    const configuredDeadlines = {};
    for (const key of ['nativeApprovalTimeoutMs', 'permissionFallbackTimeoutMs']) {
        const value = rawConfig[key];
        if (typeof value === 'number' && Number.isFinite(value))
            configuredDeadlines[key] = value;
    }
    manager.setConfiguredApprovalDeadlines(configuredDeadlines);
    // Boot hook kept only so this entry point's shape does not change:
    // `bootstrapCatalogs` is intentionally empty — boot never spawns an agent,
    // in any environment and for any `probeModelsOnBoot` value. Catalogs fill
    // from a gesture instead (a real session, `agent/probe-models`, or an
    // on-disk cache — see `BridgeManager.bootstrapCatalogs` / `agentCatalog`).
    manager.bootstrapCatalogs();
    /**
     * ACP 模式 preset status.
     *
     * The preset is a DECLARATION this package ships — `presets/acp/acp.patch.yml`
     * is one of our own `dsh.bundle.patch` files, so the harness composes the
     * `preset-acp` roster row with no install step. Nothing here copies files:
     * the legacy `~/.dsh/.agent-presets/<id>` directory is no longer read by the
     * harness at all, which is exactly why a copy there proves nothing.
     *
     * What the panel can still need is the roster's own verdict — the declaration
     * stays visible with a diagnostic when its activation fails — so the registry
     * service is probed (never injected: a missing service must not fail loading)
     * and read lazily. `list()` is never called during this activation: the
     * registry settles the Host tree while auditing a definition, so reading the
     * roster inside our own row would wait on ourselves.
     */
    const wirePresetRoster = () => {
        const roster = (typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined);
        const list = roster?.list;
        if (roster === undefined || typeof list !== 'function')
            return;
        manager.setPresetRosterReader(() => list.call(roster));
    };
    wirePresetRoster();
    if (typeof ctx.inject === 'function') {
        // Late arrival: the registry may still be loading when this plugin applies.
        ctx.inject(['agentPresets'], () => { wirePresetRoster(); });
    }
    /**
     * Native approval routing: answer ACP `session/request_permission` through
     * the host approval chain so the question takes over the chat composer
     * (`ApprovalPanel`) instead of the settings panel.
     *
     * `approval.request` needs the live agent object (its session carries the
     * audit pair, and the ask must land inside an open turn) and the chat
     * session id our adapter already knows. Any missing piece — service absent,
     * unknown session, a rejecting service — degrades to `'unavailable'`, which
     * sends the ask back to the ledger/panel path rather than losing it.
     */
    const wireApproval = () => {
        const approval = (typeof ctx.get === 'function' ? ctx.get('approval') : ctx.approval);
        const agents = (typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents);
        if (approval === undefined || agents === undefined)
            return;
        manager.setApprovalRequester(async ({ dshSessionId, toolName, signal }) => {
            if (dshSessionId === undefined)
                return 'unavailable';
            const agent = agents.get(dshSessionId);
            if (agent === undefined)
                return 'unavailable';
            // A session the person already handed EVERYTHING to (sandbox mode
            // `danger-full-access`) must not be asked again about a tool DSH
            // cannot confine in the first place — the agent runs it inside its
            // own process. Asking is double gating, and under the `never`
            // approval policy that preset pairs with, the ask is rejected in the
            // same millisecond: the agent receives an empty tool outcome and
            // reports a broken tool channel (observed with codebuddy: every
            // PowerShell/Read/Glob call "came back empty"). Grant it here
            // instead — the grant is exactly what the session's own preset
            // already says.
            if (await isFullAccessSession(dshSessionId))
                return 'allowed-once';
            try {
                return await approval.request({ agent, toolName, ...(signal === undefined ? {} : { signal }) });
            }
            catch {
                // Never propagate: a failed ask must fall back, not break the turn.
                return 'unavailable';
            }
        });
    };
    /**
     * Whether the host already granted this session every permission
     * (`sandbox: danger-full-access`) in a NATIVE conversation.
     *
     * NTR 模式 is excluded: that preset's session is the plugin's own UI, the
     * person answers on its permission card, and the host's sandbox preset says
     * nothing about an agent the plugin presents itself. Read lazily — the
     * policy service may mount after this plugin — and fail `false`: an
     * unreadable mode must keep the normal ask path, never widen it.
     */
    const isFullAccessSession = async (dshSessionId) => {
        try {
            // The awaitable form: a cold session's preset lives only in its
            // stored log, and the synchronous form answers `false` while that
            // read is in flight — which would bypass NTR 模式's own card.
            if (await manager.chatSessionAcpModeAnswer(dshSessionId))
                return false;
            const sandboxPolicy = (typeof ctx.get === 'function' ? ctx.get('sandboxPolicy') : undefined);
            const sessions = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined);
            if (sandboxPolicy === undefined || sessions === undefined)
                return false;
            const session = sessions.get(dshSessionId);
            if (session === undefined)
                return false;
            return sandboxPolicy.resolve({ session })?.mode === 'danger-full-access';
        }
        catch {
            return false;
        }
    };
    /** How long a card waits for the agent to report a call's output. */
    const CARD_OUTPUT_WAIT_MS = 5 * 60 * 1000;
    /** Text shown when the agent never reported an output for the call. */
    const CARD_FALLBACK_TEXT = '这次工具调用在 ACP agent 自己的进程里执行，输出见 ACP 转录视图。';
    /**
     * One virtual tool definition per ACP tool name, answered from the shared
     * output registry. Mirrors `virtualToolDefinition` in
     * `presets/acp/acp-guard.mjs`: the preset row covers ACP-mode sessions, this
     * one covers a NATIVE conversation that runs an `acp` model.
     */
    const cardToolDefinition = (name) => ({
        name,
        description: 'dsh-ntr: an ACP tool the agent already executed in its own process; this call only displays its output.',
        parameters: { type: 'object', properties: {} },
        output: {
            schema: { type: 'object', properties: {} },
            render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
        },
        execute: async (_args, rawExec) => {
            const callId = rawExec?.callId;
            const registry = routeBindingRegistry();
            if (typeof callId === 'string' && callId !== '') {
                const landed = registry.toolResults.get(callId);
                if (landed !== undefined)
                    return { text: landed };
                if (typeof registry.waitForToolOutput === 'function') {
                    try {
                        const waited = await registry.waitForToolOutput(callId, CARD_OUTPUT_WAIT_MS);
                        if (typeof waited === 'string' && waited !== '')
                            return { text: waited };
                    }
                    catch {
                        // A waiter failure degrades to the pointer, never to an error.
                    }
                }
            }
            return { text: CARD_FALLBACK_TEXT };
        },
    });
    /**
     * Display cards for ACP tool calls in NATIVE conversations.
     *
     * DSH's host loop executes every `tool-call` block an assistant message
     * carries, and that execution record IS the card. An ACP-preset session gets
     * a virtual tool per name from the preset's guard; a native conversation that
     * runs an `acp` model has no such row, so this seam registers the same
     * definition on the calling agent's scope (`exec.agent.ctx.tools`) — scoped
     * on purpose: a global registration would advertise `PowerShell` / `Read` to
     * every session in the process.
     *
     * A name that already resolves to a REAL tool is left alone: the agent ran
     * that tool inside its own process, and re-running it here would execute the
     * command twice. The card then falls back to prose (see `openToolCallBlock`).
     *
     * The flag flips on the first successful registration, so the very first card
     * of a session still streams as prose and every card after it renders.
     */
    const wireToolCards = () => {
        const tools = (typeof ctx.get === 'function' ? ctx.get('tools') : undefined);
        if (tools === undefined || typeof tools.get !== 'function')
            return;
        if (typeof ctx.on !== 'function' || typeof ctx.effect !== 'function')
            return;
        const virtualDefs = new WeakSet();
        const onWaterfall = ctx.on;
        ctx.effect(() => onWaterfall('tools/execute', async (exec, next) => {
            try {
                const row = (exec !== null && typeof exec === 'object' ? exec : undefined);
                const name = row?.name;
                if (row === undefined || typeof name !== 'string' || name === '' || name === 'run_code')
                    return await next();
                const existing = tools.get(name, row.agent);
                if (existing !== undefined && !virtualDefs.has(existing))
                    return await next();
                if (existing !== undefined)
                    return await next();
                const scoped = row.agent?.ctx?.tools;
                if (scoped === undefined || typeof scoped.register !== 'function')
                    return await next();
                const definition = cardToolDefinition(name);
                scoped.register(definition);
                virtualDefs.add(definition);
                // This call proved the seam works; the next cards may render.
                manager.toolCardsEnabled = true;
                return await next();
            }
            catch {
                // A card seam must never break the tool pipeline.
                return await next();
            }
        }));
    };
    /**
     * Workspace routing: the sidebar's selected workspace IS the chat session's
     * workspace, so the agent's session and its process both run there (see
     * `chatWorkspaceRoot` and `getOrCreateDshSession`).
     *
     * This is the ONLY host state the turn path still needs. It used to also
     * resolve the session's access mode so the host could arbitrate the agent's
     * permission asks — that mapping is retired for every mode but one: a
     * `danger-full-access` session grants the ask outright (see
     * `isFullAccessSession`), because re-asking under the `never` policy that
     * preset pairs with rejects it in the same millisecond. Every other mode
     * still maps the ask to the user unchanged: an ACP agent is fully
     * autonomous, and DSH's sandbox has no reach into the agent's own process
     * anyway. See docs/acp-convergence.md §2.3.
     */
    const wireWorkspace = () => {
        const sandboxPolicy = (typeof ctx.get === 'function' ? ctx.get('sandboxPolicy') : undefined);
        const sessions = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined);
        if (sandboxPolicy === undefined || sessions === undefined)
            return;
        manager.setSessionWorkspaceResolver(dshSessionId => {
            try {
                const session = sessions.get(dshSessionId);
                if (session === undefined)
                    return undefined;
                const root = sandboxPolicy.resolve({ session })?.workspaceRoot;
                return typeof root === 'string' && root !== '' ? { workspaceRoot: root } : undefined;
            }
            catch {
                // A lookup failure must never break a turn.
                return undefined;
            }
        });
    };
    /**
     * ACP-mode resolver wiring: whether a chat session runs the ACP agent preset.
     * Read from the session log rather than from a marker we set ourselves, so it
     * cannot drift from the roster.
     *
     * THREE fact sources, newest-wins: the live session store (`ctx.sessions`,
     * in-memory log, always fresh) — then the persistence store, because a
     * session whose last turn predates this process is not live anywhere and the
     * browser's surfaces ask exactly such cold sessions — then nothing
     * (`undefined`, which every consumer reads as "not ACP", the allowed
     * failure mode).
     */
    const wireAcpMode = () => {
        const sessions = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined);
        if (sessions === undefined)
            return;
        manager.setAcpModeResolver(dshSessionId => {
            try {
                const session = sessions.get(dshSessionId);
                // An event-less session object proves nothing: `sessions.get` hands
                // back placeholders for ids it has not hydrated (a restarted process
                // serves empty stubs for cold sessions), and folding an empty log
                // reads as the default preset — a guess, not a fact. Only a log with
                // rows may answer synchronously; anything else falls through to the
                // persisted log, which is the authoritative fold.
                if (session !== undefined && (session.events?.length ?? 0) > 0) {
                    return sessionAgentPreset(session) === ACP_PRESET_ID;
                }
            }
            catch {
                // Fall through to the cold read.
            }
            return coldAcpMode(dshSessionId);
        });
    };
    /**
     * The ACP-preset verdict for a COLD session, read from the persistence
     * store. The read handle observes the log without taking ownership (another
     * writer, live or in another process, is untouched); the header plus the
     * last `agent-preset/selected` event are the whole fold — the same
     * newest-selection-wins rule the host's own `resolveSessionPreset` applies.
     * Returns `undefined` when the service is absent, the session is unknown, or
     * anything throws: a failed lookup must never read as "definitely not ACP".
     */
    const coldAcpMode = async (dshSessionId) => {
        const persistence = (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined);
        if (persistence === undefined || typeof persistence.open !== 'function')
            return undefined;
        try {
            const handle = await persistence.open(dshSessionId, 'read');
            try {
                const tail = await handle.read(0, COLD_READ_MAX_EVENTS);
                return sessionAgentPresetFromLog(handle.header?.agentPreset, tail?.events ?? []) === ACP_PRESET_ID;
            }
            finally {
                await handle.close();
            }
        }
        catch {
            return undefined;
        }
    };
    wireApproval();
    wireWorkspace();
    wireToolCards();
    if (typeof ctx.inject === 'function') {
        // The tools service mounts with the agent plane; a deployment that loads
        // it late still gets the card executor, and until then cards stay
        // suppressed.
        ctx.inject(['tools'], () => {
            wireToolCards();
        });
    }
    if (typeof ctx.inject === 'function') {
        // Late arrival for the workspace collaborators; kept separate from the
        // approval probe so a deployment missing one service still wires the other.
        ctx.inject(['sandboxPolicy', 'sessions'], () => {
            wireWorkspace();
        });
    }
    // The ACP-preset verdict only needs the session store (live) and the
    // persistence store (cold); the sandbox knobs are NOT its dependencies.
    wireAcpMode();
    if (typeof ctx.inject === 'function') {
        ctx.inject(['sessions'], () => {
            wireAcpMode();
        });
    }
    if (typeof ctx.inject === 'function') {
        // Late arrival: both services may still be loading when this plugin
        // applies (profile order is not ours to control).
        ctx.inject(['approval', 'agents'], () => {
            wireApproval();
        });
    }
    const registerLlm = (llmHandle) => {
        ctx.effect(() => {
            // The route exists so the host's driver can reach this adapter at all:
            // `adapter.stream()` is the ONLY path by which anything lands in DSH's
            // session log, and the log is what the native chat plane renders from
            // (see docs/acp-convergence.md §1.2-1.3). It deliberately advertises no
            // models — nothing here is selectable in DSH's model catalog, and no
            // surface in this bundle writes a `model/selection` for it.
            const handle = llmHandle.registerAdapter(['acp'], adapter);
            return () => { handle(); };
        }, 'dsh-ntr: acp llm adapter');
    };
    const llmService = (typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm);
    if (llmService && typeof llmService.registerAdapter === 'function') {
        registerLlm(llmService);
    }
    else if (typeof ctx.inject === 'function') {
        ctx.inject(['llm'], (innerCtx) => {
            const innerLlm = (typeof innerCtx.get === 'function' ? innerCtx.get('llm') : innerCtx.llm);
            if (innerLlm && typeof innerLlm.registerAdapter === 'function') {
                registerLlm(innerLlm);
            }
        });
    }
    ctx.effect(() => {
        const handler = (endpoint, payload, signal) => {
            if (signal.aborted)
                return Promise.resolve({ ok: false, error: { code: 'aborted', message: 'acp: request aborted', details: {} } });
            return dispatchRpc(manager, endpoint, payload);
        };
        const connection = ctx.connection;
        // `rpc.handle` binds the route owner through Connection's traceable shadow,
        // which re-roots service lookups at the Connection service's own scope — a
        // scope that does not inject `webServer`. On the desktop 0.1.7-rc.2
        // composition that read dies with `cannot get property "webServer" without
        // inject`, the entry fails to activate, and every /acp POST falls through
        // to the static 405 fallback. `register` takes the owning context
        // explicitly, so pass ours — it declares webServer.
        //
        // The probe is presence-only (the method is private, so there is no type to
        // check against), so treat surprises conservatively: a `register` that
        // throws counts as absent (nothing was registered → use the documented
        // path), while one that returns something other than the disposer this
        // effect needs is kept anyway (the channel works; re-registering it through
        // the fallback would register twice) with a no-op disposer.
        if (typeof connection.register === 'function') {
            try {
                const disposer = connection.register(ctx, '/acp', handler);
                return typeof disposer === 'function' ? disposer : () => Promise.resolve();
            }
            catch { /* an unusable `register` is no better than none */ }
        }
        return connection.rpc.handle('/acp', handler);
    }, 'dsh-ntr: /acp rpc channel');
    ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/acp/stream',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => {
            const stream = new ReadableStream({
                start(controller) {
                    const encoder = new TextEncoder();
                    let closed = false;
                    const send = (event) => {
                        if (closed)
                            return;
                        try {
                            controller.enqueue(encoder.encode(formatSse(event)));
                        }
                        catch {
                            closed = true;
                        }
                    };
                    const unsubscribe = hub.subscribe(send);
                    const keepalive = setInterval(() => {
                        if (closed)
                            return;
                        try {
                            controller.enqueue(encoder.encode(': keepalive\n\n'));
                        }
                        catch {
                            closed = true;
                        }
                    }, 25_000);
                    keepalive.unref?.();
                    const finish = () => {
                        if (closed)
                            return;
                        closed = true;
                        clearInterval(keepalive);
                        unsubscribe();
                        try {
                            controller.close();
                        }
                        catch { /* already closed */ }
                    };
                    request.signal.addEventListener('abort', finish, { once: true });
                    // First frame: tell the client the stream is live.
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stream/open' })}\n\n`));
                    }
                    catch {
                        closed = true;
                    }
                    // Then re-establish the client's view of the pending permission
                    // asks. Taken AFTER the subscription, so an ask broadcast in the
                    // meantime arrives both live and in the snapshot — the client folds
                    // both by request id — and the terminator's live set prunes anything
                    // this client still holds from before a disconnect.
                    for (const frame of permissionReplayFrames(manager.pendingPermissionViews())) {
                        try {
                            controller.enqueue(encoder.encode(formatSse(frame)));
                        }
                        catch {
                            closed = true;
                            break;
                        }
                    }
                },
            });
            return Promise.resolve(new Response(stream, {
                status: 200,
                headers: {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-transform',
                    'connection': 'keep-alive',
                    'x-accel-buffering': 'no',
                },
            }));
        },
    }), 'dsh-ntr: /api/acp/stream SSE route');
    ctx.effect(() => async () => {
        await manager.shutdownAll();
    }, 'dsh-ntr: child teardown');
}
