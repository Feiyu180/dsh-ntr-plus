window.__ModuleLoader__.load({
	id: "dsh-ntr",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/protocol.ts
		/** Default when nothing was ever saved: the breathing halo at normal speed. */
		const DEFAULT_TAG_HALO = {
			mode: "breath",
			speed: "normal"
		};
		//#endregion
		//#region src/client/store.ts
		const MAX_BLOCKS = 400;
		/** How many observed ACP transcripts stay live at once (insertion-ordered eviction). */
		const MAX_WATCHED = 6;
		/** Raw JSON budget for one event block; the cut is marked. */
		const RAW_MAX = 256e3;
		/** Pretty-printed JSON of an agent message (never throws, cuts only at {@link RAW_MAX} with a marker). */
		function jsonText(value) {
			let text;
			try {
				text = JSON.stringify(value, null, 2) ?? String(value);
			} catch {
				text = String(value);
			}
			return text.length > RAW_MAX ? `${text.slice(0, RAW_MAX)}\n… [truncated ${String(text.length - RAW_MAX)} chars]` : text;
		}
		/**
		* The call's arguments as the agent sent them. Accepts every spelling seen in
		* the wild (`rawInput` / `arguments`, string / object / array) and never
		* invents one: a call with no input gets `undefined`.
		*/
		function toolInputOf(update) {
			for (const key of ["rawInput", "arguments"]) {
				const value = update[key];
				if (typeof value === "string") {
					if (value !== "") return value;
					continue;
				}
				if (Array.isArray(value)) {
					if (value.length > 0) return JSON.stringify(value, null, 2);
					continue;
				}
				if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
			}
		}
		/** The call's other named fields, one `key: value` per line. */
		function toolDetailsOf(update) {
			const lines = [];
			for (const key of [
				"kind",
				"status",
				"locations",
				"terminalId",
				"meta"
			]) {
				const value = update[key];
				if (value === void 0 || value === null || value === "") continue;
				if (key === "locations" && Array.isArray(value) && value.length === 0) continue;
				lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
			}
			return lines;
		}
		/** Text a `text` / `thinking` chunk's `content` carries (string, object, or array of blocks). */
		function chunkText(content) {
			if (typeof content === "string") return content;
			if (Array.isArray(content)) return content.map((item) => {
				if (typeof item === "string") return item;
				if (typeof item === "object" && item !== null) {
					const row = item;
					return typeof row.text === "string" ? row.text : JSON.stringify(item);
				}
				return "";
			}).join("");
			if (typeof content === "object" && content !== null) {
				const row = content;
				if (typeof row.text === "string") return row.text;
				return JSON.stringify(content);
			}
			return "";
		}
		/**
		* One tool call's `content`, split into what the card renders as text
		* ({@link lines}), the structured edits it renders as diffs, and everything
		* else as its own readable text ({@link extras}). Nothing is dropped: a diff is
		* ALSO shown as text (header plus `-`/`+` lines) because the model's view of a
		* tool result is text, and a kind this build cannot render becomes its full
		* JSON.
		*/
		function splitToolContent(content) {
			const lines = [];
			const extras = [];
			const diffs = [];
			if (!Array.isArray(content)) {
				if (typeof content === "string" && content !== "") lines.push(content);
				return {
					lines,
					extras
				};
			}
			for (const item of content) {
				if (typeof item === "string") {
					if (item !== "") lines.push(item);
					continue;
				}
				if (typeof item !== "object" || item === null) continue;
				const row = item;
				if (row.type === "content") {
					const inner = row.content;
					if (typeof inner === "string") lines.push(inner);
					else if (inner?.type === "text") lines.push(typeof inner.text === "string" ? inner.text : JSON.stringify(item));
					else if (inner?.type === "diff" && typeof inner.path === "string") {
						const diff = {
							path: inner.path,
							oldText: typeof inner.oldText === "string" ? inner.oldText : null,
							newText: typeof inner.newText === "string" ? inner.newText : ""
						};
						diffs.push(diff);
						lines.push(diffText(diff));
					} else extras.push(`${String(inner?.type ?? "content")} ${JSON.stringify(item)}`);
					continue;
				}
				if (row.type === "diff" && typeof row.path === "string" && typeof row.newText === "string") {
					const diff = {
						path: row.path,
						oldText: typeof row.oldText === "string" ? row.oldText : null,
						newText: row.newText
					};
					diffs.push(diff);
					lines.push(diffText(diff));
					continue;
				}
				if (row.type === "text" && typeof row.text === "string") {
					lines.push(row.text);
					continue;
				}
				extras.push(`${String(row.type ?? "content")} ${JSON.stringify(item)}`);
			}
			return {
				lines,
				extras,
				...diffs.length === 0 ? {} : { diffs }
			};
		}
		/** A structured edit as plain text: its path, then `-`/`+` lines with three lines of context. */
		function diffText(diff) {
			const split = (text) => text === null || text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
			const oldLines = split(diff.oldText);
			const newLines = split(diff.newText);
			let head = 0;
			while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
			let tail = 0;
			while (tail < oldLines.length - head && tail < newLines.length - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
			const out = [diff.path];
			for (let i = Math.max(0, head - 3); i < head; i++) out.push(`  ${oldLines[i] ?? ""}`);
			for (let i = head; i < oldLines.length - tail; i++) out.push(`- ${oldLines[i] ?? ""}`);
			for (let i = head; i < newLines.length - tail; i++) out.push(`+ ${newLines[i] ?? ""}`);
			for (let i = oldLines.length - tail; i < oldLines.length; i++) out.push(`  ${oldLines[i] ?? ""}`);
			return out.join("\n");
		}
		/** The readable fold of a notification the view has no card of its own for. */
		function describeEvent(kind, update) {
			if (kind === "available_commands_update") return (Array.isArray(update.availableCommands) ? update.availableCommands : []).map((command) => {
				const row = typeof command === "object" && command !== null ? command : {};
				return `${typeof row.name === "string" ? row.name : ""}${typeof row.description === "string" && row.description !== "" ? ` — ${row.description}` : ""}`;
			}).join("\n");
			if (kind === "plan") return (Array.isArray(update.entries) ? update.entries : []).map((entry) => {
				const row = typeof entry === "object" && entry !== null ? entry : {};
				return `[${String(row.status ?? "pending")}] ${String(row.content ?? "")}`;
			}).join("\n");
			if (kind === "current_mode_update" && typeof update.currentModeId === "string") return update.currentModeId;
			return "";
		}
		const DEFAULT_KNOWN_PRESETS = [
			{
				id: "pi",
				name: "Pi Coding Agent",
				description: "Automata / Pi Coding Agent with native ACP bridge support",
				detected: false,
				defaultCommand: "pi-acp",
				defaultArgs: []
			},
			{
				id: "omp",
				name: "Oh My Pi",
				description: "Oh My Pi (pi-based coding agent) — run as `omp acp` over stdio",
				detected: false,
				defaultCommand: "omp",
				defaultArgs: ["acp"]
			},
			{
				id: "codebuddy",
				name: "CodeBuddy Code",
				description: "Tencent CodeBuddy Code — run as `codebuddy --acp` over stdio",
				detected: false,
				defaultCommand: "codebuddy",
				defaultArgs: ["--acp"]
			},
			{
				id: "claude",
				name: "Claude Code",
				description: "Claude Agent SDK adapter — run as `npx -y @agentclientprotocol/claude-agent-acp` over stdio",
				detected: false,
				defaultCommand: "npx",
				defaultArgs: ["-y", "@agentclientprotocol/claude-agent-acp"]
			},
			{
				id: "codex",
				name: "Codex",
				description: "OpenAI Codex adapter — run as `npx -y @agentclientprotocol/codex-acp` over stdio",
				detected: false,
				defaultCommand: "npx",
				defaultArgs: ["-y", "@agentclientprotocol/codex-acp"]
			},
			{
				id: "gemini",
				name: "Gemini CLI",
				description: "Google Gemini CLI — run as `gemini --experimental-acp` over stdio",
				detected: false,
				defaultCommand: "gemini",
				defaultArgs: ["--experimental-acp"]
			},
			{
				id: "opencode",
				name: "OpenCode",
				description: "OpenCode — run as `opencode acp` over stdio",
				detected: false,
				defaultCommand: "opencode",
				defaultArgs: ["acp"]
			},
			{
				id: "qwen",
				name: "Qwen Code",
				description: "Qwen Code — run as `qwen --experimental-acp` over stdio",
				detected: false,
				defaultCommand: "qwen",
				defaultArgs: ["--experimental-acp"]
			},
			{
				id: "kiro",
				name: "Kiro",
				description: "Kiro CLI — run as `kiro-cli acp` over stdio",
				detected: false,
				defaultCommand: "kiro-cli",
				defaultArgs: ["acp"]
			},
			{
				id: "qoder",
				name: "Qoder",
				description: "Qoder CLI — run as `qodercli --acp` over stdio",
				detected: false,
				defaultCommand: "qodercli",
				defaultArgs: ["--acp"]
			},
			{
				id: "qoder-cn",
				name: "Qoder CN",
				description: "Qoder CLI (China) — run as `qoderclicn --acp` over stdio",
				detected: false,
				defaultCommand: "qoderclicn",
				defaultArgs: ["--acp"]
			}
		];
		var AcpStore = class {
			rpc;
			locale;
			state = {
				open: false,
				localeRev: 0,
				stream: "init",
				agents: [],
				agentsLoaded: false,
				sessions: [],
				blocks: [],
				permissions: [],
				busy: false,
				detectedAgents: [...DEFAULT_KNOWN_PRESETS],
				detecting: false,
				modelCatalogs: {},
				seatCatalogs: {},
				probingModels: {},
				probeErrors: {},
				approvalRouted: false,
				chatSessions: [],
				tagHalo: { ...DEFAULT_TAG_HALO },
				approvalDeadlines: void 0,
				chatTranscripts: {},
				acpMode: {},
				chatBoundAgent: {},
				chatLockedAgent: {},
				agentLockReveal: {},
				chatChoice: {},
				seatDiag: "idle",
				permissionSeatDiag: "idle",
				slashDiag: "idle"
			};
			listeners = /* @__PURE__ */ new Set();
			source;
			lastSeq = /* @__PURE__ */ new Map();
			/** Sessions with a finalized turn (dedups the cancel-fallback + late real turn/end pair). */
			openTurns = /* @__PURE__ */ new Set();
			/** In-flight `session/chat-list` reads, keyed by chat session id. */
			chatSessionReads = /* @__PURE__ */ new Map();
			/**
			* Chat sessions whose list has answered at least once in this page. The
			* FIRST answer only seeds the lock; a lock appearing on a later answer is a
			* transition this page actually witnessed, and only that one is announced via
			* {@link UiState.agentLockReveal}.
			*/
			chatListLoaded = /* @__PURE__ */ new Set();
			/**
			* Conversations whose provisional first-turn lock the host rolled back
			* (`chat/agent-unlocked`, no visible output in the first turn). A
			* `session/chat-list` read that started BEFORE the rollback can still name
			* `lockedAgentId`; it must not revive the lock. A new `chat/agent-locked`
			* frame clears the entry (the user retried and the turn really started).
			*/
			chatUnlocked = /* @__PURE__ */ new Set();
			/**
			* Sessions whose ACP-mode verdict a committed `agent-preset/selected` frame
			* settled. A frame settles the verdict; the host's log read can lag a switch
			* by one (the appended row is not yet visible to a fresh read, and the seat
			* taking the model cell re-mounts readers), so a read may only settle a
			* session no frame has spoken for — otherwise a stale answer would regress a
			* verdict the runtime already told us the truth about.
			*
			* The ONE exception is the gate's own re-ask ({@link loadChatSessions} with
			* `settleVerdict`): a verdict the gate has held as its only fact source for
			* longer than its TTL is exactly the case where the frame path has gone
			* quiet, and without an authorized re-read a switch the runtime never framed
			* could never be corrected.
			*/
			acpModeLive = /* @__PURE__ */ new Set();
			/**
			* Chat sessions whose host read came back WITHOUT a verdict (no `acpMode`
			* field, or the read failed). The seat gate consults this to retract its
			* one-shot ask ledger entry, so a read that could not answer costs one retry
			* instead of leaving the native model seat visible for the rest of the page.
			*/
			acpModeUnsettled = /* @__PURE__ */ new Set();
			/** In-flight `agent/catalog` reads, keyed by agent id. */
			seatCatalogReads = /* @__PURE__ */ new Set();
			/** In-flight `agent/cached-models` reads, keyed by agent id. */
			cachedModelReads = /* @__PURE__ */ new Set();
			/** Counts behind the last successful explicit re-detect, so a locale switch can re-render its summary. */
			detectCounts;
			constructor(rpc, locale) {
				this.rpc = rpc;
				this.locale = locale;
			}
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			getSnapshot() {
				return this.state;
			}
			mutate(patch, blocksChanged = false) {
				this.state = {
					...this.state,
					...patch,
					blocks: blocksChanged ? [...this.state.blocks] : patch.blocks ?? this.state.blocks
				};
				for (const listener of [...this.listeners]) listener();
			}
			/**
			* Live `session/update` frames waiting to be folded. Agents stream at token
			* granularity — hundreds of frames a second with usage ticks interleaved —
			* and folding plus notifying listeners per frame re-rendered every store
			* consumer per chunk. Frames are coalesced into ONE fold + ONE mutate per
			* animation frame instead; the order inside a batch is preserved, and the
			* transcript watermark (`lastSeq`) advances per batch.
			*/
			pendingUpdates = [];
			updateFlushArmed = false;
			/** Fold everything pending now (idempotent; the scheduler clears its flag). */
			flushUpdates() {
				const batch = this.pendingUpdates.splice(0, this.pendingUpdates.length);
				this.updateFlushArmed = false;
				if (batch.length === 0) return;
				const bySession = /* @__PURE__ */ new Map();
				for (const item of batch) {
					const list = bySession.get(item.sessionId);
					if (list === void 0) bySession.set(item.sessionId, [item]);
					else list.push(item);
				}
				let chatTranscripts = this.state.chatTranscripts;
				let blocksChanged = false;
				for (const [sessionId, items] of bySession) {
					const last = items[items.length - 1];
					const record = chatTranscripts[sessionId];
					if (record !== void 0) {
						let changed = false;
						for (const item of items) if (foldUpdate(record.blocks, item.update)) changed = true;
						chatTranscripts = {
							...chatTranscripts,
							[sessionId]: {
								...record,
								seq: last.seq,
								...changed ? { blocks: [...record.blocks] } : {}
							}
						};
					}
					if (sessionId !== this.state.activeSessionId) {
						this.lastSeq.set(sessionId, last.seq);
						continue;
					}
					const seen = this.lastSeq.get(sessionId);
					const contiguous = seen === void 0 || items[0].seq === seen + 1 && items.every((item, index) => index === 0 || item.seq === items[index - 1].seq + 1);
					this.lastSeq.set(sessionId, last.seq);
					if (!contiguous) {
						this.loadTranscript(sessionId);
						continue;
					}
					for (const item of items) if (foldUpdate(this.state.blocks, item.update)) blocksChanged = true;
				}
				const patch = {};
				if (chatTranscripts !== this.state.chatTranscripts) patch.chatTranscripts = chatTranscripts;
				if (blocksChanged) patch.blocks = [...this.state.blocks];
				if (Object.keys(patch).length > 0) this.mutate(patch);
			}
			armUpdateFlush() {
				if (this.updateFlushArmed) return;
				this.updateFlushArmed = true;
				if (typeof requestAnimationFrame === "function") {
					requestAnimationFrame(() => {
						this.updateFlushArmed = false;
						this.flushUpdates();
					});
					return;
				}
				this.flushUpdates();
			}
			/** Open the shared event stream once; schedule first snapshot fetch. */
			start() {
				if (this.source !== void 0) return;
				this.connectStream();
			}
			connectStream() {
				const source = new EventSource("/api/acp/stream");
				source.onopen = () => {
					this.resync();
					this.mutate({ stream: "live" });
				};
				source.onerror = () => {
					this.mutate({ stream: "down" });
				};
				source.onmessage = (raw) => {
					let event;
					try {
						event = JSON.parse(String(raw.data));
					} catch {
						return;
					}
					this.applyEvent(event);
				};
				this.source = source;
			}
			async call(endpoint, payload = {}) {
				const result = await this.rpc("/acp", endpoint, payload);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			}
			/** Snapshot refresh used on panel open and after a stream outage. */
			async resync() {
				try {
					const [{ agents, approvalRouted }, { sessions }, defaultAgentInfo, detectResult, presetResult, tagHaloResult, deadlinesResult] = await Promise.all([
						this.call("agents/list"),
						this.call("sessions/list"),
						this.call("default/agent").catch(() => ({})),
						this.call("agents/detect").catch(() => null),
						this.call("preset/status").catch(() => null),
						this.call("ui/tag-halo").catch(() => ({ halo: { ...DEFAULT_TAG_HALO } })),
						this.call("ui/approval-deadlines").catch(() => ({ deadlines: void 0 }))
					]);
					const detectedAgents = detectResult && detectResult.agents.length > 0 ? detectResult.agents : this.state.detectedAgents.length > 0 ? this.state.detectedAgents : [...DEFAULT_KNOWN_PRESETS];
					this.mutate({
						agents,
						agentsLoaded: true,
						sessions,
						defaultAgent: defaultAgentInfo?.agentId,
						detectedAgents,
						approvalRouted: approvalRouted === true,
						preset: presetResult?.preset ?? void 0,
						tagHalo: tagHaloResult?.halo ?? { ...DEFAULT_TAG_HALO },
						approvalDeadlines: deadlinesResult.deadlines
					});
					const active = this.state.activeSessionId ?? sessions[0]?.sessionId;
					if (active !== void 0) await this.loadTranscript(active);
				} catch (error) {
					this.mutate({ notice: String(error instanceof Error ? error.message : error) });
				}
			}
			async detectAgents() {
				this.mutate({ detecting: true });
				try {
					const result = await this.call("agents/detect");
					const agents = result.agents.length > 0 ? result.agents : [...DEFAULT_KNOWN_PRESETS];
					const installed = agents.filter((agent) => agent.detected).length;
					this.detectCounts = {
						total: agents.length,
						installed
					};
					this.mutate({
						detectedAgents: agents,
						detecting: false,
						detectSummary: this.detectSummaryOf(agents.length, installed)
					});
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					const notice = msg.includes("unknown endpoint agents/detect") ? this.locale("宿主服务运行着旧版本代码，请在终端重启 dsh web 服务以激活主机检测功能。", "Host running older version. Please restart dsh web to enable agent detection.") : msg;
					this.detectCounts = void 0;
					this.mutate({
						detecting: false,
						notice,
						detectedAgents: this.state.detectedAgents.length > 0 ? this.state.detectedAgents : [...DEFAULT_KNOWN_PRESETS],
						detectSummary: void 0
					});
				}
			}
			detectSummaryOf(total, installed) {
				return this.locale(`已检测 ${String(total)} 个预设：${String(installed)} 个已安装，其余可从「添加智能体」启用。`, `Detected ${String(total)} presets: ${String(installed)} installed, enable the rest via "Add agent".`);
			}
			async saveAgent(payload) {
				try {
					await this.call("agent/save", payload);
					await this.resync();
					this.probeModels(payload.id);
				} catch (error) {
					this.flashError(error);
					throw error;
				}
			}
			/**
			* Dry-run the connection form: the host spawns a throwaway process from
			* these exact values, handshakes, and tears it down. A reachable-but-broken
			* agent arrives as `{ ok: false }`, not a thrown error; only transport or
			* validation failures reject.
			*/
			async testAgent(payload) {
				try {
					return await this.call("agent/test", payload);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					const notice = msg.includes("unknown endpoint agent/test") ? this.locale("宿主服务运行着旧版本代码，请在终端重启 dsh web 服务以启用连接测试功能。", "Host running older version. Please restart dsh web to enable connection testing.") : msg;
					this.mutate({ notice });
					throw error;
				}
			}
			/**
			* Seed one agent's model panes from the host's PERSISTENT catalog cache
			* (`agent/cached-models`, memory-only: it never spawns).
			*
			* The settings card used to learn a catalog only from `agent/probe-models`,
			* so its panes stayed blank until the user clicked 「检测可用模型」 on every
			* visit — including the models already configured, which are known from the
			* agent definition and the on-disk catalog. This read fills both panes on
			* mount; the probe stays the explicit REFRESH (add what the agent newly
			* publishes, drop what it stopped advertising).
			*/
			async loadCachedModels(agentId) {
				if (this.state.modelCatalogs[agentId] !== void 0 || this.cachedModelReads.has(agentId)) return;
				this.cachedModelReads.add(agentId);
				try {
					const result = await this.call("agent/cached-models", { agentId });
					if (result === null || result === void 0 || this.state.modelCatalogs[agentId] !== void 0) return;
					this.mutate({ modelCatalogs: {
						...this.state.modelCatalogs,
						[agentId]: result
					} });
				} catch {} finally {
					this.cachedModelReads.delete(agentId);
				}
			}
			/** Ask the host to probe one agent's model catalog (spawn + throwaway session). */
			async probeModels(agentId) {
				const previousError = this.state.probeErrors[agentId];
				this.mutate({
					probingModels: {
						...this.state.probingModels,
						[agentId]: true
					},
					probeErrors: this.clearProbeError(agentId)
				});
				try {
					const result = await this.call("agent/probe-models", { agentId });
					const seatCatalogs = { ...this.state.seatCatalogs };
					delete seatCatalogs[agentId];
					this.mutate({
						modelCatalogs: {
							...this.state.modelCatalogs,
							[agentId]: result
						},
						seatCatalogs,
						probingModels: {
							...this.state.probingModels,
							[agentId]: false
						},
						...previousError !== void 0 && this.state.notice === previousError ? { notice: void 0 } : {}
					});
					this.loadAgentCatalog(agentId);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					const notice = msg.includes("unknown endpoint agent/probe-models") ? this.locale("宿主服务运行着旧版本代码，请在终端重启 dsh web 服务以激活模型检测功能。", "Host running older version. Please restart dsh web to enable model detection.") : msg;
					this.mutate({
						notice,
						probingModels: {
							...this.state.probingModels,
							[agentId]: false
						},
						probeErrors: {
							...this.state.probeErrors,
							[agentId]: notice
						}
					});
				}
			}
			clearProbeError(agentId) {
				if (this.state.probeErrors[agentId] === void 0) return this.state.probeErrors;
				const next = { ...this.state.probeErrors };
				delete next[agentId];
				return next;
			}
			/**
			* Read one agent's ACP model surface (`agent/catalog`) — what the composer
			* chips and the ACP-mode model seat render. Cached per agent, because the
			* list only changes when the agent's catalog is re-probed or its exposure
			* filter is edited (both of which drop the cache below), and deduped because
			* every ACP surface asks for it on mount.
			*
			* The host answers from memory, so this is safe to call from a render effect;
			* a probe it may trigger runs in the background on the host side.
			*/
			async loadAgentCatalog(agentId) {
				if (this.state.seatCatalogs[agentId] !== void 0 || this.seatCatalogReads.has(agentId)) return;
				this.seatCatalogReads.add(agentId);
				try {
					const result = await this.call("agent/catalog", { agentId });
					this.mutate({ seatCatalogs: {
						...this.state.seatCatalogs,
						[agentId]: result
					} });
				} catch {} finally {
					this.seatCatalogReads.delete(agentId);
				}
			}
			/** Drop one agent's cached seat catalog (its model surface just changed). */
			invalidateSeatCatalog(agentId) {
				if (this.state.seatCatalogs[agentId] === void 0) return;
				const next = { ...this.state.seatCatalogs };
				delete next[agentId];
				this.mutate({ seatCatalogs: next });
			}
			/**
			* Persist the ACP-seat model filter for one agent. `undefined` clears the
			* filter — same as an empty list, i.e. no `agentId@choice` variants, only
			* the agent's base entry. Uses the dedicated lightweight RPC so the agent
			* process and its live sessions are never restarted.
			*/
			async setExposedModels(agentId, exposedModels) {
				try {
					await this.call("agent/set-exposed-models", {
						agentId,
						...exposedModels === void 0 ? {} : { exposedModels }
					});
					await this.resync();
					this.invalidateSeatCatalog(agentId);
					this.loadAgentCatalog(agentId);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					const notice = msg.includes("unknown endpoint agent/set-exposed-models") ? this.locale("宿主服务运行着旧版本代码，请在终端重启 dsh web 服务以启用模型筛选功能。", "Host running older version. Please restart dsh web to enable model filtering.") : msg;
					this.mutate({ notice });
					throw error;
				}
			}
			async deleteAgent(agentId) {
				try {
					await this.call("agent/delete", { agentId });
					await this.resync();
					this.invalidateSeatCatalog(agentId);
				} catch (error) {
					this.flashError(error);
					throw error;
				}
			}
			/**
			* Persist the auto-discovery switch for one agent. Lightweight like
			* {@link setExposedModels}: no process restart, and the current selection is
			* left exactly as it is.
			*/
			async setAutoDiscoverModels(agentId, autoDiscoverModels) {
				try {
					await this.call("agent/set-auto-discover-models", {
						agentId,
						autoDiscoverModels
					});
					await this.resync();
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					const notice = msg.includes("unknown endpoint agent/set-auto-discover-models") ? this.locale("宿主服务运行着旧版本代码，请在终端重启 dsh web 服务以启用自动发现功能。", "Host running older version. Please restart dsh web to enable auto-discovery.") : msg;
					this.mutate({ notice });
					throw error;
				}
			}
			toggle() {
				const nextOpen = !this.state.open;
				this.mutate({ open: nextOpen });
				if (nextOpen) {
					this.start();
					this.resync();
				}
			}
			close() {
				this.mutate({ open: false });
			}
			selectSession(sessionId) {
				this.mutate({ activeSessionId: sessionId });
				this.loadTranscript(sessionId);
			}
			async loadTranscript(sessionId) {
				try {
					const { session, entries } = await this.call("transcript/get", { sessionId });
					const blocks = [];
					for (const entry of entries) {
						blocks.length;
						foldUpdate(blocks, entry.update);
						this.lastSeq.set(sessionId, Math.max(this.lastSeq.get(sessionId) ?? 0, entry.seq));
					}
					const sessions = this.state.sessions.some((s) => s.sessionId === sessionId) ? this.state.sessions.map((s) => s.sessionId === sessionId ? session : s) : [...this.state.sessions, session];
					this.mutate({
						sessions,
						blocks,
						activeSessionId: sessionId
					});
				} catch {
					this.mutate({ blocks: [] });
				}
			}
			async startSession(agentId, cwd) {
				try {
					const { sessionId } = await this.call("session/start", {
						agentId,
						...cwd === void 0 || cwd === "" ? {} : { cwd }
					});
					await this.resync();
					this.selectSession(sessionId);
				} catch (error) {
					this.flashError(error);
				}
			}
			async sendPrompt(text) {
				const sessionId = this.state.activeSessionId;
				if (sessionId === void 0 || text.trim() === "") return;
				this.mutate({ busy: true });
				try {
					await this.call("session/prompt", {
						sessionId,
						text
					});
				} catch (error) {
					this.flashError(error);
				} finally {
					this.mutate({ busy: false });
				}
			}
			async cancelActive() {
				const sessionId = this.state.activeSessionId;
				if (sessionId === void 0) return;
				try {
					await this.call("session/cancel", { sessionId });
				} catch (error) {
					this.flashError(error);
				}
			}
			async closeActive() {
				const sessionId = this.state.activeSessionId;
				if (sessionId === void 0) return;
				try {
					await this.call("session/close", { sessionId });
				} catch (error) {
					this.flashError(error);
				}
			}
			async setMode(modeId) {
				const sessionId = this.state.activeSessionId;
				if (sessionId === void 0) return;
				try {
					await this.call("session/mode-set", {
						sessionId,
						modeId
					});
				} catch (error) {
					this.flashError(error);
				}
			}
			/**
			* Load the ACP agent sessions backing one DSH chat session. The composer
			* control calls this per chat session (and again whenever a turn settles, so
			* the binding a fresh conversation just created shows up).
			*/
			/**
			* Load the ACP agent sessions backing one DSH chat session. The composer
			* control calls this per chat session (and again whenever a turn settles, so
			* the binding a fresh conversation just created shows up).
			*
			* `settleVerdict` is the seat gate's own re-ask and the ONLY read allowed to
			* settle a verdict a frame had already settled (see {@link acpModeLive}): the
			* gate holds such a verdict as its only fact source while the session row
			* stays silent, and a host read is the one place a switch the runtime never
			* framed can still be learned from. Composer readers pass nothing and keep
			* the frame's authority.
			*/
			loadChatSessions(dshSessionId, options) {
				const inFlight = this.chatSessionReads.get(dshSessionId);
				if (inFlight !== void 0) return inFlight.done;
				const read = {
					dropped: false,
					done: Promise.resolve()
				};
				this.chatSessionReads.set(dshSessionId, read);
				read.done = this.readChatSessionList(dshSessionId, options, read);
				return read.done;
			}
			async readChatSessionList(dshSessionId, options, read) {
				const settle = options?.settleVerdict === true || !this.acpModeLive.has(dshSessionId);
				try {
					const { sessions, acpMode, boundAgentId, lockedAgentId, choice } = await this.call("session/chat-list", {
						dshSessionId,
						refresh: true
					});
					if (read.dropped) return;
					const firstAnswer = !this.chatListLoaded.has(dshSessionId);
					this.chatListLoaded.add(dshSessionId);
					if (lockedAgentId === void 0) this.chatUnlocked.delete(dshSessionId);
					const reportedLock = lockedAgentId !== void 0 && this.chatUnlocked.has(dshSessionId) ? void 0 : lockedAgentId;
					const chatLockedAgent = reportedLock === void 0 ? this.state.chatLockedAgent : {
						...this.state.chatLockedAgent,
						[dshSessionId]: reportedLock
					};
					const agentLockReveal = !firstAnswer && reportedLock !== void 0 && this.state.chatLockedAgent[dshSessionId] === void 0 ? {
						...this.state.agentLockReveal,
						[dshSessionId]: (this.state.agentLockReveal[dshSessionId] ?? 0) + 1
					} : this.state.agentLockReveal;
					this.mutate({
						chatSessions: sessions,
						chatSessionsFor: dshSessionId,
						chatLockedAgent,
						agentLockReveal,
						...boundAgentId === void 0 ? {} : { chatBoundAgent: {
							...this.state.chatBoundAgent,
							[dshSessionId]: boundAgentId
						} },
						...choice === void 0 ? {} : { chatChoice: {
							...this.state.chatChoice,
							[dshSessionId]: choice
						} },
						...acpMode === void 0 || !settle ? {} : { acpMode: {
							...this.state.acpMode,
							[dshSessionId]: acpMode === true
						} }
					});
					if (acpMode === void 0 && settle) this.acpModeUnsettled.add(dshSessionId);
				} catch {
					if (read.dropped) return;
					this.mutate({
						chatSessions: [],
						chatSessionsFor: dshSessionId
					});
					if (settle) this.acpModeUnsettled.add(dshSessionId);
				} finally {
					if (this.chatSessionReads.get(dshSessionId) === read) this.chatSessionReads.delete(dshSessionId);
				}
			}
			/**
			* Abandon the in-flight `session/chat-list` read for one session (or all of
			* them): a committed `agent-preset/selected` frame carries the authoritative
			* verdict, and the late answer to an ask that predates the frame describes
			* the log from before the switch — it must not land in the store.
			*/
			abandonChatSessionRead(dshSessionId) {
				if (dshSessionId === void 0) {
					for (const read of this.chatSessionReads.values()) read.dropped = true;
					this.chatSessionReads.clear();
					return;
				}
				const read = this.chatSessionReads.get(dshSessionId);
				if (read === void 0) return;
				read.dropped = true;
				this.chatSessionReads.delete(dshSessionId);
			}
			/**
			* The slash commands the LIVE ACP session declared for one chat session, as
			* read by {@link loadChatSessions} (`available_commands_update` →
			* `session/chat-list`).
			*
			* `undefined` covers both "no answer has landed yet" and "there is no live
			* session (or it has not declared anything)" — in every one of those cases
			* the caller falls back to the agent-level cache ({@link agentCommands}),
			* which is what makes `/` list commands before the first message exists.
			*/
			chatSessionCommands(dshSessionId) {
				if (this.state.chatSessionsFor !== dshSessionId) return void 0;
				return this.state.chatSessions[0]?.availableCommands;
			}
			/**
			* The slash commands the agent declared in its most recent session, from
			* `agent/catalog` (host-cached per agent, see `AgentCatalogResult.commands`).
			* The pre-first-turn source for the `/` menu.
			*/
			agentCommands(agentId) {
				if (agentId === void 0) return void 0;
				return this.state.seatCatalogs[agentId]?.commands;
			}
			/**
			* Which agent serves one conversation as far as this page can tell, without
			* reading any catalog: live ACP session → agent lock → host/optimistic
			* binding → persisted pick → plugin default. Used to find the agent whose
			* cached commands the `/` menu should offer before a session exists.
			*/
			chatAgentFor(dshSessionId) {
				if (this.state.chatSessionsFor === dshSessionId) {
					const live = this.state.chatSessions[0];
					if (live !== void 0) return live.agentId;
				}
				return this.state.chatLockedAgent[dshSessionId] ?? this.state.chatBoundAgent[dshSessionId] ?? this.state.chatChoice[dshSessionId]?.agentId ?? this.state.defaultAgent;
			}
			/**
			* Record the verdict a committed `agent-preset/selected` frame carries, folded
			* from the frame's own preset field ({@link acpModeFromPresetEvent}). The
			* frame is authoritative: it marks the session live-settled, so no later host
			* read may regress it (see {@link acpModeLive}) — the gate's own TTL re-ask
			* being the one authorized exception. Same no-op-when-unchanged discipline as
			* the other accessors, so a frame restating the held verdict costs no
			* listener churn.
			*/
			noteAcpMode(dshSessionId, acpMode) {
				this.acpModeLive.add(dshSessionId);
				if (this.state.acpMode[dshSessionId] === acpMode) return;
				this.mutate({ acpMode: {
					...this.state.acpMode,
					[dshSessionId]: acpMode
				} });
			}
			/**
			* Record the model-seat gate's last decision (see the `seatDiag` field). The
			* gate owns the string; the store only carries it so the ACP view can render
			* *why* the native seat is or is not shadowed. No-op when unchanged, so the
			* gate can call this on every evaluation without churning listeners.
			*/
			noteSeatDiag(text) {
				if (this.state.seatDiag === text) return;
				this.mutate({ seatDiag: text });
			}
			/**
			* Record the permission-seat gate's last decision (`conversation.input.permission`).
			*/
			notePermissionSeatDiag(text) {
				if (this.state.permissionSeatDiag === text) return;
				this.mutate({ permissionSeatDiag: text });
			}
			/**
			* Record the slash-isolation seam's last verdict (`idle` = in force, or no
			* problem to report). No-op when unchanged, like the seat lines.
			*/
			noteSlashDiag(text) {
				if (this.state.slashDiag === text) return;
				this.mutate({ slashDiag: text });
			}
			/**
			* Whether a chat session's host read produced a verdict the seat gate can
			* rely on. `false` means "asked but not answered" — the read returned no
			* `acpMode` field or failed outright — and is the signal for the gate to
			* retract its one-shot ask ledger entry for this id so it can ask again.
			*
			* A verdict handed down by a committed `agent-preset/selected` frame is
			* authoritative and outranks everything (see {@link acpModeLive}); such a
			* session always answers `true` here, settled or not.
			*/
			hasAcpModeVerdict(dshSessionId) {
				if (this.acpModeLive.has(dshSessionId)) return true;
				if (this.acpModeUnsettled.has(dshSessionId)) {
					this.acpModeUnsettled.delete(dshSessionId);
					return false;
				}
				return this.state.acpMode[dshSessionId] !== void 0;
			}
			/**
			* Drop one chat session's ACP-mode verdict — or the whole map. The preset
			* switch a session committed is announced by the host (`agent-preset/selected`)
			* and folded by the runtime into its own rows, but NOT into this map, so the
			* gate re-asks instead of trusting a verdict the session log has moved past.
			*/
			invalidateAcpMode(dshSessionId) {
				if (dshSessionId === void 0) {
					this.acpModeLive.clear();
					if (Object.keys(this.state.acpMode).length === 0) return;
					this.mutate({ acpMode: {} });
					return;
				}
				this.acpModeLive.delete(dshSessionId);
				if (this.state.acpMode[dshSessionId] === void 0) return;
				const acpMode = { ...this.state.acpMode };
				delete acpMode[dshSessionId];
				this.mutate({ acpMode });
			}
			/**
			* Switch the ACP agent's own mode for one chat session (`session/set_mode`),
			* then re-read the binding so the control reflects what the agent actually
			* reports (a rejected switch must not leave an optimistic lie on screen).
			*/
			async setChatSessionMode(dshSessionId, modeId, agentId) {
				try {
					await this.call("session/chat-mode-set", {
						dshSessionId,
						modeId,
						...agentId === void 0 ? {} : { agentId }
					});
				} catch (error) {
					this.flashError(error);
				}
				await this.loadChatSessions(dshSessionId);
			}
			/**
			* Start (or refresh) observation of every ACP transcript behind one DSH chat
			* session. Blocks are rebuilt from scratch — the host buffer is the record,
			* and this view is the only consumer that needs the raw agent stream.
			*/
			async loadChatTranscript(dshSessionId) {
				let views;
				try {
					({views} = await this.call("session/chat-transcript", { dshSessionId }));
				} catch {
					return;
				}
				const merged = {};
				for (const [id, record] of Object.entries(this.state.chatTranscripts)) if (record.owner !== dshSessionId) merged[id] = record;
				for (const view of views) {
					const blocks = [];
					for (const entry of view.entries) foldUpdate(blocks, entry.update);
					merged[view.session.sessionId] = {
						owner: dshSessionId,
						session: view.session,
						blocks,
						seq: view.entries.length > 0 ? view.entries[view.entries.length - 1]?.seq ?? 0 : 0
					};
				}
				this.mutate({ chatTranscripts: this.evictTranscripts(merged) });
			}
			/** Observed transcript for one ACP session id (undefined → nobody is watching it). */
			transcriptOf(acpSessionId) {
				return this.state.chatTranscripts[acpSessionId];
			}
			/** The observed transcript of one chat session (the live binding wins over a released one). */
			chatTranscriptOf(dshSessionId) {
				const owned = Object.values(this.state.chatTranscripts).filter((record) => record.owner === dshSessionId);
				return owned.find((record) => !record.session.released) ?? owned[0];
			}
			/** Keep the resident transcript map at its bound, newest insertion first. */
			evictTranscripts(map) {
				const ids = Object.keys(map);
				if (ids.length <= MAX_WATCHED) return map;
				const out = {};
				for (const id of ids.slice(ids.length - MAX_WATCHED)) {
					const value = map[id];
					if (value !== void 0) out[id] = value;
				}
				return out;
			}
			/** Re-publish an observed transcript's session snapshot (mode / released flips). */
			watchedSessionPatch(sessionId, session) {
				const current = this.state.chatTranscripts[sessionId];
				if (current === void 0) return {};
				return { chatTranscripts: {
					...this.state.chatTranscripts,
					[sessionId]: {
						...current,
						session
					}
				} };
			}
			/** Mirror the running flag onto a transcript the ACP view is showing. */
			markWatchedRunning(sessionId, running) {
				const current = this.state.chatTranscripts[sessionId];
				if (current === void 0 || current.session.running === running) return;
				this.mutate({ chatTranscripts: {
					...this.state.chatTranscripts,
					[sessionId]: {
						...current,
						session: {
							...current.session,
							running
						}
					}
				} });
			}
			async setConfigOption(configId, value) {
				const sessionId = this.state.activeSessionId;
				if (sessionId === void 0) return;
				try {
					await this.call("session/config-set", {
						sessionId,
						configId,
						value
					});
				} catch (error) {
					this.flashError(error);
				}
			}
			async respondPermission(requestId, optionId) {
				try {
					await this.call("permission/respond", {
						requestId,
						...optionId === void 0 ? {} : { optionId }
					});
				} catch (error) {
					this.flashError(error);
				}
			}
			async stopAgent(agentId) {
				try {
					await this.call("agent/stop", { agentId });
					await this.resync();
				} catch (error) {
					this.flashError(error);
				}
			}
			/**
			* Set the plugin's OWN default ACP agent (the panel's ★ gesture): which agent
			* an ACP-mode conversation starts on. Plugin-private state — the host keeps it
			* in its own agent registry file, and nothing here touches DSH's model
			* selection (see docs/acp-convergence.md §2.2).
			*/
			async setDefaultAgent(agentId) {
				try {
					await this.call("default/agent-set", { ...agentId === void 0 ? {} : { agentId } });
					this.mutate({ defaultAgent: agentId });
				} catch (error) {
					this.flashError(error);
				}
			}
			/**
			* Write the agent tag's halo preference (settings card). The value is
			* validated host-side; this side writes optimistically first so the tag's
			* look changes with the click, and reverts to the host answer on a failure.
			*/
			async setTagHalo(halo) {
				const previous = this.state.tagHalo;
				this.mutate({ tagHalo: halo });
				try {
					await this.call("ui/tag-halo-set", { halo });
				} catch (error) {
					this.mutate({ tagHalo: previous });
					this.flashError(error);
				}
			}
			/**
			* Write one approval deadline (settings card), or drop the persisted override
			* with `reset` so the `cordis.patch.yml` baseline applies again.
			*
			* The host answer — the same route returns the deadlines now in force — is the
			* authority, so an optimistic write that the host trims (out of range, or
			* merged with a value this browser did not know about) self-corrects instead
			* of drifting from what runs.
			*/
			async setApprovalDeadline(key, ms) {
				await this.writeApprovalDeadlines({ [key]: ms });
			}
			/** Drop the persisted override: the config file (or the built-in default) decides again. */
			async resetApprovalDeadlines() {
				await this.writeApprovalDeadlines({ reset: true });
			}
			async writeApprovalDeadlines(payload) {
				const previous = this.state.approvalDeadlines;
				if (previous !== void 0) this.mutate({ approvalDeadlines: {
					...previous,
					...payload.nativeApprovalTimeoutMs === void 0 ? {} : { nativeApprovalTimeoutMs: payload.nativeApprovalTimeoutMs },
					...payload.permissionFallbackTimeoutMs === void 0 ? {} : { permissionFallbackTimeoutMs: payload.permissionFallbackTimeoutMs }
				} });
				try {
					const result = await this.call("ui/approval-deadlines-set", payload);
					this.mutate({ approvalDeadlines: result.deadlines });
				} catch (error) {
					this.mutate({ approvalDeadlines: previous });
					this.flashError(error);
				}
			}
			/**
			* Bind one DSH chat session to an ACP agent. This is the plugin's own
			* conversation↔agent mapping: it does NOT write a DSH model route, so it
			* cannot pollute the deployment default model and cannot be refused by the
			* GUI's catalog gate (the retired `session/model-unavailable` failure).
			*
			* The mapping is host-side and keyed by chat session id; the browser learns
			* the binding back through `session/chat-list`.
			*/
			async bindChatAgent(dshSessionId, agentId) {
				try {
					await this.call("session/chat-bind", {
						dshSessionId,
						agentId
					});
					this.mutate({ chatBoundAgent: {
						...this.state.chatBoundAgent,
						[dshSessionId]: agentId
					} });
				} catch (error) {
					this.flashError(error);
					throw error;
				}
			}
			/** Switch the bound agent's model (`agentId@choice`) for one chat session. */
			async setChatSessionModel(dshSessionId, modelId, agentId) {
				try {
					await this.call("session/chat-model-set", {
						dshSessionId,
						modelId
					});
					this.writeChoice(dshSessionId, (choice) => ({
						...choice,
						modelId
					}), agentId);
				} catch (error) {
					this.flashError(error);
					throw error;
				}
			}
			/** Switch the bound agent's reasoning effort for one chat session. */
			async setChatSessionEffort(dshSessionId, effort, agentId) {
				try {
					await this.call("session/chat-effort-set", {
						dshSessionId,
						...effort === void 0 ? {} : { effort },
						...agentId === void 0 ? {} : { agentId }
					});
					this.writeChoice(dshSessionId, (choice) => {
						const { effort: _dropped, ...rest } = choice;
						return effort === void 0 ? rest : {
							...rest,
							effort
						};
					}, agentId);
				} catch (error) {
					this.flashError(error);
					throw error;
				}
			}
			/** Set one of the bound agent's EXTRA config options for one chat session. */
			async setChatSessionConfig(dshSessionId, configId, value, agentId) {
				try {
					await this.call("session/chat-config-set", {
						dshSessionId,
						configId,
						value,
						...agentId === void 0 ? {} : { agentId }
					});
					this.writeChoice(dshSessionId, (choice) => ({
						...choice,
						extraConfigs: {
							...choice.extraConfigs,
							[configId]: value
						}
					}), agentId);
				} catch (error) {
					this.flashError(error);
					throw error;
				}
			}
			/**
			* Patch one conversation's optimistic pick. The agent half is required by the
			* record (a model or thought level belongs to an agent). Its owner is the
			* route the picker used, else the recorded pick, the optimistic binding, or
			* the plugin default — that last one really serves a never-bound conversation
			* (the guard routes to it), so waiting for `session/chat-list` would leave the
			* chip behind the click. Only a conversation with none of those is left alone.
			*/
			writeChoice(dshSessionId, update, agentId) {
				const current = this.state.chatChoice[dshSessionId];
				const owner = agentId ?? current?.agentId ?? this.state.chatBoundAgent[dshSessionId] ?? this.state.defaultAgent;
				if (owner === void 0) return;
				const next = update({
					...current,
					agentId: owner
				});
				this.mutate({ chatChoice: {
					...this.state.chatChoice,
					[dshSessionId]: {
						...next,
						agentId: owner
					}
				} });
			}
			/**
			* Localize one string. BOUND to the instance in the constructor: the ACP
			* view hands this reference to memoized rows, so it must stay stable across
			* renders or every row re-renders on every store notification.
			*/
			label = (zh, en) => this.locale(zh, en);
			/**
			* Republish the snapshot after a locale switch. Every `label()` resolves
			* against the current language while rendering, so a notification is all
			* that is needed — except the detect summary, which the store owns as an
			* already-resolved string and rebuilds from its counts here.
			*/
			refreshLocale() {
				const counts = this.detectCounts;
				this.mutate({
					localeRev: this.state.localeRev + 1,
					...counts === void 0 ? {} : { detectSummary: this.detectSummaryOf(counts.total, counts.installed) }
				});
			}
			clearNotice() {
				this.mutate({ notice: void 0 });
			}
			flashError(error) {
				this.mutate({ notice: error instanceof Error ? error.message : String(error) });
			}
			applyEvent(event) {
				switch (event.type) {
					case "agent/notice":
						this.mutate({ notice: event.text });
						return Promise.resolve();
					case "agent/status":
						if (event.agent !== void 0) {
							const agents = this.state.agents.some((a) => a.id === event.agent?.id) ? this.state.agents.map((a) => a.id === event.agent?.id ? event.agent : a) : [...this.state.agents, event.agent];
							this.mutate({ agents });
						} else this.mutate({});
						return Promise.resolve();
					case "session/created": {
						const sessions = this.state.sessions.some((s) => s.sessionId === event.sessionId) ? this.state.sessions.map((s) => s.sessionId === event.sessionId ? event.session : s) : [...this.state.sessions, event.session];
						this.mutate({
							sessions,
							activeSessionId: this.state.activeSessionId ?? event.sessionId
						});
						return Promise.resolve();
					}
					case "session/meta": {
						const sessions = this.state.sessions.some((s) => s.sessionId === event.sessionId) ? this.state.sessions.map((s) => s.sessionId === event.sessionId ? event.session : s) : this.state.sessions;
						this.mutate({
							sessions,
							...this.watchedSessionPatch(event.sessionId, event.session)
						});
						return Promise.resolve();
					}
					case "session/closed": {
						const sessions = this.state.sessions.filter((s) => s.sessionId !== event.sessionId);
						const active = this.state.activeSessionId === event.sessionId ? sessions[0]?.sessionId : this.state.activeSessionId;
						this.openTurns.delete(event.sessionId);
						const closedTranscripts = { ...this.state.chatTranscripts };
						delete closedTranscripts[event.sessionId];
						const chatSessions = this.state.chatSessions.filter((s) => s.sessionId !== event.sessionId);
						this.mutate({
							sessions,
							activeSessionId: active,
							chatTranscripts: closedTranscripts,
							...chatSessions.length !== this.state.chatSessions.length ? { chatSessions } : {},
							permissions: this.state.permissions.filter((p) => p.sessionId !== event.sessionId),
							...event.reason === "agent-died" ? { notice: this.locale("会话因 agent 进程退出而终止", "session ended: agent process died") } : {}
						});
						return Promise.resolve();
					}
					case "session/released": {
						const sessions = this.state.sessions.some((s) => s.sessionId === event.sessionId) ? this.state.sessions.map((s) => s.sessionId === event.sessionId ? event.session : s) : [...this.state.sessions, event.session];
						this.openTurns.delete(event.sessionId);
						const chatSessions = this.state.chatSessions.some((s) => s.sessionId === event.sessionId) ? this.state.chatSessions.map((s) => s.sessionId === event.sessionId ? {
							...s,
							released: true
						} : s) : this.state.chatSessions;
						this.mutate({
							sessions,
							...chatSessions !== this.state.chatSessions ? { chatSessions } : {},
							permissions: this.state.permissions.filter((p) => p.sessionId !== event.sessionId),
							...this.watchedSessionPatch(event.sessionId, event.session),
							notice: this.locale("agent 进程已退出，会话已挂起；再次发送消息将自动恢复。", "agent process died; the session is paused and will resume on your next message.")
						});
						return Promise.resolve();
					}
					case "session/reset": {
						this.lastSeq.set(event.sessionId, 0);
						this.openTurns.delete(event.sessionId);
						const isActive = event.sessionId === this.state.activeSessionId;
						const sessions = this.state.sessions.some((s) => s.sessionId === event.sessionId) ? this.state.sessions.map((s) => s.sessionId === event.sessionId ? event.session : s) : [...this.state.sessions, event.session];
						const watched = this.state.chatTranscripts[event.sessionId];
						this.mutate({
							sessions,
							...isActive ? { blocks: [] } : {},
							...watched === void 0 ? {} : { chatTranscripts: {
								...this.state.chatTranscripts,
								[event.sessionId]: {
									...watched,
									session: event.session,
									blocks: [],
									seq: 0
								}
							} }
						});
						return Promise.resolve();
					}
					case "session/update":
						this.pendingUpdates.push({
							sessionId: event.sessionId,
							seq: event.seq,
							update: event.update
						});
						this.armUpdateFlush();
						return Promise.resolve();
					case "catalog/updated":
						this.invalidateSeatCatalog(event.agentId);
						return this.loadAgentCatalog(event.agentId);
					case "agent/exposure": {
						const exposedModels = event.exposedModels.length === 0 ? void 0 : [...event.exposedModels];
						const detectedAgents = this.state.detectedAgents.map((info) => info.id === event.agentId && info.currentConfig !== void 0 ? {
							...info,
							currentConfig: {
								...info.currentConfig,
								exposedModels: exposedModels === void 0 ? void 0 : exposedModels,
								autoDiscoverModels: event.autoDiscoverModels
							}
						} : info);
						this.invalidateSeatCatalog(event.agentId);
						this.mutate({ detectedAgents });
						return this.loadAgentCatalog(event.agentId);
					}
					case "permission/request": {
						const title = typeof event.toolCall?.title === "string" ? String(event.toolCall.title) : this.locale("工具调用", "tool call");
						this.mutate({ permissions: [...this.state.permissions.filter((p) => p.requestId !== event.requestId), {
							requestId: event.requestId,
							sessionId: event.sessionId,
							title,
							options: event.options
						}] });
						return Promise.resolve();
					}
					case "permission/resolved":
						this.mutate({ permissions: this.state.permissions.filter((p) => p.requestId !== event.requestId) });
						return Promise.resolve();
					case "permission/synced": {
						const live = new Set(event.requestIds);
						this.mutate({ permissions: this.state.permissions.filter((p) => live.has(p.requestId)) });
						return Promise.resolve();
					}
					case "chat/agent-locked":
						this.chatUnlocked.delete(event.dshSessionId);
						this.mutate({
							chatLockedAgent: {
								...this.state.chatLockedAgent,
								[event.dshSessionId]: event.agentId
							},
							chatBoundAgent: {
								...this.state.chatBoundAgent,
								[event.dshSessionId]: event.agentId
							},
							agentLockReveal: {
								...this.state.agentLockReveal,
								[event.dshSessionId]: (this.state.agentLockReveal[event.dshSessionId] ?? 0) + 1
							}
						});
						return Promise.resolve();
					case "chat/agent-unlocked": {
						this.chatUnlocked.add(event.dshSessionId);
						const chatLockedAgent = { ...this.state.chatLockedAgent };
						delete chatLockedAgent[event.dshSessionId];
						this.mutate({
							chatLockedAgent,
							...this.state.chatSessionsFor === event.dshSessionId ? { chatSessions: [] } : {}
						});
						return Promise.resolve();
					}
					case "turn/start":
						this.openTurns.add(event.sessionId);
						this.markWatchedRunning(event.sessionId, true);
						if (event.sessionId === this.state.activeSessionId) {
							this.state.blocks.push({
								kind: "user",
								text: event.text
							});
							trimBlocks(this.state.blocks);
							this.mutate({ sessions: this.state.sessions.map((s) => s.sessionId === event.sessionId ? {
								...s,
								running: true
							} : s) });
						}
						return Promise.resolve();
					case "turn/end":
						if (!this.openTurns.has(event.sessionId)) return Promise.resolve();
						this.openTurns.delete(event.sessionId);
						this.markWatchedRunning(event.sessionId, false);
						if (event.sessionId === this.state.activeSessionId) {
							if (event.error !== void 0) this.state.blocks.push({
								kind: "notice",
								tone: "error",
								text: event.error
							});
							else if (event.stopReason !== void 0 && event.stopReason !== "end_turn") this.state.blocks.push({
								kind: "notice",
								tone: "info",
								text: `stop: ${event.stopReason}`
							});
							trimBlocks(this.state.blocks);
							this.mutate({ sessions: this.state.sessions.map((s) => s.sessionId === event.sessionId ? {
								...s,
								running: false
							} : s) });
						}
						return Promise.resolve();
					default: return Promise.resolve();
				}
			}
		};
		/** Merge a raw ACP update into the block list (mutates in place). */
		/**
		* Fold one transcript update into a block list. IMMUTABLE per block: the ACP
		* view memoizes rows on the block object, so an appended chunk replaces the
		* tail block instead of mutating it (array copies stay the caller's job, one
		* per folded batch). Returns whether any block changed — a usage-only tick
		* folds to `false` and the batch skips copying the array.
		*
		* `raw` is a lazy getter: pretty-printing a tool payload costs up to
		* {@link RAW_MAX} characters of JSON per call, and progress ticks restate
		* whole calls at high frequency — the cost is paid once, by the view that
		* actually shows the card, never by the fold loop.
		*/
		function foldUpdate(blocks, update) {
			const kind = String(update.sessionUpdate ?? "");
			const content = update.content;
			switch (kind) {
				case "user_message_chunk":
				case "agent_message_chunk":
				case "agent_thought_chunk": {
					const targetKind = kind === "user_message_chunk" ? "user" : kind === "agent_message_chunk" ? "agent" : "thought";
					const text = chunkText(content);
					if (text === "") return false;
					const messageId = typeof update.messageId === "string" ? update.messageId : void 0;
					const last = blocks[blocks.length - 1];
					if (targetKind === "agent" && last?.kind === "agent" && (messageId !== void 0 && last.messageId === messageId || messageId === void 0 && last.messageId === void 0)) blocks[blocks.length - 1] = {
						...last,
						text: last.text + text
					};
					else if (targetKind !== "agent" && last?.kind === targetKind) blocks[blocks.length - 1] = {
						...last,
						text: last.text + text
					};
					else if (targetKind === "agent") blocks.push({
						kind: "agent",
						...messageId === void 0 ? {} : { messageId },
						text
					});
					else blocks.push({
						kind: targetKind,
						text
					});
					return true;
				}
				case "tool_call": {
					let rawOf;
					blocks.push({
						kind: "tool",
						toolCallId: String(update.toolCallId ?? ""),
						title: String(update.title ?? ""),
						status: String(update.status ?? "pending"),
						...typeof update.kind === "string" ? { toolKind: update.kind } : {},
						...splitToolContent(update.content),
						...toolInputFields(update),
						get raw() {
							return rawOf ??= jsonText(update);
						}
					});
					return true;
				}
				case "tool_call_update": {
					const id = String(update.toolCallId ?? "");
					for (let i = blocks.length - 1; i >= 0; i--) {
						const block = blocks[i];
						if (block?.kind !== "tool" || block.toolCallId !== id) continue;
						const parsed = splitToolContent(update.content);
						const input = toolInputOf(update);
						const details = toolDetailsOf(update);
						let rawOf;
						blocks[i] = {
							kind: "tool",
							toolCallId: id,
							title: typeof update.title === "string" && update.title !== "" ? update.title : block.title,
							status: typeof update.status === "string" ? update.status : block.status,
							...typeof update.kind === "string" ? { toolKind: update.kind } : block.toolKind === void 0 ? {} : { toolKind: block.toolKind },
							lines: parsed.lines.length > 0 ? parsed.lines : block.lines,
							...parsed.diffs === void 0 ? block.diffs === void 0 ? {} : { diffs: block.diffs } : { diffs: parsed.diffs },
							...parsed.extras.length > 0 ? { extras: parsed.extras } : block.extras === void 0 ? {} : { extras: block.extras },
							...input === void 0 ? block.input === void 0 ? {} : { input: block.input } : { input },
							...details.length > 0 ? { details } : block.details === void 0 ? {} : { details: block.details },
							get raw() {
								return rawOf ??= jsonText(update);
							}
						};
						return true;
					}
					let rawOf;
					blocks.push({
						kind: "tool",
						toolCallId: id,
						title: id,
						status: String(update.status ?? "completed"),
						...splitToolContent(update.content),
						...toolInputFields(update),
						get raw() {
							return rawOf ??= jsonText(update);
						}
					});
					return true;
				}
				case "plan": {
					const entries = Array.isArray(update.entries) ? update.entries.map((e) => ({
						content: String(e.content ?? ""),
						status: String(e.status ?? "pending"),
						...typeof e.priority === "string" ? { priority: e.priority } : {}
					})) : [];
					for (let i = blocks.length - 1; i >= 0; i--) {
						const block = blocks[i];
						if (block?.kind !== "plan") continue;
						blocks[i] = {
							...block,
							entries
						};
						return true;
					}
					blocks.push({
						kind: "plan",
						entries
					});
					return true;
				}
				default: {
					if (kind === "" || STATE_ONLY_UPDATES.has(kind)) return false;
					let rawOf;
					blocks.push({
						kind: "event",
						event: kind,
						text: describeEvent(kind, update),
						get raw() {
							return rawOf ??= jsonText(update);
						}
					});
					return true;
				}
			}
		}
		/**
		* The input / detail fields a tool block carries from an update, spread-ready.
		* Kept apart from the content split so `tool_call` and `tool_call_update` share
		* one spelling of "when does a field appear".
		*/
		function toolInputFields(update) {
			const fields = {};
			const input = toolInputOf(update);
			if (input !== void 0) fields.input = input;
			const details = toolDetailsOf(update);
			if (details.length > 0) fields.details = details;
			return fields;
		}
		/** Notifications that update the SessionView snapshot instead of the block stream. */
		const STATE_ONLY_UPDATES = /* @__PURE__ */ new Set([
			"config_option_update",
			"usage_update",
			"session_info_update"
		]);
		function trimBlocks(blocks) {
			if (blocks.length > MAX_BLOCKS) blocks.splice(0, blocks.length - MAX_BLOCKS);
		}
		//#endregion
		//#region src/client/acp-ui.tsx
		/** Split `agentId` / `agentId@choice`; mirrors the host's `splitAdapterModelId`. */
		function splitAcpModelId(model) {
			const at = model.indexOf("@");
			if (at <= 0) return { agentId: model };
			return {
				agentId: model.slice(0, at),
				choice: model.slice(at + 1)
			};
		}
		/**
		* Build `agentId` / `agentId@choice`; mirrors the host's `buildAdapterModelId`.
		*
		* The inverse of {@link splitAcpModelId}, and a hand copy for the same reason:
		* the browser half cannot import the host plane. Needed where the browser has a
		* bare choice value (the agent's own current model, as `agent/catalog` reports
		* it) and must compare it against adapter model ids.
		*/
		function buildAcpModelId(agentId, choice) {
			return choice === void 0 || choice === "" ? agentId : `${agentId}@${choice}`;
		}
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
		function isAbsolutePathLike(p) {
			if (p.startsWith("\\\\?\\") || p.startsWith("//?/")) return false;
			return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
		}
		/**
		* Hand copies of the host's `tokenizeCommandLine` / `splitCommandLine` /
		* `quoteCommandToken` (src/impl.ts). The 命令 field is ONE command line — the
		* whole thing a user would paste into a terminal — and the panel has to parse
		* it exactly the way `validateAgentDef` will, or the "程序 / 参数" preview under
		* the field would lie about what the host is about to run. Same discipline as
		* `splitAcpModelId`: browser half cannot import the host plane, so
		* tests/acp-view.spec.ts asserts equivalence on a shared sample set.
		*/
		function tokenizeCommandLine(raw) {
			const tokens = [];
			let current = "";
			let touched = false;
			let quote;
			for (let index = 0; index < raw.length; index += 1) {
				const char = raw[index];
				if (quote !== void 0) {
					if (char === "\\" && quote === "\"" && raw[index + 1] === "\"") {
						current += "\"";
						index += 1;
						continue;
					}
					if (char === quote) {
						quote = void 0;
						continue;
					}
					current += char;
					continue;
				}
				if (char === "\"" || char === "'") {
					quote = char;
					touched = true;
					continue;
				}
				if (char === " " || char === "	" || char === "\n" || char === "\r") {
					if (touched || current !== "") tokens.push(current);
					current = "";
					touched = false;
					continue;
				}
				current += char;
				touched = true;
			}
			if (touched || current !== "") tokens.push(current);
			return tokens;
		}
		/** First token = program, rest = arguments. Mirrors the host's `splitCommandLine`. */
		function splitCommandLine(raw) {
			const tokens = tokenizeCommandLine(raw);
			return {
				command: tokens[0] ?? "",
				args: tokens.slice(1)
			};
		}
		/** Quote one token for a command line — only when it needs it. */
		function quoteCommandToken(token) {
			if (token !== "" && !/[\s"']/.test(token)) return token;
			return `"${token.replaceAll("\"", "\\\"")}"`;
		}
		/** Join a parsed command back into the single editable field (round-trips through `splitCommandLine`). */
		function formatCommandLine(command, args = []) {
			return [command, ...args].map(quoteCommandToken).join(" ");
		}
		/** Subscribe to the ACP store (the panel and every chat surface share this). */
		function useUi$2(acp) {
			return (0, react.useSyncExternalStore)((cb) => acp.subscribe(cb), () => acp.getSnapshot());
		}
		/**
		* The preset the row records, under either runtime spelling. `undefined` means
		* the row is silent (projections not loaded yet, or a runtime without presets)
		* — never "definitely not ACP".
		*/
		function rowAgentPreset(row) {
			return row?.agentPreset ?? row?.projectionValues?.agentPreset;
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
		function stagedSessionOf(snapshot) {
			if (snapshot === void 0) return void 0;
			if (snapshot.current !== void 0) return {
				sessionId: snapshot.current,
				row: snapshot.byId?.[snapshot.current],
				subagent: snapshot.currentAddress !== void 0
			};
			const byId = snapshot.byId ?? {};
			const order = /* @__PURE__ */ new Map();
			for (const [index, id] of (snapshot.ids ?? []).entries()) order.set(id, index);
			const rank = (id) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
			const sessionId = Object.keys(byId).sort((a, b) => rank(a) - rank(b)).find((id) => (byId[id]?.retainedBy?.mainView ?? 0) > 0);
			if (sessionId === void 0) return void 0;
			const row = byId[sessionId];
			return {
				sessionId,
				row,
				subagent: row?.origin === "subagent"
			};
		}
		/** Whether the staged session runs the ACP agent preset. */
		function stagedIsAcpMode(snapshot, acpMode) {
			const staged = stagedSessionOf(snapshot);
			if (staged === void 0 || staged.subagent) return false;
			const listed = rowAgentPreset(staged.row);
			if (listed !== void 0) return listed === "acp";
			return acpMode?.(staged.sessionId) === true;
		}
		/**
		* The ACP-mode verdict a committed `agent-preset/selected` frame carries. The
		* frame is `[sessionId, agentPreset]` and the runtime broadcasts it the moment
		* a switch commits — before the appended session-log row is visible to a fresh
		* `session/chat-list` cold read, so re-reading the log from that frame folds the
		* PREVIOUS preset and the surface would lag one switch behind until a reload.
		* The frame's own preset is therefore the live path's fact source; the host read
		* only seeds a session this tab has never seen a frame for.
		*/
		function acpModeFromPresetEvent(agentPreset) {
			return agentPreset === "acp";
		}
		let menuState = null;
		const menuListeners = /* @__PURE__ */ new Set();
		function emitMenu() {
			for (const listener of [...menuListeners]) listener();
		}
		/** Toggle-style open: pressing the same chip twice closes its menu. */
		function openAcpMenu(sessionId, kind, trigger) {
			menuState = menuState !== null && menuState.sessionId === sessionId && menuState.kind === kind ? null : {
				sessionId,
				kind,
				...trigger === void 0 ? {} : { trigger }
			};
			emitMenu();
		}
		/** Close whatever picker is open (Escape, pick, outside pointer). */
		function closeAcpMenu() {
			if (menuState === null) return;
			menuState = null;
			emitMenu();
		}
		/**
		* Report a pick failure inside the open picker. The menu stays open on
		* purpose: a failed switch must not leave the user staring at a closed chip
		* with no idea whether it took effect.
		*/
		function setAcpMenuError(error) {
			if (menuState === null) return;
			menuState = {
				...menuState,
				...error === void 0 ? { error: void 0 } : { error }
			};
			emitMenu();
		}
		/** Subscribe to the open-picker state (both the chips and the overlay read it). */
		function useAcpMenu() {
			return (0, react.useSyncExternalStore)((cb) => {
				menuListeners.add(cb);
				return () => {
					menuListeners.delete(cb);
				};
			}, () => menuState);
		}
		/**
		* Open state of the frame-wide NTR settings dialog (`settings-dialog.tsx`).
		*
		* Module-level because the two ends live in unrelated slot trees: the trigger
		* is the composer's agent base (a session-scoped model-seat entry) and the
		* dialog itself rides the root `shell.overlay` layer. A React context cannot
		* span that boundary, so this is the same tiny external-store seam the menu
		* uses above.
		*/
		let settingsDialogOpen = false;
		const settingsDialogListeners = /* @__PURE__ */ new Set();
		function emitSettingsDialog() {
			for (const listener of [...settingsDialogListeners]) listener();
		}
		/** Open the NTR settings dialog (the empty agent roster's way forward). */
		function openAcpSettingsDialog() {
			if (settingsDialogOpen) return;
			settingsDialogOpen = true;
			emitSettingsDialog();
		}
		/** Close the NTR settings dialog (close button, mask click, Escape). */
		function closeAcpSettingsDialog() {
			if (!settingsDialogOpen) return;
			settingsDialogOpen = false;
			emitSettingsDialog();
		}
		/** Current dialog state, for tests and non-React readers. */
		function acpSettingsDialogIsOpen() {
			return settingsDialogOpen;
		}
		/** Subscribe to the dialog state (the root overlay entry reads it). */
		function useAcpSettingsDialogOpen() {
			return (0, react.useSyncExternalStore)((cb) => {
				settingsDialogListeners.add(cb);
				return () => {
					settingsDialogListeners.delete(cb);
				};
			}, acpSettingsDialogIsOpen);
		}
		/**
		* Pure popup placement, viewport coordinates: the menu docks with its right
		* edge under the trigger's, `gap`px above it — and only then clamps to the
		* viewport (flip below when the top has no room, slide left at the right edge).
		* Separated from the DOM measurement so the geometry stays testable.
		*/
		function placeMenu(trigger, menu, viewport, gap = 8) {
			const x = Math.min(Math.max(gap, trigger.right - menu.width), Math.max(gap, viewport.width - menu.width - gap));
			const above = trigger.top - menu.height - gap;
			let y = above >= gap ? above : trigger.bottom + gap;
			if (y + menu.height > viewport.height - gap) y = Math.max(gap, viewport.height - menu.height - gap);
			return {
				x,
				y
			};
		}
		/**
		* The picker shell. It rides the composer's overlay anchor (the card's top
		* edge) — the seat the platform reserves for menus, so the popup is never
		* clipped by the card's own scrollport — and then docks itself to the control
		* that opened it (`anchor`): the seat or a chip is a dropdown trigger, and a
		* menu that materializes elsewhere on the card reads as "nothing happened".
		*/
		function AcpMenu({ model, anchor, onPick, onClose }) {
			const rootRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				const node = rootRef.current;
				if (node === null || model === void 0) return;
				const place = () => {
					try {
						if (anchor === void 0 || anchor === null || !anchor.isConnected) {
							node.style.transform = "";
							return;
						}
						const menuRect = node.getBoundingClientRect();
						const { x, y } = placeMenu(anchor.getBoundingClientRect(), menuRect, {
							width: window.innerWidth,
							height: window.innerHeight
						});
						node.style.transform = "none";
						const base = node.getBoundingClientRect();
						node.style.transform = `translate(${x - base.left}px, ${y - base.top}px)`;
					} catch {}
				};
				place();
				window.addEventListener("resize", place);
				return () => {
					window.removeEventListener("resize", place);
				};
			}, [model, anchor]);
			(0, react.useEffect)(() => {
				if (model === void 0) return;
				const onKey = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onClose();
					}
				};
				const onPointerDown = (event) => {
					if (!(event.target instanceof Node)) return;
					if (rootRef.current?.contains(event.target)) return;
					if (rootRef.current?.closest("[data-composer-card]")?.contains(event.target) === true) return;
					onClose();
				};
				document.addEventListener("keydown", onKey, true);
				document.addEventListener("pointerdown", onPointerDown, true);
				return () => {
					document.removeEventListener("keydown", onKey, true);
					document.removeEventListener("pointerdown", onPointerDown, true);
				};
			}, [model, onClose]);
			if (model === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: "ntr-acp-menu",
				role: "menu",
				"aria-label": model.title,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-menu-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-menu-title",
							children: model.title
						}), model.loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-menu-spin",
							"aria-hidden": true,
							children: "…"
						})]
					}),
					model.note !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-menu-note",
						children: model.note
					}),
					model.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-menu-error",
						children: model.error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-menu-body",
						children: [model.sections.map((section) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "ntr-acp-menu-section",
							children: [
								section.title !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ntr-acp-menu-section-title",
									children: section.title
								}),
								section.note !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "ntr-acp-menu-note",
									children: section.note
								}),
								section.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: item.checkbox === true ? "menuitemcheckbox" : "menuitemradio",
									"aria-checked": item.active === true,
									className: `ntr-acp-menu-item${item.active === true ? " is-active" : ""}`,
									disabled: item.disabled === true,
									onClick: () => {
										onPick(item.id, section.id);
									},
									children: [
										item.dot !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ntr-acp-dot",
											style: { background: item.dot },
											"aria-hidden": true
										}),
										item.checkbox === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `ntr-acp-check${item.active === true ? " is-on" : ""}`,
											"aria-hidden": true,
											children: item.active === true ? "✓" : ""
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ntr-acp-menu-item-label",
											children: item.label
										}),
										item.active === true && item.checkbox !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ntr-acp-tick",
											"aria-hidden": true,
											children: "✓"
										}),
										item.detail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "ntr-acp-menu-item-detail",
											children: item.detail
										})
									]
								}, `${section.id}/${item.id}`))
							]
						}, section.id)), model.sections.every((section) => section.items.length === 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "ntr-acp-menu-empty",
							children: "—"
						})]
					})
				]
			});
		}
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
		function AcpChip(props) {
			const onClick = props.onClick;
			const className = `ntr-acp-chip${onClick === void 0 ? " is-static" : ""}${props.active === true ? " is-active" : ""}${props.className === void 0 ? "" : ` ${props.className}`}`;
			if (onClick === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className,
				title: props.title,
				style: props.style,
				children: [props.children, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "ntr-acp-chip-label",
					children: props.label
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className,
				title: props.title,
				"aria-haspopup": "menu",
				onClick: (event) => {
					onClick(event.currentTarget);
				},
				style: props.style,
				children: [props.children, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "ntr-acp-chip-label",
					children: props.label
				})]
			});
		}
		const ACP_SHARDS = [
			{
				x: 8,
				y: 30,
				width: 5,
				height: 7,
				dx: -42,
				dy: -22,
				inX: 150,
				inY: -18,
				rotate: -120,
				scale: .35,
				delay: 0
			},
			{
				x: 18,
				y: 55,
				width: 4,
				height: 5,
				dx: -28,
				dy: 24,
				inX: 118,
				inY: 24,
				rotate: 90,
				scale: .55,
				delay: 20
			},
			{
				x: 28,
				y: 20,
				width: 6,
				height: 4,
				dx: -20,
				dy: -30,
				inX: 196,
				inY: -10,
				rotate: -45,
				scale: .45,
				delay: 10
			},
			{
				x: 38,
				y: 65,
				width: 5,
				height: 6,
				dx: -14,
				dy: 28,
				inX: 132,
				inY: 30,
				rotate: 140,
				scale: .4,
				delay: 30
			},
			{
				x: 48,
				y: 35,
				width: 4,
				height: 8,
				dx: -36,
				dy: -26,
				inX: 210,
				inY: -4,
				rotate: 75,
				scale: .5,
				delay: 0
			},
			{
				x: 56,
				y: 60,
				width: 6,
				height: 5,
				dx: -24,
				dy: 24,
				inX: 164,
				inY: 20,
				rotate: -90,
				scale: .55,
				delay: 25
			},
			{
				x: 66,
				y: 25,
				width: 4,
				height: 4,
				dx: -30,
				dy: -20,
				inX: 128,
				inY: -24,
				rotate: 120,
				scale: .4,
				delay: 5
			},
			{
				x: 74,
				y: 58,
				width: 5,
				height: 7,
				dx: -18,
				dy: 20,
				inX: 182,
				inY: 14,
				rotate: -140,
				scale: .5,
				delay: 15
			},
			{
				x: 84,
				y: 32,
				width: 4,
				height: 5,
				dx: -10,
				dy: -14,
				inX: 112,
				inY: -32,
				rotate: 60,
				scale: .4,
				delay: 20
			},
			{
				x: 13,
				y: 45,
				width: 3,
				height: 4,
				dx: -34,
				dy: 6,
				inX: 206,
				inY: 8,
				rotate: 180,
				scale: .3,
				delay: 35
			},
			{
				x: 43,
				y: 48,
				width: 3,
				height: 3,
				dx: -26,
				dy: 16,
				inX: 176,
				inY: 4,
				rotate: -60,
				scale: .3,
				delay: 40
			},
			{
				x: 88,
				y: 50,
				width: 3,
				height: 4,
				dx: -8,
				dy: 8,
				inX: 142,
				inY: 26,
				rotate: 160,
				scale: .3,
				delay: 35
			}
		];
		function AcpShatterParts(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `ntr-acp-shards is-${props.mode}`,
				"aria-hidden": true,
				children: ACP_SHARDS.map((shard, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "ntr-acp-shard",
					style: {
						left: `${shard.x}%`,
						top: `${shard.y}%`,
						width: shard.width,
						height: shard.height,
						animationDelay: `${shard.delay}ms`,
						"--ntr-shard-dx": `${shard.dx}px`,
						"--ntr-shard-dy": `${shard.dy}px`,
						"--ntr-shard-in-x": `${shard.inX}px`,
						"--ntr-shard-in-y": `${shard.inY}px`,
						"--ntr-shard-rotate": `${shard.rotate}deg`,
						"--ntr-shard-scale": shard.scale
					}
				}, index))
			});
		}
		const STYLE$1 = `
.ntr-acp-cluster { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; flex-wrap: nowrap; }
/* The last chip is the cluster's fixed right-hand anchor: it never shrinks
   below its label, while the chips to its left absorb the squeeze. Before the
   lock that is the agent base; after it retires, the model / thought pair
   inherits the edge. Without this a long model name could compress the agent
   base into invisibility — the "selector disappeared" symptom. */
.ntr-acp-cluster > .ntr-acp-chip:last-child { flex: none; }
/* The agent tag after the base retires. It rides the composer card's top edge:
   the overlay anchor is a zero-height absolute box at that edge, so translateY
   (-50%) puts half the tag above the card and half inside it — a nameplate
   hanging on the box. Above the menu's siblings but below the picker (z 100). */
.ntr-acp-tag { position: absolute; top: 0; left: 24px; z-index: 90; transform: translateY(-50%); display: inline-flex; max-width: calc(100% - 48px); }
.ntr-acp-tag > .ntr-acp-chip { font-size: 11px; line-height: 1.35; padding: 1px 8px; background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff)); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12); }
.ntr-acp-tag > .ntr-acp-chip.is-static:hover { background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff)); }
.ntr-acp-chip { position: relative; display: inline-flex; align-items: center; gap: 5px; max-width: 220px; font: inherit; font-size: 12px; line-height: 1.4; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: inherit; cursor: pointer; }
.ntr-acp-chip:hover { background: var(--dsw-alias-interactive-bg-active, #0000000d); }
.ntr-acp-chip.is-static { cursor: default; }
.ntr-acp-chip.is-static:hover { background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.ntr-acp-chip.is-active { border-color: var(--dsw-alias-state-business-primary, #2563eb); color: var(--dsw-alias-state-business-primary, #2563eb); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 10%, transparent); }
.ntr-acp-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The lock hand-off (src/client/agent-lock-anim.ts): the outgoing agent base
   breaks into debris for 460ms, then the edge tag condenses from the same
   particles. Both halves read one shared clock in that module; these durations
   must stay equal to SHATTER_MS / FORM_MS there. */
.ntr-acp-shards { position: absolute; inset: 0; display: block; pointer-events: none; overflow: visible; }
.ntr-acp-shard { position: absolute; border-radius: 1px; background: currentColor; opacity: 0; }
.ntr-acp-shards.is-out .ntr-acp-shard { animation: ntr-acp-shard-out 460ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.ntr-acp-shards.is-in .ntr-acp-shard { animation: ntr-acp-shard-in 540ms cubic-bezier(0.16, 0.84, 0.28, 1) both; }
.ntr-acp-chip.ntr-acp-shatter { animation: ntr-acp-shatter-chip 460ms cubic-bezier(0.4, 0, 0.8, 0.4) both; pointer-events: none; }
.ntr-acp-tag.is-forming > .ntr-acp-chip { animation: ntr-acp-form-chip 540ms cubic-bezier(0.16, 0.84, 0.28, 1) both; }
/* A live agent's nameplate breathes: a soft blue halo pulses while the ACP
   session serving this conversation is up and not released (agentTagAlive in
   session-controls.tsx). The period comes from the settings card through the
   --ntr-halo-period variable on the tag span; the base shadow from the plain
   tag chip rides inside every keyframe so elevation never flickers. */
.ntr-acp-tag.is-alive > .ntr-acp-chip {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 40%, transparent);
  animation: ntr-acp-tag-breath var(--ntr-halo-period, 3.2s) ease-in-out infinite;
}
/* Steady mode: the same halo, constant. Same rule as reduced-motion below. */
.ntr-acp-tag.is-alive.is-steady > .ntr-acp-chip {
  animation: none;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12), 0 0 6px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 35%, transparent), 0 0 14px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 20%, transparent);
}
@keyframes ntr-acp-tag-breath {
  0%, 100% { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12), 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 18%, transparent); }
  50% { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12), 0 0 9px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 50%, transparent), 0 0 18px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 28%, transparent); }
}
@keyframes ntr-acp-shatter-chip {
  0% { opacity: 1; transform: none; filter: blur(0); }
  22% { opacity: 1; transform: scale(1.05); filter: blur(0); }
  55% { opacity: 0.55; filter: blur(1.5px); }
  100% { opacity: 0; transform: scale(0.84); filter: blur(4px); }
}
@keyframes ntr-acp-form-chip {
  0% { opacity: 0; transform: scale(0.55) translateY(2px); filter: blur(6px); }
  60% { opacity: 1; filter: blur(0); }
  100% { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes ntr-acp-shard-out {
  0% { opacity: 0; transform: translate(0, 0) scale(1) rotate(0deg); }
  18% { opacity: 0.95; }
  100% { opacity: 0; transform: translate(var(--ntr-shard-dx), var(--ntr-shard-dy)) scale(var(--ntr-shard-scale)) rotate(var(--ntr-shard-rotate)); }
}
@keyframes ntr-acp-shard-in {
  0% { opacity: 0; transform: translate(var(--ntr-shard-in-x), var(--ntr-shard-in-y)) scale(var(--ntr-shard-scale)) rotate(var(--ntr-shard-rotate)); }
  22% { opacity: 0.9; }
  70% { opacity: 0.5; }
  100% { opacity: 0; transform: translate(0, 0) scale(0.35) rotate(0deg); }
}
@media (prefers-reduced-motion: reduce) {
  .ntr-acp-shards { display: none; }
  .ntr-acp-chip.ntr-acp-shatter, .ntr-acp-tag.is-forming > .ntr-acp-chip { animation: none; }
  /* No pulsing, but the alive state stays visible as a static halo. */
  .ntr-acp-tag.is-alive > .ntr-acp-chip {
    animation: none;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12), 0 0 6px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 35%, transparent);
  }}
.ntr-acp-seat { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; font: inherit; font-size: 12px; line-height: 1.4; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: inherit; cursor: pointer; }
.ntr-acp-seat:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, #0000000d); }
.ntr-acp-seat:disabled { opacity: 0.5; cursor: default; }
.ntr-acp-seat.is-open { border-color: var(--dsw-alias-state-business-primary, #2563eb); color: var(--dsw-alias-state-business-primary, #2563eb); }
.ntr-acp-seat.is-detached { border-color: var(--ntr-warn, #d97706); color: var(--ntr-warn, #d97706); }
.ntr-acp-seat-main { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntr-acp-seat-sub { color: var(--dsw-alias-text-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntr-acp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.ntr-acp-tick { margin-left: auto; color: var(--dsw-alias-state-business-primary, #2563eb); }
.ntr-acp-check { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 13px; height: 13px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: 3px; font-size: 10px; line-height: 1; color: var(--dsw-alias-state-business-primary, #2563eb); }
.ntr-acp-check.is-on { border-color: var(--dsw-alias-state-business-primary, #2563eb); }
.ntr-acp-menu { position: absolute; bottom: calc(100% + 8px); left: 8px; z-index: 100; width: min(360px, 100%); max-height: min(420px, 60vh); display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16); font-size: 12px; overflow: hidden; }
.ntr-acp-menu-head { padding: 8px 10px 6px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.ntr-acp-menu-title { flex: 1; }
.ntr-acp-menu-spin { opacity: 0.5; }
.ntr-acp-menu-note { padding: 0 10px 6px; font-size: 11px; color: var(--dsw-alias-text-secondary, #6b7280); line-height: 1.5; }
.ntr-acp-menu-error { margin: 0 10px 6px; padding: 6px 8px; border-radius: 6px; background: #fee2e2; color: #b91c1c; font-size: 11px; }
.ntr-acp-menu-body { overflow: auto; padding: 0 4px 6px; }
.ntr-acp-menu-section { display: flex; flex-direction: column; padding-top: 4px; }
.ntr-acp-menu-section-title { padding: 6px 8px 4px; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-menu-item { display: flex; align-items: center; gap: 6px; font: inherit; font-size: 12px; text-align: left; padding: 6px 8px; border: none; border-radius: 6px; background: none; color: inherit; cursor: pointer; width: 100%; }
.ntr-acp-menu-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, #0000000d); }
.ntr-acp-menu-item:disabled { opacity: 0.45; cursor: default; }
.ntr-acp-menu-item.is-active { font-weight: 600; }
.ntr-acp-menu-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntr-acp-menu-item-detail { color: var(--dsw-alias-text-secondary, #6b7280); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: right; }
.ntr-acp-menu-empty { padding: 10px; text-align: center; color: var(--dsw-alias-text-secondary, #6b7280); }
/* ---- ACP view tab ---- */
.ntr-acp-view { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; line-height: 1.6; }
.ntr-acp-view-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); font-size: 12px; color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-view-agent { font-weight: 600; color: inherit; }
.ntr-acp-view-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; direction: rtl; text-align: left; }
.ntr-acp-view-head .ntr-acp-more { margin-left: auto; }
.ntr-acp-stream { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 24px; display: flex; flex-direction: column; gap: 10px; }
.ntr-acp-badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid transparent; }
.ntr-acp-badge.is-done { color: #15803d; background: #dcfce7; }
.ntr-acp-badge.is-busy { color: #1d4ed8; background: #dbeafe; }
.ntr-acp-badge.is-warn { color: #b45309; background: #fef3c7; }
.ntr-acp-badge.is-fail { color: #b91c1c; background: #fee2e2; }
.ntr-acp-badge.is-idle { color: var(--dsw-alias-text-secondary, #6b7280); background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.ntr-acp-bubble { max-width: 88%; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
.ntr-acp-bubble.is-user { align-self: flex-end; background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 12%, transparent); }
.ntr-acp-bubble.is-agent { align-self: flex-start; background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.ntr-acp-inline-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, currentColor 10%, transparent); }
.ntr-acp-code { margin: 6px 0; padding: 8px 10px; border-radius: 8px; background: #0f172a; color: #e2e8f0; overflow: auto; font-size: 12px; line-height: 1.5; }
.ntr-acp-thought { border-left: 3px solid var(--dsw-alias-border-l2, #d1d5db); padding-left: 8px; color: var(--dsw-alias-text-secondary, #6b7280); font-size: 12px; }
.ntr-acp-thought > summary { cursor: pointer; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
.ntr-acp-thought-body { white-space: pre-wrap; padding: 4px 0 2px; }
.ntr-acp-tool { border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.ntr-acp-tool.is-fail { border-color: #fca5a5; }
.ntr-acp-tool-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12px; }
.ntr-acp-tool-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntr-acp-tool-body { margin: 0; padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #f9fafb); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; max-height: 340px; overflow: auto; }
.ntr-acp-tool-input { background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-text-primary, #111827); max-height: 240px; }
.ntr-acp-tool-meta { font-size: 11px; color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-diff { border-top: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
.ntr-acp-diff-head { display: flex; align-items: center; gap: 8px; padding: 5px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; background: var(--dsw-alias-bg-layer-2, #f9fafb); }
.ntr-acp-diff-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ntr-acp-diff-stats .is-add { color: #15803d; }
.ntr-acp-diff-stats .is-del { color: #b91c1c; }
.ntr-acp-diff-body { max-height: 360px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.55; }
.ntr-acp-diff-row { display: flex; gap: 8px; padding: 0 10px; white-space: pre; }
.ntr-acp-diff-row.is-add { background: #dcfce7; }
.ntr-acp-diff-row.is-del { background: #fee2e2; }
.ntr-acp-diff-row.is-ctx { color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-diff-sign { width: 1ch; flex: none; opacity: 0.7; }
.ntr-acp-diff-text { overflow-x: auto; }
.ntr-acp-diff-note { padding: 4px 10px 6px; font-size: 11px; color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-more { font: inherit; font-size: 11.5px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: inherit; cursor: pointer; }
.ntr-acp-more:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, #0000000d); }
.ntr-acp-more:disabled { opacity: 0.5; cursor: default; }
.ntr-acp-more.is-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill, #2563eb); color: var(--dsw-alias-button-primary-invert, #fff); }
.ntr-acp-tool > .ntr-acp-more, .ntr-acp-empty-actions .ntr-acp-more { margin: 6px 10px; }
.ntr-acp-plan { border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1, #fff); }
.ntr-acp-plan-head { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-text-secondary, #6b7280); margin-bottom: 4px; }
.ntr-acp-plan-row { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; padding: 1px 0; }
.ntr-acp-plan-row.is-completed { color: var(--dsw-alias-text-secondary, #6b7280); text-decoration: line-through; }
.ntr-acp-plan-row.is-in_progress { font-weight: 600; }
.ntr-acp-plan-glyph { width: 1ch; flex: none; }
.ntr-acp-plan-prio { margin-left: auto; font-size: 10px; text-transform: uppercase; color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-notice { padding: 6px 10px; border-radius: 8px; font-size: 12px; }
.ntr-acp-notice.is-error { background: #fee2e2; color: #b91c1c; }
.ntr-acp-notice.is-info { background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: var(--dsw-alias-text-secondary, #6b7280); }
.ntr-acp-empty { margin: auto; max-width: 460px; text-align: center; display: flex; flex-direction: column; gap: 10px; padding: 24px; }
.ntr-acp-empty-title { font-size: 14px; font-weight: 600; }
.ntr-acp-empty-body { margin: 0; color: var(--dsw-alias-text-secondary, #6b7280); font-size: 12.5px; line-height: 1.7; }
.ntr-acp-empty-hint { color: var(--dsw-alias-text-secondary, #6b7280); font-size: 12px; }
.ntr-acp-seat-diag { font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); opacity: 0.72; word-break: break-word; }
.ntr-acp-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
/* ---- NTR settings dialog (shell.overlay) ---- */
/* Frame-wide surface opened from the agent base's empty-roster menu. The
   overlay layer itself is click-through, so the layer opts back in and blocks
   the app while it is up. */
.ntr-acp-dialog-layer { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.ntr-acp-dialog-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.4)); }
.ntr-acp-dialog {
  position: relative; display: flex; flex-direction: column; overflow: hidden;
  width: min(920px, calc(100vw - 48px)); height: min(820px, calc(100vh - 48px));
  background: var(--dsw-alias-bg-layer-2, #fff); color: inherit;
  border-radius: 24px; box-shadow: var(--dsw-elevation-prominent, 0 24px 60px rgba(0, 0, 0, 0.25));
}
.ntr-acp-dialog-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 16px 16px 8px 24px; }
.ntr-acp-dialog-title { flex: 1; font-size: 16px; font-weight: 600; }
.ntr-acp-dialog-close { font: inherit; font-size: 14px; line-height: 1; width: 30px; height: 30px; padding: 0; border: none; border-radius: 999px; background: none; color: inherit; cursor: pointer; }
.ntr-acp-dialog-close:hover { background: var(--dsw-alias-interactive-bg-active, #0000000d); }
.ntr-acp-dialog-body { flex: 1; min-height: 0; overflow: auto; }
/* The section brings its own page scroll for the settings shell's content
   column; the dialog body is the scroll owner here. */
.ntr-acp-dialog-body > .dwa-root { max-width: none; overflow: visible; }
`;
		let styleMounted$1 = false;
		/** Mount the shared stylesheet once (same pattern as the settings panel's). */
		function ensureAcpStyle() {
			if (styleMounted$1 || typeof document === "undefined") return;
			styleMounted$1 = true;
			const node = document.createElement("style");
			node.textContent = STYLE$1;
			document.head.appendChild(node);
		}
		//#endregion
		//#region src/client/panel.tsx
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
		/**
		* Mirrors `AGENT_ID_PATTERN` in impl.ts — the client cannot import host-side
		* modules, so this copy must stay in sync (same deal as the preset copies,
		* constraint 7).
		*/
		const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
		/** Preset ids (drives the「自定义」badge); mirrors AGENT_PRESETS via store copies. */
		const PRESET_IDS = new Set(DEFAULT_KNOWN_PRESETS.map((preset) => preset.id));
		/** Seed for the from-scratch creation card: no preset, no tested default. */
		const NEW_AGENT_SEED = {
			id: "",
			name: "",
			detected: false,
			defaultCommand: "",
			defaultArgs: []
		};
		/** How long a chip edit is coalesced before the lightweight exposure RPC fires. */
		const EXPOSURE_SAVE_DEBOUNCE_MS = 400;
		const STYLE = `
.dwa-root {
  --ntr-gap-1: 4px; --ntr-gap-2: 8px; --ntr-gap-3: 12px; --ntr-gap-4: 16px;
  --ntr-radius: 10px; --ntr-radius-sm: 7px;
  --ntr-font: 13px; --ntr-font-sm: 12px; --ntr-font-xs: 11px;
  --ntr-line: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
  --ntr-muted: var(--dsw-alias-text-secondary, #6b7280);
  --ntr-danger: #dc2626; --ntr-warn: #b45309;
  --ntr-accent: var(--dsw-alias-button-primary-fill, #2563eb);
  width: 100%; max-width: 960px; box-sizing: border-box; margin: 0 auto;
  padding: 20px; overflow: auto; font-size: var(--ntr-font); line-height: 1.55;
}
.dwa-root button, .dwa-root input, .dwa-root select { font-family: inherit; }
.dwa-root button:focus-visible, .dwa-root input:focus-visible, .dwa-root select:focus-visible {
  outline: 2px solid var(--ntr-accent); outline-offset: 2px;
}
.dwa-page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.dwa-page-heading { min-width: 0; }
.dwa-page-title { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 650; letter-spacing: -0.02em; }
.dwa-page-description { margin: 5px 0 0; color: var(--ntr-muted); font-size: var(--ntr-font-sm); }
.dwa-page-status { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-page-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dwa-btn {
  min-height: 32px; box-sizing: border-box; font: inherit; border-radius: var(--ntr-radius-sm);
  border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-1, #fff);
  padding: 5px 12px; cursor: pointer; color: inherit; font-size: var(--ntr-font-sm);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  white-space: nowrap; transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.dwa-btn:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); border-color: var(--dsw-alias-border-l1, #9ca3af); }
.dwa-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dwa-btn-primary { background: var(--ntr-accent); color: var(--dsw-alias-button-primary-invert, #fff); border-color: transparent; font-weight: 550; }
.dwa-btn-primary:hover { background: var(--ntr-accent); border-color: transparent; opacity: 0.88; }
.dwa-btn-secondary { background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.dwa-btn-danger { color: var(--ntr-danger); border-color: #fca5a5; }
.dwa-btn-danger:hover { background: #fee2e2; }
.dwa-section { margin-bottom: 24px; }
.dwa-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.dwa-section-title { font-size: 14px; font-weight: 650; margin: 0; display: flex; align-items: center; gap: 8px; }
.dwa-section-copy { margin: 3px 0 0; font-size: var(--ntr-font-xs); color: var(--ntr-muted); }
.dwa-card { border: var(--ntr-line); border-radius: var(--ntr-radius); padding: 16px; background: var(--dsw-alias-bg-layer-1, #fff); font-size: var(--ntr-font); line-height: 1.55; }
.dwa-card-warn { border-left: 3px solid var(--dsw-alias-state-warn-primary, #d97706); background: var(--dsw-alias-state-warn-secondary, #fffbeb); }
.dwa-mode-banner { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 16px; align-items: start; margin-bottom: 24px; padding: 14px 16px; }
.dwa-mode-title { display: flex; align-items: center; gap: 8px; font-weight: 650; }
.dwa-mode-copy { grid-column: 1 / -1; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-mode-source { display: block; margin-top: 5px; overflow-wrap: anywhere; opacity: 0.85; }
.dwa-badge { font-size: var(--ntr-font-xs); line-height: 1.4; border-radius: 999px; padding: 2px 8px; background: var(--dsw-alias-bg-layer-2, #f3f4f6); color: var(--ntr-muted); font-weight: 550; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dwa-badge-success { background: #22c55e1c; color: #15803d; }
.dwa-badge-warn { background: #f59e0b1f; color: #b45309; }
.dwa-badge-info { background: #3b82f61a; color: #2563eb; }
.dwa-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dwa-agent-list { display: flex; flex-direction: column; gap: 8px; }
.dwa-agent-card { border: var(--ntr-line); border-radius: var(--ntr-radius); background: var(--dsw-alias-bg-layer-1, #fff); overflow: visible; transition: border-color 0.15s ease; }
.dwa-agent-card.is-open { border-color: var(--dsw-alias-border-l1, #c7ccd1); }
.dwa-agent-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px 14px; }
.dwa-caret { font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; width: 1em; }
.dwa-caret-btn { font: inherit; border: none; background: var(--dsw-alias-bg-layer-2, #f3f4f6); width: 28px; height: 28px; padding: 0; border-radius: var(--ntr-radius-sm); display: inline-flex; align-items: center; justify-content: center; color: var(--ntr-muted); cursor: pointer; }
.dwa-caret-btn:hover { background: var(--dsw-alias-interactive-bg-active, #e5e7eb); color: inherit; }
.dwa-agent-summary { min-width: 0; }
.dwa-agent-titleline { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dwa-agent-name { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.dwa-agent-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-agent-meta-separator { opacity: 0.45; }
.dwa-agent-body { border-top: var(--ntr-line); padding: 0 16px 16px; }
.dwa-subsection { padding-top: 16px; }
.dwa-subsection + .dwa-subsection { margin-top: 16px; border-top: var(--ntr-line); }
.dwa-subsection-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dwa-subsection-title { margin: 0; font-size: 13px; font-weight: 650; }
.dwa-subsection-copy { margin: 3px 0 0; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-form-row { display: flex; gap: var(--ntr-gap-3); margin-bottom: 14px; align-items: flex-start; }
.dwa-form-col { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dwa-form-label { font-size: var(--ntr-font-sm); font-weight: 600; color: var(--dsw-alias-text-primary, #374151); }
.dwa-hint { font-size: var(--ntr-font-xs); line-height: 1.55; color: var(--ntr-muted); }
.dwa-error { font-size: var(--ntr-font-xs); color: var(--ntr-danger); }
.dwa-input { min-height: 36px; font: inherit; font-size: var(--ntr-font-sm); padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; width: 100%; box-sizing: border-box; }
.dwa-select { min-height: 32px; font: inherit; font-size: var(--ntr-font-sm); padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; }
.dwa-input:hover, .dwa-select:hover { border-color: var(--dsw-alias-border-l1, #9ca3af); }
.dwa-input:focus, .dwa-select:focus { border-color: var(--ntr-accent); }
.dwa-input-mono, .dwa-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.dwa-stderr { max-height: 120px; overflow: auto; font-family: monospace; font-size: var(--ntr-font-xs); white-space: pre-wrap; color: var(--ntr-warn); margin: 12px 0 0; }
.dwa-default-hint { background: var(--dsw-alias-bg-layer-2, #f9fafb); border: var(--ntr-line); border-radius: var(--ntr-radius-sm); padding: 10px 12px; font-size: var(--ntr-font-sm); display: flex; align-items: center; justify-content: space-between; margin: 12px 0 14px; gap: 12px; }
.dwa-form-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: var(--ntr-line); flex-wrap: wrap; }
.dwa-form-actions .dwa-btn-primary { min-width: 88px; }
.dwa-menu-wrap { position: relative; }
.dwa-menu-wrap > .dwa-btn { width: 32px; padding: 0; }
.dwa-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 190px; border: var(--ntr-line); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 4px; display: flex; flex-direction: column; }
.dwa-menu-item { font: inherit; font-size: var(--ntr-font-sm); text-align: left; border: none; background: none; padding: 7px 10px; border-radius: 5px; cursor: pointer; color: inherit; }
.dwa-menu-item:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-menu-item-danger { color: var(--ntr-danger); }
.dwa-menu-confirm { display: flex; align-items: center; gap: 4px; padding: 4px; }
.dwa-add-panel { border: var(--ntr-line); border-radius: var(--ntr-radius); background: var(--dsw-alias-bg-layer-1, #fff); }
.dwa-add-toggle { width: 100%; border: 0; background: transparent; color: inherit; padding: 13px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; cursor: pointer; border-radius: var(--ntr-radius); }
.dwa-add-toggle:hover { background: var(--dsw-alias-interactive-bg-active, #f9fafb); }
.dwa-add-content { border-top: var(--ntr-line); padding: 14px 16px 16px; }
.dwa-chip { min-height: 30px; font: inherit; font-size: var(--ntr-font-sm); border: var(--ntr-line); border-radius: 999px; padding: 4px 12px; background: var(--dsw-alias-bg-layer-1, #fff); cursor: pointer; color: inherit; }
.dwa-chip:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-chip-active { border-color: var(--ntr-accent); background: #3b82f614; color: #2563eb; font-weight: 550; }
.dwa-chip-list { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 0 0 12px; }
.dwa-switch { display: inline-flex; align-items: center; gap: 7px; font-size: var(--ntr-font-sm); cursor: pointer; user-select: none; }
.dwa-inline-setting { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-2, #f9fafb); }
.dwa-inline-setting .dwa-switch { flex-shrink: 0; margin-top: 1px; }
.dwa-setting-copy { color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
/* Stacked, not side by side: the rows carry name, id and credit, and a
   half-width pane truncated them at every realistic settings width. Each list
   gets the whole column instead. */
.dwa-model-transfer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
/* Tall enough for a comfortable selection (about ten rows) before scrolling;
   the cap keeps the two stacked panes from pushing the rest of the card away. */
.dwa-model-pane { min-width: 0; max-height: 360px; display: flex; flex-direction: column; border: var(--ntr-line); border-radius: var(--ntr-radius-sm); background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.dwa-model-pane-head { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-bottom: var(--ntr-line); font-size: var(--ntr-font-xs); font-weight: 600; color: var(--dsw-alias-text-secondary, #4b5563); }
.dwa-model-pane-head .dwa-btn { margin-left: auto; min-height: 26px; padding: 2px 8px; font-size: var(--ntr-font-xs); }
.dwa-model-pane-head .dwa-caret-btn { flex: none; width: 22px; height: 22px; background: transparent; }
.dwa-model-pane-head .dwa-caret-btn:hover { background: var(--dsw-alias-interactive-bg-active, #e5e7eb); }
.dwa-model-pane.is-collapsed .dwa-model-list { display: none; }
.dwa-model-list { display: flex; flex-direction: column; gap: 2px; padding: 5px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dwa-model-section { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.dwa-model-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* The actions group keeps 「检测可用模型」 and the filter together and wraps as
   one unit; the status line takes the leftover space on the first row, so a
   narrow panel puts [detect][search] on its own row starting under the label
   instead of floating them to the right edge. */
.dwa-model-toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dwa-model-status { margin-left: auto; white-space: nowrap; }
.dwa-model-search { width: 200px; min-height: 30px; }
.dwa-model-empty { padding: 6px; }
.dwa-model-row { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: none; padding: 5px 6px; border-radius: 5px; cursor: pointer; color: inherit; font: inherit; font-size: var(--ntr-font-sm); text-align: left; }
.dwa-model-row:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-model-row.is-on { background: #3b82f614; color: #2563eb; }
.dwa-model-row-mark { width: 12px; flex: none; text-align: center; opacity: 0.75; }
.dwa-model-row-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Name and credit keep their room; the id is the only cell that collapses. */
.dwa-model-row-desc { flex: 0 0 auto; max-width: 45%; opacity: 0.75; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The trailing 14px is reserved for the fade mask: while the id fits, the
   gradient only covers empty padding; once it overflows, its tail dissolves
   instead of ending in a hard ellipsis. armModelIdMarquee reads the same
   padding to scroll the full text under the pointer. */
.dwa-model-row-value { flex: 0 1 auto; flex-shrink: 1000; box-sizing: border-box; min-width: 0; max-width: 45%; padding-right: 14px; opacity: 0.55; font-size: 10px; overflow: hidden; white-space: nowrap; mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent); -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent); }
.dwa-model-row-value-text { display: inline-block; white-space: nowrap; }
.dwa-model-row:hover .dwa-model-row-value-text { animation: dwa-model-id-marquee var(--dwa-id-duration, 1.4s) ease-in-out 0.2s infinite alternate; }
@keyframes dwa-model-id-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(var(--dwa-id-shift, 0px)); }
}
.dwa-model-row-remove { flex: none; opacity: 0.5; padding: 0 2px; }
.dwa-model-row:hover .dwa-model-row-remove { opacity: 1; }
.dwa-seg { display: inline-flex; border-radius: var(--ntr-radius-sm); border: 1px solid var(--dsw-alias-border-l2, #d1d5db); overflow: hidden; vertical-align: middle; }
.dwa-seg > button { min-height: 30px; font: inherit; font-size: var(--ntr-font-sm); color: inherit; border: none; background: var(--dsw-alias-bg-layer-1, #fff); padding: 4px 14px; cursor: pointer; }
.dwa-seg > button + button { border-left: 1px solid var(--dsw-alias-border-l2, #d1d5db); }
.dwa-seg > button:hover { background: var(--dsw-alias-interactive-bg-active, #f3f4f6); }
.dwa-seg > button.is-on { background: var(--ntr-accent); color: var(--dsw-alias-button-primary-invert, #fff); font-weight: 550; }
.dwa-preference-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; }
.dwa-preference-row + .dwa-preference-row { border-top: var(--ntr-line); }
.dwa-preference-label { font-size: var(--ntr-font-sm); font-weight: 600; }
.dwa-preference-copy { margin-top: 2px; color: var(--ntr-muted); font-size: var(--ntr-font-xs); }
.dwa-deadline-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dwa-deadline-input { width: 76px; min-height: 30px; padding: 4px 8px; text-align: right; }
.dwa-deadline-input[aria-invalid="true"] { border-color: var(--ntr-danger); }
.dwa-deadline-unit { white-space: nowrap; }
@media (max-width: 640px) {
  .dwa-root { padding: 14px; }
  .dwa-page-header { flex-direction: column; }
  .dwa-page-actions { width: 100%; }
  .dwa-page-actions .dwa-btn { width: 100%; }
  .dwa-model-toolbar-actions { width: 100%; }
  .dwa-model-search { flex: 1 1 auto; width: auto; }
  .dwa-subsection-head, .dwa-preference-row { align-items: flex-start; flex-direction: column; }
  .dwa-default-hint { align-items: flex-start; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .dwa-root *, .dwa-root *::before, .dwa-root *::after { transition: none !important; }
  .dwa-model-row:hover .dwa-model-row-value-text { animation: none !important; }
}
`;
		let styleMounted = false;
		function ensureStyle() {
			if (styleMounted || typeof document === "undefined") return;
			styleMounted = true;
			const node = document.createElement("style");
			node.textContent = STYLE;
			document.head.appendChild(node);
		}
		function useUi$1(acp) {
			return (0, react.useSyncExternalStore)((cb) => acp.subscribe(cb), () => acp.getSnapshot());
		}
		function stateVisual(state, acp) {
			switch (state) {
				case "ready": return {
					color: "#22c55e",
					text: acp.label("已连接", "Connected")
				};
				case "starting": return {
					color: "#eab308",
					text: acp.label("启动中", "Starting")
				};
				case "error": return {
					color: "#ef4444",
					text: acp.label("错误", "Error")
				};
				default: return {
					color: "#9ca3af",
					text: acp.label("已配置", "Configured"),
					title: acp.label("已配置，进程不常驻。在 DSH 聊天中首次使用时自动连接；展开区可用「测试连接」验证命令能否正常起来。", "Configured; the process is not kept resident. It connects automatically the first time a DSH chat turn uses it — use “Test connection” in the expanded panel to verify the command starts.")
				};
			}
		}
		/** Bilingual label for the event-stream state shown in the toolbar. */
		function streamText(stream, acp) {
			if (stream === "live") return acp.label("事件流已连接", "Event stream live");
			if (stream === "down") return acp.label("事件流已断开", "Event stream down");
			return acp.label("事件流连接中", "Event stream connecting");
		}
		/**
		* Canonical comparable form of an exposure filter. Unset and empty mean the
		* same thing host-side (no `agentId@choice` variants), so they share a key —
		* treating them as different would leave a row permanently dirty.
		*/
		function exposureKey(exposed) {
			return exposed === void 0 || exposed.length === 0 ? "none" : `set:${exposed.join("\0")}`;
		}
		function sameStringArray(a, b) {
			return a.length === b.length && a.every((value, index) => value === b[index]);
		}
		function sameStringMap(a, b) {
			const keys = Object.keys(a);
			if (keys.length !== Object.keys(b).length) return false;
			return keys.every((key) => a[key] === b[key]);
		}
		/**
		* Canonical comparable form of the MCP server list. Unset and empty mean the
		* same thing host-side (no extra MCP servers), so they share a key — treating
		* them as different would leave a card permanently dirty.
		*
		* The list is compared by CANONICAL JSON (object keys sorted, the servers
		* themselves sorted by name): reformatting the text — reordering keys,
		* re-indenting, listing the servers in another order — is not a change. The
		* ARGV array inside a server keeps its order, because there it is the command
		* line. The browser half needs no copy of the host's per-server validation: a
		* list the host would reject simply never matches, and the host's own error is
		* what the user sees.
		*/
		function mcpKey(servers) {
			if (servers === void 0 || servers.length === 0) return "none";
			const canonical = servers.map(canonicalJson).sort((a, b) => {
				const nameA = String(a.name ?? "");
				const nameB = String(b.name ?? "");
				return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
			});
			return JSON.stringify(canonical);
		}
		/** One value in canonical JSON form: object keys sorted, arrays kept in order. */
		function canonicalJson(value) {
			if (Array.isArray(value)) return value.map(canonicalJson);
			if (value === null || typeof value !== "object") return value;
			const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonicalJson(entry)]);
			return Object.fromEntries(entries);
		}
		/**
		* The MCP server list as the form holds it: the raw JSON text the user typed.
		*
		* Parsing happens on the way OUT (`buildPayload`), never on the way in, so a
		* half-typed value never throws inside a render. An unparseable text yields
		* `undefined`, which the form reports as invalid (`mcpInvalid`) and refuses to
		* save — better than sending a truncated list.
		*/
		function parseMcpServers(text) {
			const trimmed = text.trim();
			if (trimmed === "") return void 0;
			try {
				const parsed = JSON.parse(trimmed);
				if (!Array.isArray(parsed)) return void 0;
				return parsed;
			} catch {
				return;
			}
		}
		/** Whether the MCP server text parses as a list at all (the host validates the rest). */
		function mcpTextValid(text) {
			const trimmed = text.trim();
			if (trimmed === "") return true;
			try {
				return Array.isArray(JSON.parse(trimmed));
			} catch {
				return false;
			}
		}
		/**
		* Detected presets split by configured-ness, plus configured agents missing
		* from detection (custom / legacy persisted defs) synthesized into card
		* entries so they stay manageable.
		*/
		function partitionAgents(detectedAgents, agents) {
			const configured = [];
			const available = [];
			const agentIds = new Set(agents.map((a) => a.id));
			const detectedIds = new Set(detectedAgents.map((d) => d.id));
			for (const info of detectedAgents) if (agentIds.has(info.id) || info.currentConfig !== void 0) configured.push({
				info,
				synthesized: false
			});
			else available.push(info);
			for (const agent of agents) if (!detectedIds.has(agent.id)) configured.push({
				info: {
					id: agent.id,
					name: agent.title,
					detected: false,
					defaultCommand: agent.command,
					defaultArgs: [...agent.args]
				},
				synthesized: true
			});
			return {
				configured,
				available
			};
		}
		/**
		* The persisted definition a save would replace. `currentConfig` is the full
		* def (env / npmPackage / exposedModels included); the synthesized fallback
		* covers only the fields an `AgentView` carries, so anything else compares as
		* "changed" — the honest answer when the host never reported it.
		*/
		/**
		* The idle-release window in effect for an agent: an unset per-agent field is
		* resolved by the HOST and reported back on `AgentView`, so filling it from
		* there keeps "unset" and "explicitly the host default" the same state —
		* merely opening the form must never read as an unsaved change.
		*/
		function resolvedIdleTimeoutMs(def, activeAgent) {
			if (def.idleTimeoutMs !== void 0 || activeAgent?.idleTimeoutMs === void 0) return def;
			return {
				...def,
				idleTimeoutMs: activeAgent.idleTimeoutMs
			};
		}
		function persistedDef(detected, activeAgent) {
			if (detected.currentConfig !== void 0) return resolvedIdleTimeoutMs(detected.currentConfig, activeAgent);
			if (activeAgent === void 0) return void 0;
			return {
				id: activeAgent.id,
				title: activeAgent.title,
				command: activeAgent.command,
				args: [...activeAgent.args],
				...activeAgent.cwd === void 0 ? {} : { cwd: activeAgent.cwd },
				allowedCwdRoots: [...activeAgent.allowedCwdRoots],
				env: {},
				...activeAgent.idleTimeoutMs === void 0 ? {} : { idleTimeoutMs: activeAgent.idleTimeoutMs }
			};
		}
		/**
		* Equivalence test between the form payload and what is already persisted.
		* Order-insensitive on purpose: `env` is a map and `args`/`allowedCwdRoots`
		* keep their order, but a reordered allow-list is not a change worth warning
		* about; `exposedModels === undefined` means "offer no variants", which is the
		* same state as an empty list.
		*/
		function payloadEquals(payload, current) {
			if (payload.command !== current.command) return false;
			if ((payload.title ?? payload.id) !== (current.title ?? current.id)) return false;
			if (!sameStringArray(payload.args ?? [], current.args ?? [])) return false;
			if ((payload.npmPackage ?? "") !== (current.npmPackage ?? "")) return false;
			if ((payload.cwd ?? "") !== (current.cwd ?? "")) return false;
			if (!sameStringArray(payload.allowedCwdRoots ?? [], current.allowedCwdRoots ?? [])) return false;
			if (!sameStringMap(payload.env ?? {}, current.env ?? {})) return false;
			if (exposureKey(payload.exposedModels) !== exposureKey(current.exposedModels)) return false;
			if (mcpKey(payload.mcpServers) !== mcpKey(current.mcpServers)) return false;
			if (payload.autoDiscoverModels !== false !== (current.autoDiscoverModels !== false)) return false;
			if (payload.idleTimeoutMs !== void 0 && payload.idleTimeoutMs !== current.idleTimeoutMs) return false;
			return true;
		}
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
		function permissionLedgerCard(ui) {
			const visible = ui.permissions.length > 0;
			return {
				visible,
				fellBackFromConversation: visible && ui.approvalRouted
			};
		}
		/**
		* One-click windows for an approval deadline, in ms. `0` is spelled out rather
		* than hidden behind a big number because "never" is the value a cautious user
		* picks first, and a preset row that cannot express it would make them type.
		*/
		const DEADLINE_PRESETS = [
			0,
			3e4,
			6e4,
			3e5,
			9e5
		];
		/** Both editable windows, for the loops that treat them alike. */
		const DEADLINE_FIELDS = ["nativeApprovalTimeoutMs", "permissionFallbackTimeoutMs"];
		/** `5 分钟` / `30 秒` / `关` — the readout and the preset label, one formatter. */
		function deadlineText(ms, acp) {
			if (ms <= 0) return acp.label("关", "Off");
			const seconds = Math.round(ms / 1e3);
			if (seconds < 60) return acp.label(`${String(seconds)} 秒`, `${String(seconds)}s`);
			const minutes = Math.round(seconds / 60);
			return acp.label(`${String(minutes)} 分`, `${String(minutes)}m`);
		}
		/**
		* One editable deadline: presets for the windows people actually pick, plus a
		* free-form seconds field for everything else.
		*
		* The field is a DRAFT, not the value: it only commits a parseable whole number
		* of seconds (0 allowed), and an unparseable draft reverts on blur instead of
		* writing garbage the host would refuse. The host answer is what the row then
		* shows, so a value the host trims never lingers in the UI.
		*/
		function DeadlineRow(props) {
			const { acp, field, label, copy, value } = props;
			const [draft, setDraft] = (0, react.useState)(void 0);
			const text = draft ?? String(Math.round(value / 1e3));
			const parsed = /^\d+$/.test(text.trim()) ? Number(text.trim()) * 1e3 : void 0;
			const commit = () => {
				const next = parsed;
				setDraft(void 0);
				if (next !== void 0 && next !== value) acp.setApprovalDeadline(field, next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dwa-preference-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-preference-label",
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-preference-copy",
					children: copy
				})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-deadline-controls",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-seg",
							children: DEADLINE_PRESETS.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: value === preset ? "is-on" : "",
								title: deadlineText(preset, acp),
								onClick: () => void acp.setApprovalDeadline(field, preset),
								children: deadlineText(preset, acp)
							}, preset))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dwa-input dwa-deadline-input",
							type: "text",
							inputMode: "numeric",
							"aria-label": label,
							"aria-invalid": parsed === void 0,
							value: text,
							onChange: (event) => setDraft(event.target.value),
							onBlur: commit,
							onKeyDown: (event) => {
								if (event.key === "Enter") commit();
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dwa-hint dwa-deadline-unit",
							children: acp.label("秒", "sec")
						})
					]
				})]
			});
		}
		/**
		* The approval-deadline card.
		*
		* Both windows are about the SAME failure — an ask nobody answered — reached
		* from two different routes, which is exactly why they need an explanation
		* rather than two bare sliders: the first bounds a host that took the question
		* into the composer and never rendered it, the second bounds an ask that never
		* reached the conversation at all. Neither is an answer on the user's behalf
		* being hidden from them: withdrawing re-asks on the ledger, and the fallback
		* says what it did in a notice.
		*
		* `configured` and `permissionTimeoutMs` are reported by the host only when
		* they are actually in play, and both are shown here rather than swallowed:
		* a user tuning a number that something else is overriding deserves to be told.
		*/
		function ApprovalDeadlinesCard(props) {
			const { acp, ui } = props;
			const deadlines = ui.approvalDeadlines;
			if (deadlines === void 0) return null;
			const configured = deadlines.configured ?? {};
			const inForce = {
				nativeApprovalTimeoutMs: deadlines.nativeApprovalTimeoutMs,
				permissionFallbackTimeoutMs: deadlines.permissionFallbackTimeoutMs
			};
			const overrideNote = (field) => {
				const baseline = configured[field];
				if (baseline === void 0 || baseline === inForce[field]) return void 0;
				return acp.label(`cordis.patch.yml 里是 ${deadlineText(baseline, acp)}，设置页的值优先。`, `cordis.patch.yml asks for ${deadlineText(baseline, acp)}; the value set here wins.`);
			};
			const overridden = DEADLINE_FIELDS.some((field) => overrideNote(field) !== void 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dwa-section",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-section-heading",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dwa-section-title",
						children: acp.label("审批时限", "Approval deadlines")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dwa-section-copy",
						children: acp.label("没人答复的权限询问多久后由插件接手。两者都不是替你批准：撤回后会改到设置页再问一次，代答前会先发一条说明。", "How long an unanswered permission ask waits before the plugin takes over. Neither approves on your behalf: a withdrawal re-asks in Settings, and an auto-answer announces itself first.")
					})] })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-card",
					style: {
						paddingTop: 4,
						paddingBottom: 4
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeadlineRow, {
							acp,
							field: "nativeApprovalTimeoutMs",
							label: acp.label("对话审批撤回窗口", "Composer approval withdrawal"),
							copy: acp.label("宿主把询问接进对话后，多久没出现就撤回并改到设置页问。会渲染的接管是立即出现的，所以这个期限只为「收了却不渲染」而响。", "How long an ask the host took into the composer may stay invisible before it is withdrawn and re-asked in Settings. A takeover that renders does so immediately, so this only fires for one that never showed up."),
							value: deadlines.nativeApprovalTimeoutMs
						}),
						overrideNote("nativeApprovalTimeoutMs") !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-hint",
							style: { paddingBottom: 8 },
							children: overrideNote("nativeApprovalTimeoutMs")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeadlineRow, {
							acp,
							field: "permissionFallbackTimeoutMs",
							label: acp.label("降级询问代答窗口", "Degraded-ask auto-answer"),
							copy: acp.label("询问没能进入对话时（审批服务不可用，或已被撤回），多久后答复 cancelled。", "How long an ask that never reached the conversation (approval service unavailable, or withdrawn above) waits before it is answered cancelled."),
							value: deadlines.permissionFallbackTimeoutMs
						}),
						overrideNote("permissionFallbackTimeoutMs") !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-hint",
							style: { paddingBottom: 8 },
							children: overrideNote("permissionFallbackTimeoutMs")
						}),
						deadlines.permissionTimeoutMs !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-hint",
							style: { paddingBottom: 8 },
							children: acp.label(`注意：cordis.patch.yml 里 permissionTimeoutMs = ${deadlineText(deadlines.permissionTimeoutMs, acp)}，它一视同仁，覆盖上面两个窗口。`, `Note: cordis.patch.yml sets permissionTimeoutMs = ${deadlineText(deadlines.permissionTimeoutMs, acp)}, which governs every path alike and overrides both windows above.`)
						}),
						overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-preference-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-preference-copy",
								children: acp.label("设置页的值写在插件自己的状态文件里，重启后仍然有效；重置后回到 cordis.patch.yml 的配置。", "A value set here lives in the plugin's own state file and survives a restart; resetting returns to whatever cordis.patch.yml asks for.")
							}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dwa-btn",
								onClick: () => void acp.resetApprovalDeadlines(),
								children: acp.label("恢复配置文件的值", "Use config file value")
							})]
						})
					]
				})]
			});
		}
		/** Settings configuration section for ACP agents. */
		function AcpSettingsSection(props) {
			const acp = props.acp;
			ensureStyle();
			const ui = useUi$1(acp);
			const ledger = permissionLedgerCard(ui);
			const [addOpen, setAddOpen] = (0, react.useState)(true);
			const [addTarget, setAddTarget] = (0, react.useState)(void 0);
			const [createNonce, setCreateNonce] = (0, react.useState)(0);
			const { configured, available } = partitionAgents(ui.detectedAgents, ui.agents);
			const selected = addTarget ?? available[0] ?? NEW_AGENT_SEED;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dwa-root",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dwa-page-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-page-heading",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: "dwa-page-title",
									children: acp.label("NTR 智能体", "NTR Agents")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dwa-page-description",
									children: acp.label("管理智能体连接、可用模型与对话显示偏好。", "Manage agent connections, available models, and conversation display preferences.")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-page-status",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-dot",
											style: { background: ui.stream === "live" ? "#22c55e" : ui.stream === "down" ? "#ef4444" : "#9ca3af" },
											title: ui.stream
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: streamText(ui.stream, acp) }),
										ui.detectSummary !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["· ", ui.detectSummary] })
									]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-page-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dwa-btn",
								onClick: () => {
									acp.resync();
									acp.detectAgents();
								},
								disabled: ui.detecting,
								children: ui.detecting ? acp.label("检测中...", "Detecting...") : acp.label("重新检测与刷新", "Re-detect & Refresh")
							})
						})]
					}),
					ledger.visible && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-card dwa-card-warn",
						style: { marginBottom: 16 },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontWeight: 600,
									marginBottom: 8
								},
								children: acp.label("待处理权限请求", "Pending Permission Requests")
							}),
							ledger.fellBackFromConversation && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-hint",
								style: { marginBottom: 8 },
								children: acp.label("这些询问没有进入对话（审批服务本次不可用、问题从未到达对话，或会话没有对话身份），请在此回答。", "These asks did not reach the conversation (the approval service was unavailable, the question never reached the conversation, or the session has no chat identity) — answer them here.")
							}),
							ui.permissions.map((permission) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									marginBottom: 6,
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											flex: 1,
											minWidth: 160
										},
										children: permission.title
									}),
									permission.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dwa-btn dwa-btn-primary",
										onClick: () => void acp.respondPermission(permission.requestId, option.optionId),
										children: option.name
									}, option.optionId)),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dwa-btn",
										onClick: () => void acp.respondPermission(permission.requestId),
										children: acp.label("拒绝", "Dismiss")
									})
								]
							}, permission.requestId))
						]
					}),
					ui.notice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-card dwa-card-warn",
						style: {
							marginBottom: 16,
							display: "flex",
							alignItems: "center",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { flex: 1 },
							children: ui.notice
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dwa-btn",
							onClick: () => acp.clearNotice(),
							children: "✕"
						})]
					}),
					ui.preset !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-card dwa-mode-banner",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-mode-title",
								children: [acp.label("NTR 模式", "NTR mode"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-badge",
									children: ui.preset.id
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `dwa-badge ${ui.preset.installed ? "dwa-badge-success" : "dwa-badge-warn"}`,
								children: ui.preset.installed ? acp.label("已就绪", "Ready") : acp.label("需检查", "Needs attention")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-mode-copy",
								children: [ui.preset.installed ? acp.label("已加入宿主模式列表，新建会话时选择「NTR 模式」即可使用。", "Added to the harness roster. Pick “NTR mode” when creating a session.") : acp.label("宿主模式列表中没有可用的「NTR 模式」，请检查预设声明。", "The harness roster has no usable “NTR mode”. Check the preset declaration."), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: "dwa-mode-source dwa-mono",
									children: ui.preset.source
								})]
							}),
							ui.preset.problem !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-hint",
								style: {
									gridColumn: "1 / -1",
									color: "var(--ntr-warn)"
								},
								children: acp.label(`宿主报告：${ui.preset.problem}`, `Harness reported: ${ui.preset.problem}`)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dwa-section",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-section-heading",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
									className: "dwa-section-title",
									children: [acp.label("已接入的智能体", "Connected agents"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dwa-badge",
										children: configured.length
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dwa-section-copy",
									children: acp.label("展开智能体可管理模型、启动命令与工作区。", "Expand an agent to manage its models, launch command, and workspace.")
								})] })
							}),
							configured.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-card",
								style: {
									textAlign: "center",
									color: "var(--ntr-muted)",
									padding: 20
								},
								children: acp.label("尚未启用任何 Agent。从下方「添加智能体」点一个检测到的预设（会展开预填命令的创建卡），再点「保存并启用」；也可以直接新建自定义 Agent。", "No agents configured yet. Pick a detected preset from \"Add agent\" below (it opens a creation card prefilled with its command), then click \"Save & Enable\" — or create a custom one from scratch.")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-agent-list",
								children: configured.map(({ info, synthesized }) => {
									const activeAgent = ui.agents.find((a) => a.id === info.id);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentRow, {
										detected: info,
										activeAgent,
										acp,
										isDefault: ui.defaultAgent === info.id,
										synthesized
									}, info.id);
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						className: "dwa-section",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-add-panel",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dwa-add-toggle",
								"aria-expanded": addOpen,
								onClick: () => setAddOpen((open) => !open),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-section-title",
									children: acp.label("添加智能体", "Add agent")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-section-copy",
									style: { display: "block" },
									children: acp.label("从预设快速启用，或创建自定义连接。", "Enable a preset or create a custom connection.")
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-caret-btn",
									"aria-hidden": true,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dwa-caret",
										children: addOpen ? "▾" : "▸"
									})
								})]
							}), addOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-add-content",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dwa-chip-list",
										children: [available.map((info) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: `dwa-chip${selected.id === info.id ? " dwa-chip-active" : ""}`,
											onClick: () => setAddTarget(info),
											title: info.description,
											children: info.name
										}, info.id)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: `dwa-chip${selected.id === "" ? " dwa-chip-active" : ""}`,
											onClick: () => setAddTarget(NEW_AGENT_SEED),
											children: acp.label("自定义", "Custom")
										})]
									}),
									available.length === 0 && selected.id === "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dwa-hint",
										style: { marginBottom: 8 },
										children: acp.label("没有更多可启用的预设 Agent。", "No more detected presets to enable.")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentRow, {
										detected: selected,
										acp,
										isDefault: false,
										synthesized: false,
										newCustom: selected.id === "",
										onCreated: () => {
											setAddTarget(void 0);
											setCreateNonce((nonce) => nonce + 1);
										}
									}, selected.id === "" ? `custom-${createNonce}` : selected.id)
								]
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalDeadlinesCard, {
						acp,
						ui
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dwa-section",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-section-heading",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "dwa-section-title",
								children: acp.label("对话外观", "Conversation appearance")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dwa-section-copy",
								children: acp.label("设置对话中 NTR 挂牌的进程存活提示。", "Choose how the NTR tag indicates a running agent process.")
							})] })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-card",
							style: {
								paddingTop: 4,
								paddingBottom: 4
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-preference-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-preference-label",
									children: acp.label("挂牌光晕", "Tag halo")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-preference-copy",
									children: acp.label("呼吸为脉动光，常亮为恒定光。", "Breathe pulses gently; steady keeps a constant glow.")
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-seg",
									children: ["breath", "steady"].map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ui.tagHalo.mode === mode ? "is-on" : "",
										onClick: () => void acp.setTagHalo({
											...ui.tagHalo,
											mode
										}),
										children: mode === "breath" ? acp.label("呼吸", "Breathe") : acp.label("常亮", "Steady")
									}, mode))
								})]
							}), ui.tagHalo.mode === "breath" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-preference-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-preference-label",
									children: acp.label("呼吸频率", "Breathing speed")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-preference-copy",
									children: acp.label("控制光晕的脉动速度。", "Controls how quickly the halo pulses.")
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-seg",
									children: [
										"slow",
										"normal",
										"fast"
									].map((speed) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ui.tagHalo.speed === speed ? "is-on" : "",
										onClick: () => void acp.setTagHalo({
											...ui.tagHalo,
											speed
										}),
										children: speed === "slow" ? acp.label("慢速", "Slow") : speed === "normal" ? acp.label("正常", "Normal") : acp.label("快速", "Fast")
									}, speed))
								})]
							})]
						})]
					})
				]
			});
		}
		/** One row per agent: compact when collapsed, the full form when expanded. */
		function AgentRow({ detected, activeAgent, acp, isDefault, synthesized, newCustom = false, onCreated }) {
			const ui = useUi$1(acp);
			const configured = activeAgent !== void 0 || detected.currentConfig !== void 0;
			const [expanded, setExpanded] = (0, react.useState)(!configured);
			const [form, setForm] = (0, react.useState)(() => initialForm(detected, activeAgent));
			const [saving, setSaving] = (0, react.useState)(false);
			const [savedSuccess, setSavedSuccess] = (0, react.useState)(false);
			const [testing, setTesting] = (0, react.useState)(false);
			const [testResult, setTestResult] = (0, react.useState)(void 0);
			const patch = (next) => setForm((prev) => ({
				...prev,
				...next
			}));
			const serverExposureKey = exposureKey(detected.currentConfig?.exposedModels);
			(0, react.useEffect)(() => {
				const server = detected.currentConfig?.exposedModels;
				setForm((prev) => ({
					...prev,
					exposed: server === void 0 ? void 0 : [...server]
				}));
			}, [serverExposureKey]);
			const serverAutoDiscover = detected.currentConfig?.autoDiscoverModels !== false;
			(0, react.useEffect)(() => {
				setForm((prev) => ({
					...prev,
					autoDiscoverModels: serverAutoDiscover
				}));
			}, [serverAutoDiscover]);
			const trimmedId = form.agentId.trim();
			const idValid = !newCustom || AGENT_ID_PATTERN.test(trimmedId);
			const idTaken = newCustom && trimmedId !== "" && ui.agents.some((a) => a.id === trimmedId);
			const cwdInvalid = form.cwd.trim() !== "" && !isAbsolutePathLike(form.cwd.trim());
			const rootValues = form.roots.map((root) => root.trim()).filter((root) => root !== "");
			const rootsInvalid = form.rootsOpen && (rootValues.length === 0 || rootValues.some((root) => !isAbsolutePathLike(root)));
			const idleInvalid = !idleValid(form.idleStr);
			const mcpInvalid = !mcpTextValid(form.mcpText);
			const formIncomplete = splitCommandLine(form.commandLine).command === "" || !idValid || idTaken || cwdInvalid || rootsInvalid || idleInvalid || mcpInvalid;
			const payload = buildPayload(form, detected, newCustom);
			const current = persistedDef(detected, activeAgent);
			const showSaveWarning = current !== void 0 && !payloadEquals(payload, current) && activeAgent !== void 0 && activeAgent.state !== "stopped";
			const handleUseDefault = () => patch({ commandLine: formatCommandLine(detected.defaultCommand, detected.defaultArgs) });
			const handleSave = async () => {
				setSaving(true);
				setSavedSuccess(false);
				try {
					await acp.saveAgent(payload);
					onCreated?.();
					if (newCustom) return;
					setSavedSuccess(true);
					setTimeout(() => setSavedSuccess(false), 2e3);
				} catch {} finally {
					setSaving(false);
				}
			};
			const handleTest = async () => {
				setTesting(true);
				setTestResult(void 0);
				try {
					const result = await acp.testAgent(payload);
					setTestResult(result.ok ? {
						ok: true,
						text: acp.label("连接成功", "Connected") + (result.agentInfo?.name !== void 0 ? ` · ${result.agentInfo.name}` : "") + (result.agentInfo?.version !== void 0 ? ` v${result.agentInfo.version}` : "") + ` · ${String(result.durationMs)}ms`
					} : {
						ok: false,
						text: result.error ?? acp.label("未知错误", "Unknown error")
					});
				} catch (error) {
					setTestResult({
						ok: false,
						text: error instanceof Error ? error.message : String(error)
					});
				} finally {
					setTesting(false);
				}
			};
			const state = activeAgent !== void 0 ? stateVisual(activeAgent.state, acp) : void 0;
			const displayName = newCustom ? acp.label("新建自定义 Agent", "New Custom Agent") : activeAgent?.title ?? detected.currentConfig?.title ?? detected.name;
			const stderr = activeAgent?.state === "error" ? activeAgent.stderrTail ?? [] : [];
			const errorSummary = stderr.length > 0 ? stderr[stderr.length - 1] : void 0;
			const currentModel = ui.modelCatalogs[detected.id]?.catalog.model?.currentValue;
			const isPreset = PRESET_IDS.has(detected.id);
			const open = expanded || activeAgent?.state === "error" && configured;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `dwa-agent-card${open ? " is-open" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-agent-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dwa-caret-btn",
							"aria-expanded": open,
							onClick: () => setExpanded((value) => !value),
							title: open ? acp.label("收起", "Collapse") : acp.label("展开配置与模型", "Expand configuration and models"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-caret",
								"aria-hidden": true,
								children: open ? "▾" : "▸"
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-agent-summary",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-agent-titleline",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-agent-name",
											title: detected.executablePath ?? detected.description,
											children: displayName
										}),
										isDefault && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-badge dwa-badge-success",
											children: acp.label("默认", "Default")
										}),
										!isPreset && !newCustom && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-badge",
											children: acp.label("自定义", "Custom")
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-agent-meta",
									children: [
										state !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											title: state.title ?? activeAgent?.state,
											style: {
												display: "inline-flex",
												alignItems: "center",
												gap: 6
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dwa-dot",
												style: { background: state.color }
											}), state.text]
										}),
										configured && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [state !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-agent-meta-separator",
											children: "·"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: currentModel === void 0 ? acp.label("未探测模型", "Model not probed") : `${acp.label("模型", "Model")}: ${currentModel}` })] }),
										!synthesized && !newCustom && !detected.detected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: { color: "var(--ntr-warn)" },
											title: detected.description,
											children: ["· ", acp.label("未在 PATH 中检测到", "Not in PATH")]
										})
									]
								}),
								errorSummary !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dwa-error dwa-mono",
									style: {
										marginTop: 6,
										wordBreak: "break-all"
									},
									children: errorSummary
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6
							},
							children: [activeAgent?.state === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dwa-btn",
								disabled: testing,
								onClick: () => void handleTest(),
								children: testing ? acp.label("测试中...", "Testing...") : acp.label("测试", "Test")
							}), configured && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RowMenu, {
								acp,
								canStop: activeAgent !== void 0 && activeAgent.state !== "stopped",
								onStop: () => void acp.stopAgent(detected.id),
								onRemove: async () => {
									await acp.deleteAgent(detected.id).catch(() => {});
								}
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-agent-body",
					style: open ? void 0 : { display: "none" },
					children: [
						stderr.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: "dwa-stderr",
							children: stderr.join("\n")
						}),
						configured && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dwa-subsection",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-subsection-head",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: "dwa-subsection-title",
									children: acp.label("模型与默认值", "Models & defaults")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dwa-subsection-copy",
									children: acp.label("检测模型目录，并控制对话中可选择的模型。", "Detect the model catalog and choose what appears in conversations.")
								})] })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCatalogBlock, {
								agentId: detected.id,
								detected,
								acp,
								active: open,
								exposed: form.exposed,
								onExposedChange: (exposed) => patch({ exposed }),
								autoDiscover: form.autoDiscoverModels,
								onAutoDiscoverChange: (autoDiscoverModels) => patch({ autoDiscoverModels }),
								isDefault
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dwa-subsection",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dwa-subsection-head",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: "dwa-subsection-title",
									children: acp.label("连接配置", "Connection")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dwa-subsection-copy",
									children: acp.label("设置显示名与启动命令，高级选项按需展开。", "Set the display name and launch command; expand advanced options only when needed.")
								})] })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentDetails, {
								acp,
								detected,
								form,
								patch,
								isConfigured: configured,
								newCustom,
								formIncomplete,
								idValid,
								idTaken,
								cwdInvalid,
								rootsInvalid,
								idleInvalid,
								mcpInvalid,
								saving,
								savedSuccess,
								testing,
								testResult,
								showSaveWarning,
								onUseDefault: handleUseDefault,
								onSave: () => void handleSave(),
								onTest: () => void handleTest()
							})]
						})
					]
				})]
			});
		}
		/**
		* Hand copy of `DEFAULT_TUNING.idleTimeoutMs` (src/bridge.ts): the browser
		* cannot import the host plane, and this number is only ever placeholder text
		* for a NOT-yet-configured agent (a configured one renders the host's resolved
		* value from `AgentView.idleTimeoutMs`). Keep the two in sync.
		*/
		const DEFAULT_IDLE_RELEASE_MS = 18e5;
		/**
		* Hand copy of `DEFAULT_TUNING.probeIdleTimeoutMs` (src/bridge.ts). A process
		* that has never hosted a session — the model probe / post-save probe — lives
		* by THIS window whatever the agent's own field says, so the placeholder has to
		* name both windows. Keep the two in sync.
		*/
		const DEFAULT_PROBE_RELEASE_MS = 3e5;
		function initialForm(detected, activeAgent) {
			const config = detected.currentConfig;
			const roots = [...activeAgent?.allowedCwdRoots ?? config?.allowedCwdRoots ?? []];
			return {
				agentId: detected.id,
				title: activeAgent?.title ?? config?.title ?? detected.name,
				commandLine: formatCommandLine(activeAgent?.command ?? config?.command ?? detected.defaultCommand, activeAgent?.args ?? config?.args ?? detected.defaultArgs),
				npmPackage: config?.npmPackage ?? "",
				cwd: activeAgent?.cwd ?? config?.cwd ?? "",
				rootsOpen: roots.length > 1,
				roots,
				envRows: Object.entries(config?.env ?? {}).map(([key, value]) => ({
					key,
					value
				})),
				exposed: config?.exposedModels === void 0 ? void 0 : [...config.exposedModels],
				autoDiscoverModels: config?.autoDiscoverModels !== false,
				idleStr: idleText(activeAgent?.idleTimeoutMs ?? config?.idleTimeoutMs),
				mcpText: config?.mcpServers === void 0 ? "" : JSON.stringify(config.mcpServers, null, 2)
			};
		}
		function idleText(value) {
			return value === void 0 ? "" : String(value);
		}
		/** `MM-DD HH:mm`, local time — compact enough for the catalog's status line. */
		function formatStamp(ms) {
			const date = new Date(ms);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		/**
		* Assemble the save/test payload.
		*
		* Workspace rules (P0-1): a non-empty single-root `cwd` also pins
		* `allowedCwdRoots` to exactly that path — an explicit narrowing, so saving
		* from the panel can never silently widen the sandbox. An empty `cwd` sends
		* neither field and the host falls back to `~/.dsh/dsh-ntr/workspaces`. Advanced
		* mode sends the edited roots as-is (deduplicated).
		*/
		/** `''` = host default, `0` = never release, otherwise a sane millisecond window. */
		function idleValid(raw) {
			const text = raw.trim();
			if (text === "") return true;
			if (!/^\d+$/.test(text)) return false;
			const value = Number(text);
			return value === 0 || value >= 1e3 && value <= 864e5;
		}
		function buildPayload(form, detected, newCustom) {
			const env = {};
			for (const row of form.envRows) {
				const key = row.key.trim();
				if (key === "") continue;
				env[key] = row.value;
			}
			const cwd = form.cwd.trim();
			const idleRaw = form.idleStr.trim();
			const parsed = splitCommandLine(form.commandLine);
			const mcpServers = parseMcpServers(form.mcpText);
			const payload = {
				id: newCustom ? form.agentId.trim() : detected.id,
				...form.title.trim() === "" ? {} : { title: form.title.trim() },
				command: parsed.command,
				args: parsed.args,
				...form.npmPackage.trim() === "" ? {} : { npmPackage: form.npmPackage.trim() },
				env,
				...form.exposed === void 0 ? {} : { exposedModels: form.exposed },
				...form.autoDiscoverModels ? {} : { autoDiscoverModels: false },
				...idleRaw === "" || !idleValid(idleRaw) ? {} : { idleTimeoutMs: Number(idleRaw) },
				...mcpServers === void 0 ? {} : { mcpServers }
			};
			if (form.rootsOpen) {
				if (cwd !== "") payload.cwd = cwd;
				const roots = [...new Set(form.roots.map((root) => root.trim()).filter((root) => root !== ""))];
				if (roots.length > 0) payload.allowedCwdRoots = roots;
				return payload;
			}
			if (cwd !== "") {
				payload.cwd = cwd;
				payload.allowedCwdRoots = [cwd];
			}
			return payload;
		}
		/** The expanded body: connection form, workspace allow-list, env, actions. */
		function AgentDetails({ acp, detected, form, patch, isConfigured, newCustom, formIncomplete, idValid, idTaken, cwdInvalid, rootsInvalid, idleInvalid, mcpInvalid, saving, savedSuccess, testing, testResult, showSaveWarning, onUseDefault, onSave, onTest }) {
			useUi$1(acp);
			const [advancedOpen, setAdvancedOpen] = (0, react.useState)(false);
			const parsedCommand = splitCommandLine(form.commandLine);
			const commandPreview = parsedCommand.command === "" ? acp.label("填整条命令，例如：codebuddy --acp", "Type the whole command, e.g. codebuddy --acp") : `${acp.label("程序", "Program")}: ${parsedCommand.command}` + (parsedCommand.args.length === 0 ? "" : `　${acp.label("参数", "Arguments")}: ${parsedCommand.args.join(" ")}`);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				newCustom && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-form-row",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-form-col",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: "dwa-form-label",
								children: acp.label("Agent ID（唯一标识，创建后不可改）", "Agent ID (unique, immutable after creation)")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dwa-input dwa-input-mono",
								value: form.agentId,
								onChange: (e) => patch({ agentId: e.target.value }),
								placeholder: "e.g. my-agent"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: idValid && !idTaken ? "dwa-hint" : "dwa-error",
								children: idTaken ? acp.label("该 ID 已被现有 Agent 占用。", "This id is already taken by a configured agent.") : idValid ? acp.label("小写字母或数字开头，可用 a-z 0-9 . _ -，最长 64 字符。", "Starts with a lowercase letter or digit; a-z 0-9 . _ - allowed; max 64 chars.") : acp.label("ID 格式不合法：小写字母或数字开头，可用 a-z 0-9 . _ -。", "Invalid id: start with a lowercase letter or digit; only a-z 0-9 . _ - allowed.")
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-form-row",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-form-col",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dwa-form-label",
							children: acp.label("显示名", "Display Name")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dwa-input",
							value: form.title,
							onChange: (e) => patch({ title: e.target.value }),
							placeholder: detected.name === "" ? acp.label("我的 Agent", "My Agent") : detected.name
						})]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-form-row",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-form-col",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: "dwa-form-label",
								children: acp.label("启动命令（程序 + 参数）", "Launch Command (program + arguments)")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dwa-input dwa-input-mono",
								value: form.commandLine,
								onChange: (e) => patch({ commandLine: e.target.value }),
								placeholder: detected.defaultCommand === "" ? "e.g. codebuddy --acp" : formatCommandLine(detected.defaultCommand, detected.defaultArgs)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-hint",
								children: commandPreview
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-hint",
								children: acp.label("参数直接跟在程序后面即可；路径里含空格时用引号包住整条路径，例如 \"C:\\Program Files\\nodejs\\node.exe\" --acp。", "Arguments go right after the program; quote a whole path that contains spaces, e.g. \"C:\\Program Files\\nodejs\\node.exe\" --acp.")
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginTop: 12,
						flexWrap: "wrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dwa-btn dwa-btn-secondary",
							"aria-expanded": advancedOpen,
							onClick: () => setAdvancedOpen((value) => !value),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-caret",
									"aria-hidden": true,
									children: advancedOpen ? "▾" : "▸"
								}),
								" ",
								acp.label("高级参数", "Advanced Parameters")
							]
						}),
						!advancedOpen && (cwdInvalid || rootsInvalid) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dwa-error",
							children: acp.label("里面有非法的工作空间路径", "Contains an invalid workspace path")
						}),
						!advancedOpen && mcpInvalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dwa-error",
							children: acp.label("里面的 MCP 服务器配置不是合法 JSON", "Contains an invalid MCP server list")
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: advancedOpen ? void 0 : { display: "none" },
					children: [
						!newCustom && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-default-hint",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 600,
									marginRight: 6
								},
								children: acp.label("官方测试默认命令:", "Tested Default Command:")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", {
								className: "dwa-input-mono",
								style: {
									background: "#0000000a",
									padding: "2px 6px",
									borderRadius: 4
								},
								children: [
									detected.defaultCommand,
									" ",
									detected.defaultArgs.join(" ")
								]
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dwa-btn dwa-btn-secondary",
								onClick: onUseDefault,
								title: acp.label("把命令与参数重置为官方验证值", "Reset command and arguments to the tested default"),
								children: acp.label("使用预设值", "Use Preset")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-form-row",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-form-col",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									className: "dwa-form-label",
									children: acp.label("npm 包名（PATH 中找不到时自动安装）", "npm Package (auto-installed when missing from PATH)")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dwa-input dwa-input-mono",
									value: form.npmPackage,
									onChange: (e) => patch({ npmPackage: e.target.value }),
									placeholder: acp.label("原生支持 ACP 的 agent 无需填写", "Not needed for agents with native ACP support")
								})]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceBlock, {
							acp,
							form,
							patch,
							cwdInvalid,
							rootsInvalid
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dwa-form-row",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dwa-form-col",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "dwa-form-label",
										children: acp.label("空闲释放（毫秒）", "Idle Release (ms)")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dwa-input dwa-input-mono",
										value: form.idleStr,
										onChange: (e) => patch({ idleStr: e.target.value }),
										placeholder: acp.label(`留空 = 宿主默认（承载会话 ${String(DEFAULT_IDLE_RELEASE_MS / 6e4)} 分钟 / 探测进程 ${String(DEFAULT_PROBE_RELEASE_MS / 6e4)} 分钟）`, `Blank = host default (${String(DEFAULT_IDLE_RELEASE_MS / 6e4)} min for a chat process / ${String(DEFAULT_PROBE_RELEASE_MS / 6e4)} min for a probe)`)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: idleInvalid ? "dwa-error" : "dwa-hint",
										children: idleInvalid ? acp.label("必须是 0（永不释放）或 [1000, 86400000] 之间的整数毫秒。", "Must be 0 (never release) or an integer in [1000, 86400000] ms.") : acp.label("没有进行中的回合或待答审批时，空闲超过此时长就挂起进程（会话保留，下一条消息自动重启并恢复）；0 = 永不释放；有回合在跑、取消尚未结算或审批待答的进程不会被释放。此窗口只对承载过会话的进程生效：保存后拉起的模型探测进程（面板显示「已连接」的那个）固定 5 分钟释放，填 0 也拦不住。", "With no turn in flight or approval awaiting an answer, the process is parked once it has been idle this long (sessions are kept and resume on the next message); 0 = never; a process with a running turn, an unsettled cancel, or a pending approval is never released. This window applies only to a process that has hosted a session: the model-probe process (the one the panel shows as \"connected\" after a save) is always released after 5 minutes, and 0 does not stop it.")
									})
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-form-row",
							style: {
								flexDirection: "column",
								gap: 6
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dwa-form-label",
										children: acp.label("环境变量", "Environment Variables")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dwa-btn dwa-btn-secondary",
										onClick: () => patch({ envRows: [...form.envRows, {
											key: "",
											value: ""
										}] }),
										children: acp.label("添加", "Add")
									})]
								}),
								form.envRows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 6,
										alignItems: "center"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dwa-input dwa-input-mono",
											style: { flex: 2 },
											value: row.key,
											onChange: (e) => patch({ envRows: form.envRows.map((r, i) => i === index ? {
												...r,
												key: e.target.value
											} : r) }),
											placeholder: "KEY"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dwa-input dwa-input-mono",
											style: { flex: 3 },
											value: row.value,
											onChange: (e) => patch({ envRows: form.envRows.map((r, i) => i === index ? {
												...r,
												value: e.target.value
											} : r) }),
											placeholder: "VALUE"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dwa-btn",
											title: acp.label("删除该变量", "Remove this variable"),
											onClick: () => patch({ envRows: form.envRows.filter((_, i) => i !== index) }),
											children: "✕"
										})
									]
								}, index)),
								form.envRows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-hint",
									children: acp.label("无自定义变量；子进程继承宿主环境。", "No custom variables; the child inherits the host environment.")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-form-row",
							style: {
								flexDirection: "column",
								gap: 6
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-form-label",
									children: acp.label("MCP 服务器（JSON）", "MCP Servers (JSON)")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: "dwa-input dwa-input-mono",
									style: {
										minHeight: 96,
										resize: "vertical"
									},
									value: form.mcpText,
									onChange: (e) => patch({ mcpText: e.target.value }),
									spellCheck: false,
									placeholder: "[\n  { \"name\": \"example\", \"transport\": \"stdio\", \"command\": \"/abs/path/to/server\", \"args\": [\"--mcp\"] }\n]"
								}),
								mcpInvalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-error",
									children: acp.label("必须是一个 JSON 数组；每个条目写明 name 与 transport。", "Must be a JSON array; every entry needs a name and a transport.")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-hint",
									children: acp.label("这些 MCP 服务器会在建会话时交给 agent，由 agent 自己拉起并使用（stdio 需填 command，可选 args / env；http 与 sse 需填 url，可选 headers）。agent 自己配置的 MCP 服务器不受影响，这里只是额外追加。", "These MCP servers are handed to the agent when a session is created; the agent launches and uses them itself (stdio needs command, with optional args / env; http and sse need url, with optional headers). The MCP servers the agent configures for itself are unaffected — this only adds more.")
								})
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-form-actions",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dwa-btn",
							onClick: onTest,
							disabled: testing || saving || formIncomplete,
							title: acp.label("用当前表单值拉起一次性进程并完成 ACP 握手，不保存配置", "Spawns a throwaway process from the form values and completes the ACP handshake; nothing is saved"),
							children: testing ? acp.label("测试中...", "Testing...") : acp.label("测试连接", "Test Connection")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dwa-btn dwa-btn-primary",
							onClick: onSave,
							disabled: saving || testing || formIncomplete,
							children: saving ? acp.label("保存中...", "Saving...") : savedSuccess ? acp.label("✓ 已保存", "✓ Saved") : isConfigured ? acp.label("保存", "Save") : acp.label("保存并启用", "Save & Enable")
						}),
						showSaveWarning && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dwa-hint",
							style: { color: "var(--ntr-warn)" },
							children: ["⚠ ", acp.label("保存会停止该 Agent 进程并中断进行中的会话", "Saving stops this agent process and interrupts live sessions")]
						})
					]
				}),
				testResult !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-mono",
					style: {
						marginTop: 8,
						fontSize: 12,
						whiteSpace: "pre-wrap",
						wordBreak: "break-all",
						color: testResult.ok ? "#16a34a" : "var(--ntr-danger)"
					},
					children: [testResult.ok ? "✓ " : "✕ ", testResult.text]
				})
			] });
		}
		/**
		* Workspace editor. Single-root mode is one directory; the advanced switch
		* reveals the full allow-list, because the host enforces every root the agent
		* may touch (and refuses anything else with `cwd_denied`).
		*/
		function WorkspaceBlock({ acp, form, patch, cwdInvalid, rootsInvalid }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dwa-form-row",
				style: {
					flexDirection: "column",
					gap: 6
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dwa-form-label",
							children: acp.label("工作空间根目录", "Workspace Roots")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dwa-hint",
							style: {
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								cursor: "pointer"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: form.rootsOpen,
								onChange: (e) => patch({ rootsOpen: e.target.checked }),
								style: { margin: 0 }
							}), acp.label("白名单根目录（高级）", "Root allow-list (advanced)")]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-form-col",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dwa-input",
								value: form.cwd,
								onChange: (e) => patch({ cwd: e.target.value }),
								placeholder: acp.label("默认 ~/.dsh/dsh-ntr/workspaces", "Default: ~/.dsh/dsh-ntr/workspaces")
							}),
							cwdInvalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-error",
								children: acp.label("必须是绝对路径（如 /work 或 C:\\work）", "Must be an absolute path (e.g. /work or C:\\work)")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-hint",
								children: acp.label("对话里的 NTR 会话以该 DSH 会话选中的工作区为工作目录（agent 进程也从那里启动）；此项只在 /acp 直连会话与宿主未上报工作区时生效。", "An NTR session inside a conversation runs — and starts its agent process — in that DSH session’s own workspace; this value applies to /acp-direct sessions and when the host reports no workspace.")
							}),
							!form.rootsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dwa-hint",
								children: [
									acp.label("当前白名单：", "Current allow-list: "),
									form.roots.length === 0 ? acp.label("（未设置）", "(unset)") : form.roots.join("、"),
									form.cwd.trim() === "" ? "" : acp.label("；保存时将收窄为工作空间目录", "; saving narrows it to the workspace directory")
								]
							})
						]
					}),
					form.rootsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-form-col",
						style: { gap: 4 },
						children: [
							form.roots.map((root, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 6,
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dwa-input dwa-input-mono",
									value: root,
									onChange: (e) => patch({ roots: form.roots.map((r, i) => i === index ? e.target.value : r) }),
									placeholder: "/absolute/path"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dwa-btn",
									title: acp.label("删除该根目录", "Remove this root"),
									onClick: () => patch({ roots: form.roots.filter((_, i) => i !== index) }),
									children: "✕"
								})]
							}, index)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dwa-btn dwa-btn-secondary",
									onClick: () => patch({ roots: [...form.roots, ""] }),
									children: acp.label("添加根目录", "Add root")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-hint",
									children: acp.label("留空的工作空间则使用宿主默认目录。", "An empty workspace falls back to the host default directory.")
								})]
							}),
							rootsInvalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-error",
								children: acp.label("至少需要一个绝对路径根目录", "At least one absolute root is required")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dwa-hint",
						children: acp.label("白名单之外的路径会被宿主拒绝（cwd_denied）；当前 DSH 会话自己的工作区始终被信任。", "Paths outside the allow-list are refused by the host (cwd_denied); the current DSH session’s own workspace is always trusted.")
					})
				]
			});
		}
		/** Row overflow menu: the dangerous actions, plus the inline remove confirm. */
		function RowMenu({ acp, canStop, onStop, onRemove }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [confirming, setConfirming] = (0, react.useState)(false);
			const wrap = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDown = (event) => {
					if (wrap.current !== null && event.target instanceof Node && wrap.current.contains(event.target)) return;
					setOpen(false);
					setConfirming(false);
				};
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					setOpen(false);
					setConfirming(false);
				};
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const close = () => {
				setOpen(false);
				setConfirming(false);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dwa-menu-wrap",
				ref: wrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dwa-btn",
					"aria-haspopup": "menu",
					"aria-expanded": open,
					title: acp.label("更多操作", "More actions"),
					onClick: () => {
						setOpen((value) => !value);
						setConfirming(false);
					},
					children: "⋯"
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-menu",
					role: "menu",
					children: [canStop && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "menuitem",
						className: "dwa-menu-item",
						onClick: () => {
							close();
							onStop();
						},
						children: acp.label("停止当前运行实例", "Stop Running Process")
					}), confirming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dwa-menu-confirm",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dwa-btn dwa-btn-danger",
							onClick: () => {
								close();
								onRemove();
							},
							children: acp.label("确认移除？", "Confirm remove?")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dwa-btn",
							onClick: () => setConfirming(false),
							children: acp.label("取消", "Cancel")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "menuitem",
						className: "dwa-btn dwa-menu-item dwa-menu-item-danger",
						onClick: () => setConfirming(true),
						children: acp.label("移除配置", "Remove")
					})]
				})]
			});
		}
		/**
		* Measure the id cell on row hover so its CSS marquee can reach the end of the
		* text. The id is the only cell that yields width, and the panel is resizable,
		* so the overflow is re-read on every entry rather than cached. The animation
		* itself lives in CSS and only runs while the row is hovered; `title` on the
		* row stays the fallback for reduced-motion users.
		*/
		function armModelIdMarquee(row) {
			const view = row.querySelector(".dwa-model-row-value");
			const text = view?.querySelector(".dwa-model-row-value-text");
			if (view === null || view === void 0 || text === null || text === void 0) return;
			const fade = Number.parseFloat(getComputedStyle(view).paddingRight) || 0;
			const shift = Math.max(0, text.offsetWidth - (view.clientWidth - fade));
			row.style.setProperty("--dwa-id-shift", `${String(-shift)}px`);
			row.style.setProperty("--dwa-id-duration", `${String(Math.min(4, Math.max(1.2, shift / 30)))}s`);
		}
		/**
		* Model / thought-level catalog display plus the native-selector visibility
		* filter, as a two-pane transfer list: every known model on the left, the
		* selection that reaches the NTR surfaces on the right. Variants are still
		* opt-in — an empty selection is a legitimate state (base entry only) — and
		* edits save themselves (debounced), so there is no apply button and no second
		* dirty state to lose track of.
		*
		* The panes are ALWAYS shown, never gated on a probe: the right side comes from
		* the agent definition (`exposedModels`) and the left from the host's persisted
		* catalog cache, so opening the card shows what is already configured instead
		* of an empty box that costs one click per visit. 「检测可用模型」 therefore
		* sits with the list and acts as a REFRESH of the left pane only — models the
		* agent newly publishes appear, models it stopped advertising drop out.
		*
		* The auto-discovery switch is a per-agent POLICY, not a one-shot action: it
		* appends models the agent NEWLY publishes to the selection (see
		* `AcpAgentDef.autoDiscoverModels`). It saves itself through the lightweight
		* RPC, so flipping it never restarts the agent process.
		*/
		function ModelCatalogBlock({ agentId, detected, acp, active, exposed, onExposedChange, autoDiscover, onAutoDiscoverChange, isDefault }) {
			const ui = useUi$1(acp);
			const [saveError, setSaveError] = (0, react.useState)(void 0);
			const [search, setSearch] = (0, react.useState)("");
			const timer = (0, react.useRef)(void 0);
			const pending = (0, react.useRef)(void 0);
			const hasPending = (0, react.useRef)(false);
			const autoDiscoverBusy = (0, react.useRef)(false);
			const serverValue = (0, react.useRef)(exposed);
			serverValue.current = detected.currentConfig?.exposedModels;
			const probing = ui.probingModels[agentId] === true;
			const probeError = ui.probeErrors[agentId];
			const result = ui.modelCatalogs[agentId];
			const modelChoices = result?.catalog.model?.choices ?? [];
			/** Result of the last click on 「检测可用模型」 (what the refresh changed). */
			const [detectNote, setDetectNote] = (0, react.useState)(void 0);
			const [allCollapsed, setAllCollapsed] = (0, react.useState)(false);
			const [selectedCollapsed, setSelectedCollapsed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!active) return;
				acp.loadCachedModels(agentId);
			}, [active, agentId]);
			(0, react.useEffect)(() => () => {
				if (timer.current === void 0) return;
				clearTimeout(timer.current);
				if (!hasPending.current) return;
				hasPending.current = false;
				acp.setExposedModels(agentId, pending.current).catch(() => {});
			}, []);
			const rollback = (error) => {
				onExposedChange(serverValue.current === void 0 ? void 0 : [...serverValue.current]);
				setSaveError(error instanceof Error ? error.message : String(error));
			};
			/** Persist a filter now (mode switch); a failure restores the editor. */
			const commit = async (next) => {
				setSaveError(void 0);
				try {
					await acp.setExposedModels(agentId, next);
					onExposedChange(next);
				} catch (error) {
					rollback(error);
				}
			};
			/** Persist selection edits after a short idle — several clicks coalesce into one call. */
			const queueExposure = (next) => {
				pending.current = next;
				hasPending.current = true;
				if (timer.current !== void 0) clearTimeout(timer.current);
				timer.current = setTimeout(() => {
					if (!hasPending.current) return;
					hasPending.current = false;
					commit(pending.current);
				}, EXPOSURE_SAVE_DEBOUNCE_MS);
			};
			const toggleAutoDiscover = async (next) => {
				if (autoDiscoverBusy.current) return;
				autoDiscoverBusy.current = true;
				onAutoDiscoverChange(next);
				setSaveError(void 0);
				try {
					await acp.setAutoDiscoverModels(agentId, next);
				} catch (error) {
					onAutoDiscoverChange(!next);
					setSaveError(error instanceof Error ? error.message : String(error));
				} finally {
					autoDiscoverBusy.current = false;
				}
			};
			const query = search.trim().toLowerCase();
			const visibleChoices = query === "" ? modelChoices : modelChoices.filter((choice) => choice.name.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query));
			const basis = exposed ?? [];
			const selected = new Set(basis);
			const selectedChoices = [];
			for (const choice of modelChoices) if (selected.has(choice.value)) selectedChoices.push(choice);
			const listed = new Set(selectedChoices.map((choice) => choice.value));
			for (const value of basis) if (!listed.has(value)) selectedChoices.push({
				value,
				name: value
			});
			const selectedInCatalog = basis.filter((value) => modelChoices.some((choice) => choice.value === value)).length;
			const apply = (next) => {
				onExposedChange(next);
				queueExposure(next);
			};
			const toggleChoice = (value) => {
				apply(selected.has(value) ? basis.filter((v) => v !== value) : [...basis, value]);
			};
			/** Add every model matching the current search that is not selected yet. */
			const addVisible = () => {
				const added = visibleChoices.map((choice) => choice.value).filter((value) => !selected.has(value));
				if (added.length === 0) return;
				apply([...basis, ...added]);
			};
			const clearAll = () => {
				if (basis.length === 0) return;
				apply([]);
			};
			/**
			* Refresh the left pane from the agent: re-probe, then report what moved.
			* The note is what makes the button legible — a refresh that changes nothing
			* looks identical to a dead button otherwise (the catalog `updatedAt` does
			* not even move, since the host keeps the entry when the answer is equal).
			*/
			const detect = async () => {
				const before = new Set(modelChoices.map((choice) => choice.value));
				setDetectNote(void 0);
				await acp.probeModels(agentId);
				const state = acp.getSnapshot();
				if (state.probeErrors[agentId] !== void 0) return;
				const after = state.modelCatalogs[agentId]?.catalog.model?.choices ?? [];
				const afterValues = new Set(after.map((choice) => choice.value));
				const added = after.filter((choice) => !before.has(choice.value)).length;
				const removed = [...before].filter((value) => !afterValues.has(value)).length;
				setDetectNote(added === 0 && removed === 0 ? acp.label("目录无变化", "Catalog unchanged") : acp.label(`新增 ${String(added)} · 移除 ${String(removed)}`, `${String(added)} added · ${String(removed)} removed`));
			};
			const selectionBadge = modelChoices.length > 0 ? acp.label(`已选 ${String(selectedInCatalog)}/${String(modelChoices.length)}`, `Selected ${String(selectedInCatalog)}/${String(modelChoices.length)}`) : acp.label(`已选 ${String(basis.length)}`, `Selected ${String(basis.length)}`);
			const catalogStatus = detectNote ?? (result !== void 0 && result.updatedAt > 0 ? acp.label(`目录更新于 ${formatStamp(result.updatedAt)}`, `Catalog from ${formatStamp(result.updatedAt)}`) : void 0);
			const leftEmptyCopy = visibleChoices.length > 0 ? void 0 : modelChoices.length > 0 ? acp.label("无匹配模型", "No matching models") : result === void 0 ? acp.label("尚未读取模型目录，点「检测可用模型」从 Agent 读取。", "No catalog yet — click \"Detect available models\" to read it from the agent.") : acp.label("该 Agent 未暴露模型选择器（category: model）。", "This agent exposes no model selector (category: model).");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				!isDefault && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dwa-btn",
						onClick: () => void acp.setDefaultAgent(agentId),
						children: acp.label("设为默认智能体", "Set as default agent")
					})
				}),
				isDefault && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-hint",
					style: { marginTop: 8 },
					children: acp.label("当前为默认智能体：新的 NTR 会话由它服务，不影响其他模式的默认模型。", "This is the default agent for new NTR sessions; other modes' default models are untouched.")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-inline-setting",
					style: { marginTop: 12 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dwa-switch",
						title: acp.label("Agent 新发布的模型会自动加入右侧已选列表；首次检测到的目录只作为基线，不会一次性全选。", "Models the agent newly publishes are added to the selected list; the first observed catalog is only a baseline and is not selected wholesale."),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: autoDiscover,
							onChange: (e) => void toggleAutoDiscover(e.target.checked),
							style: {
								margin: 0,
								accentColor: "#2563eb"
							}
						}), acp.label("自动发现新模型", "Auto-discover new models")]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dwa-setting-copy",
						children: acp.label("新增模型自动加入已选列表，现有勾选不受影响。", "New models join the selected list automatically; existing picks are untouched.")
					})]
				}),
				saveError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dwa-error",
					style: { marginTop: 4 },
					children: saveError
				}),
				probeError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-error",
					style: {
						marginTop: 8,
						wordBreak: "break-word"
					},
					children: [
						"⚠ ",
						acp.label("模型检测失败：", "Model detection failed: "),
						probeError
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dwa-model-section",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-model-toolbar",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dwa-form-label",
									children: [acp.label("对话中可见的模型", "Models offered in the conversation"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dwa-hint",
										style: {
											marginLeft: 6,
											fontWeight: 400
										},
										title: acp.label("NTR 模式下的对话只列出这里勾选的模型；未勾选的仍可用——正在生效的那个也会以「· 当前」列出来，其余不列出。", "The NTR surfaces only list what is checked here; unchecked models still work, and the one currently in force is still listed with a \"· current\" row — the rest are not offered."),
										children: acp.label("（NTR 座位 / 芯片的下拉列表）", "(the NTR seat and chip pickers)")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-badge dwa-badge-info",
									children: selectionBadge
								}),
								catalogStatus !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dwa-hint dwa-model-status",
									children: catalogStatus
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-model-toolbar-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dwa-btn dwa-btn-secondary",
										disabled: probing,
										onClick: () => void detect(),
										title: acp.label("重新读取 Agent 的模型目录：新增的加入左侧，已下架的从左侧移除；已选列表不受影响。", "Re-read the agent catalog: newly published models join the left list, withdrawn ones drop out. The selection is untouched."),
										children: probing ? acp.label("模型检测中...", "Probing models...") : acp.label("检测可用模型", "Detect available models")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dwa-input dwa-model-search",
										value: search,
										onChange: (e) => setSearch(e.target.value),
										placeholder: acp.label("搜索模型…", "Search models…")
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dwa-model-transfer",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `dwa-model-pane${allCollapsed ? " is-collapsed" : ""}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-model-pane-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: acp.label("全部模型", "All models") }),
										result !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-badge",
											children: modelChoices.length
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dwa-btn dwa-btn-secondary",
											disabled: visibleChoices.length === 0,
											onClick: addVisible,
											title: acp.label("把当前搜索范围内的模型全部加入右侧", "Add every model matching the current search"),
											children: acp.label("全部加入", "Add all")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dwa-caret-btn",
											"aria-expanded": !allCollapsed,
											onClick: () => setAllCollapsed((value) => !value),
											title: allCollapsed ? acp.label("展开全部模型", "Expand all models") : acp.label("收起全部模型", "Collapse all models"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dwa-caret",
												"aria-hidden": true,
												children: allCollapsed ? "▸" : "▾"
											})
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-model-list",
									children: [visibleChoices.map((choice) => {
										const checked = selected.has(choice.value);
										const title = choice.description === void 0 ? choice.value : `${choice.value}\n${choice.description}`;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: `dwa-model-row${checked ? " is-on" : ""}`,
											title,
											onClick: () => toggleChoice(choice.value),
											onPointerEnter: (event) => {
												armModelIdMarquee(event.currentTarget);
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dwa-model-row-mark",
													children: checked ? "✓" : "+"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dwa-model-row-name",
													children: [choice.group !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: { opacity: .7 },
														children: [choice.group, " · "]
													}), choice.name]
												}),
												choice.value !== choice.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dwa-model-row-value",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dwa-model-row-value-text",
														children: choice.value
													})
												}),
												choice.description !== void 0 && choice.description !== choice.group && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dwa-model-row-desc",
													children: choice.description
												})
											]
										}, choice.value);
									}), leftEmptyCopy !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dwa-hint dwa-model-empty",
										children: leftEmptyCopy
									})]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `dwa-model-pane${selectedCollapsed ? " is-collapsed" : ""}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-model-pane-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: acp.label("已选模型", "Selected models") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dwa-badge dwa-badge-info",
											children: basis.length
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dwa-btn dwa-btn-secondary",
											disabled: basis.length === 0,
											onClick: clearAll,
											children: acp.label("清空", "Clear")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dwa-caret-btn",
											"aria-expanded": !selectedCollapsed,
											onClick: () => setSelectedCollapsed((value) => !value),
											title: selectedCollapsed ? acp.label("展开已选模型", "Expand selected models") : acp.label("收起已选模型", "Collapse selected models"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dwa-caret",
												"aria-hidden": true,
												children: selectedCollapsed ? "▸" : "▾"
											})
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dwa-model-list",
									children: [selectedChoices.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dwa-hint dwa-model-empty",
										children: acp.label("还没有选择模型（点左侧的模型加入）", "Nothing selected yet — pick models on the left")
									}), selectedChoices.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dwa-model-row is-on",
										title: choice.description === void 0 ? choice.value : `${choice.value}\n${choice.description}`,
										onClick: () => toggleChoice(choice.value),
										onPointerEnter: (event) => {
											armModelIdMarquee(event.currentTarget);
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dwa-model-row-name",
												children: [choice.group !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: { opacity: .7 },
													children: [choice.group, " · "]
												}), choice.name]
											}),
											choice.value !== choice.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dwa-model-row-value",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dwa-model-row-value-text",
													children: choice.value
												})
											}),
											choice.description !== void 0 && choice.description !== choice.group && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dwa-model-row-desc",
												children: choice.description
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dwa-model-row-remove",
												"aria-hidden": "true",
												children: "×"
											})
										]
									}, choice.value))]
								})]
							})]
						}),
						result?.catalog.thought !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 4,
								flexWrap: "wrap",
								alignItems: "center"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-form-label",
								children: acp.label("思考等级", "Thought Levels")
							}), result.catalog.thought.choices.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dwa-badge",
								title: choice.description,
								children: choice.name
							}, choice.value))]
						})
					]
				})
			] });
		}
		//#endregion
		//#region src/client/composer-mode.tsx
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
		function useUi(acp) {
			return (0, react.useSyncExternalStore)((cb) => acp.subscribe(cb), () => acp.getSnapshot());
		}
		/**
		* The mode select's tooltip (audit finding F27). It must not call the host's
		* Access mode "complementary": the ACP-mode gate that puts this select on screen
		* also hides that control (`createPermissionSeatClaim` renders nothing in the
		* permission seat), so in the conversation where this appears the Access mode is
		* gone and this select is the mode switch the user actually has.
		*/
		function agentModeTitle(agentId, acp) {
			return acp.label(`agent 模式（${agentId ?? "agent"}）：由 agent 自己定义。NTR 会话里 DSH 的 Access mode 不显示，模式就在此切换。`, `agent mode (${agentId ?? "agent"}): defined by the agent. In an NTR conversation the DSH access mode is not shown, so this is where the mode is switched.`);
		}
		/**
		* agent 下发的模式/配置项说明是英文原文；这里按 id 或 name 换成中文，
		* 未收录的原样返回，保证 agent 换版本时不会显示空白。
		*/
		const ZH_DESCRIPTION_BY_ID = {
			default: "首次使用每个工具时会先向你申请权限。",
			acceptEdits: "本次会话内自动接受文件编辑权限。",
			plan: "只做分析和规划，不修改文件、不执行命令。",
			auto: "由 AI 审查员替你审批每个本该弹窗的动作，由它决定批准还是拒绝。审查失败只拦住那一个动作，不会退回弹窗，也不会离开自动模式。",
			dontAsk: "不弹权限询问：已预批准的动作和安全的只读操作照常执行，其余一律拒绝。",
			bypassPermissions: "跳过所有权限检查，任何动作都直接执行（高风险）。"
		};
		const ZH_DESCRIPTION_BY_NAME = {
			"Always Ask": ZH_DESCRIPTION_BY_ID.default,
			"Accept Edits": ZH_DESCRIPTION_BY_ID.acceptEdits,
			"Plan": ZH_DESCRIPTION_BY_ID.plan,
			"Auto": ZH_DESCRIPTION_BY_ID.auto,
			"Don't Ask": ZH_DESCRIPTION_BY_ID.dontAsk,
			"Bypass Permissions": ZH_DESCRIPTION_BY_ID.bypassPermissions,
			"Full Access": "完全访问：不受任何权限限制，所有动作直接执行。"
		};
		/** 按 id → name 的顺序查中文说明；都没有就回退原文。 */
		function zhDescription(id, name, fallback) {
			if (id !== void 0 && Object.prototype.hasOwnProperty.call(ZH_DESCRIPTION_BY_ID, id)) return ZH_DESCRIPTION_BY_ID[id];
			if (name !== void 0 && Object.prototype.hasOwnProperty.call(ZH_DESCRIPTION_BY_NAME, name)) return ZH_DESCRIPTION_BY_NAME[name];
			return fallback;
		}
		function AcpComposerMode({ acp, sessionId, useSession }) {
			const ui = useUi(acp);
			const dshSessionId = String(sessionId);
			const running = useSession((snapshot) => snapshot.running);
			const [switching, setSwitching] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				acp.loadChatSessions(dshSessionId);
			}, [
				acp,
				dshSessionId,
				running
			]);
			const bound = ui.chatSessionsFor === dshSessionId ? ui.chatSessions : [];
			const target = bound.find((session) => !session.released) ?? bound[0];
			const isAcp = target !== void 0 || ui.acpMode[dshSessionId] === true;
			const agentId = target?.agentId ?? ui.chatLockedAgent[dshSessionId] ?? ui.chatBoundAgent[dshSessionId] ?? ui.chatChoice[dshSessionId]?.agentId ?? (isAcp ? ui.defaultAgent : void 0);
			const catalog = agentId === void 0 ? void 0 : ui.seatCatalogs[agentId];
			(0, react.useEffect)(() => {
				if (!isAcp || agentId === void 0 || target !== void 0) return;
				acp.loadAgentCatalog(agentId);
			}, [
				acp,
				agentId,
				isAcp,
				target
			]);
			const live = target?.modes?.availableModes ?? [];
			const modes = live.length > 0 ? live : (isAcp ? catalog?.mode?.choices ?? [] : []).map((choice) => ({
				id: choice.id,
				name: choice.name,
				description: choice.description
			}));
			const [modeOpen, setModeOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!modeOpen) return;
				const closeOnPointerDown = () => {
					setModeOpen(false);
				};
				document.addEventListener("pointerdown", closeOnPointerDown);
				return () => {
					document.removeEventListener("pointerdown", closeOnPointerDown);
				};
			}, [modeOpen]);
			if (modes.length === 0) return null;
			const persisted = ui.chatChoice[dshSessionId]?.agentId === agentId ? ui.chatChoice[dshSessionId]?.mode : void 0;
			const current = target?.modes?.currentModeId ?? persisted ?? catalog?.mode?.currentValue ?? modes[0]?.id ?? "";
			const modeLabel = (name) => ({
				"Always Ask": "总是询问",
				"Accept Edits": "自动接受编辑",
				"Plan": "计划模式",
				"Auto": "自动审批",
				"Don't Ask": "不再询问",
				"Bypass Permissions": "绕过权限",
				"Full Access": "完全访问",
				"Default": "默认"
			})[name] ?? name;
			const currentMode = modes.find((mode) => mode.id === current);
			const pickMode = (modeId) => {
				setModeOpen(false);
				if (modeId === current) return;
				setSwitching(true);
				acp.setChatSessionMode(dshSessionId, modeId, agentId).finally(() => {
					setSwitching(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					position: "relative",
					display: "inline-flex",
					alignItems: "center",
					fontSize: 12
				},
				title: agentModeTitle(agentId, acp),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"aria-label": acp.label("agent 模式", "agent mode"),
						"aria-haspopup": "listbox",
						"aria-expanded": modeOpen,
						disabled: switching,
						onClick: () => {
							setModeOpen((open) => !open);
						},
						style: {
							font: "inherit",
							fontSize: 12,
							padding: "2px 8px",
							borderRadius: 6,
							border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
							background: "transparent",
							color: "inherit",
							cursor: switching ? "default" : "pointer",
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							maxWidth: 200
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: modeLabel(currentMode !== void 0 ? currentMode.name ?? current : current)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 10,
									opacity: 0.55
								},
								children: "▾"
							})
						]
					}),
					modeOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "listbox",
						style: {
							position: "absolute",
							bottom: "calc(100% + 4px)",
							left: 0,
							zIndex: 60,
							minWidth: 168,
							padding: 4,
							borderRadius: 8,
							border: "1px solid var(--dsw-alias-border-l1, #d1d5db)",
							background: "var(--dsw-alias-bg-layer-1, #ffffff)",
							color: "var(--dsw-alias-text-primary, inherit)",
							boxShadow: "var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.24))",
							display: "flex",
							flexDirection: "column",
							gap: 2
						},
						children: modes.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "option",
							"aria-selected": mode.id === current,
							title: zhDescription(mode.id, mode.name, mode.description),
							onPointerDown: (event) => {
								event.preventDefault();
								event.stopPropagation();
								pickMode(mode.id);
							},
							style: {
								textAlign: "left",
								font: "inherit",
								fontSize: 12,
								padding: "5px 8px",
								borderRadius: 6,
								border: "none",
								background: mode.id === current ? "var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.18))" : "transparent",
								color: "inherit",
								cursor: "pointer",
								whiteSpace: "nowrap"
							},
							children: modeLabel(mode.name !== null && mode.name !== void 0 ? mode.name : mode.id)
						}, mode.id))
					})
				]
			});
		}
		const phases = /* @__PURE__ */ new Map();
		/** The reveal serial whose ceremony has already played (or was skipped). */
		const consumed = /* @__PURE__ */ new Map();
		const listeners = /* @__PURE__ */ new Set();
		let version = 0;
		let epochSeq = 0;
		function emit() {
			version += 1;
			for (const listener of [...listeners]) listener();
		}
		function reducedMotion() {
			return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		}
		/**
		* The phase for one conversation. `reveal` is the store's lock-reveal serial
		* for it (absent for a conversation this page never saw lock). A brand-new,
		* not-yet-consumed reveal reads as `shatter` so the commit after the lock
		* already renders the shattering base rather than briefly rendering neither
		* surface. An active ceremony only answers for its OWN reveal: a retry after a
		* rolled-back first turn is a new reveal and must start from `shatter`.
		*/
		function agentLockPhaseOf(sessionId, reveal) {
			const active = phases.get(sessionId);
			if (active !== void 0 && active.reveal === reveal) return active.phase;
			if (reveal === void 0 || consumed.get(sessionId) === reveal || reducedMotion()) return "idle";
			return "shatter";
		}
		/**
		* Start the ceremony for a reveal this page witnessed. Idempotent for the same
		* reveal (both slots call it from an effect); a newer reveal supersedes a
		* running older one, whose timers are fenced by the epoch check.
		*/
		function playAgentLockAnim(sessionId, reveal) {
			if (phases.get(sessionId)?.reveal === reveal || consumed.get(sessionId) === reveal) return;
			if (reducedMotion()) {
				phases.delete(sessionId);
				consumed.set(sessionId, reveal);
				emit();
				return;
			}
			const epoch = ++epochSeq;
			phases.set(sessionId, {
				phase: "shatter",
				reveal,
				epoch
			});
			emit();
			setTimeout(() => {
				const current = phases.get(sessionId);
				if (current === void 0 || current.epoch !== epoch || current.phase !== "shatter") return;
				phases.set(sessionId, {
					...current,
					phase: "form"
				});
				emit();
				setTimeout(() => {
					const done = phases.get(sessionId);
					if (done === void 0 || done.epoch !== epoch || done.phase !== "form") return;
					phases.delete(sessionId);
					consumed.set(sessionId, reveal);
					emit();
				}, 540);
			}, 460);
		}
		/** Subscribe to phase changes (one global clock shared by both slots). */
		function useAgentLockPhase(sessionId, reveal) {
			(0, react.useSyncExternalStore)((cb) => {
				listeners.add(cb);
				return () => {
					listeners.delete(cb);
				};
			}, () => version);
			return agentLockPhaseOf(sessionId, reveal);
		}
		//#endregion
		//#region src/client/session-controls.tsx
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
		const STATE_COLORS = {
			ready: "#22c55e",
			starting: "#eab308",
			error: "#ef4444",
			stopped: "#9ca3af"
		};
		function agentStateText(acp, state) {
			switch (state) {
				case "ready": return acp.label("已连接", "connected");
				case "starting": return acp.label("启动中", "starting");
				case "error": return acp.label("错误", "error");
				default: return acp.label("未启动", "not running");
			}
		}
		/** The live (non-released) ACP session bound to this chat, if any. */
		function boundSession$1(ui, sessionId) {
			if (ui.chatSessionsFor !== sessionId) return void 0;
			return ui.chatSessions.find((session) => !session.released) ?? ui.chatSessions[0];
		}
		/**
		* The agent serving this conversation: the plugin's own binding first (who
		* serves the NEXT message — the host reports it per chat session), then the
		* agent an ACP session for this conversation is already served by, then the
		* plugin's default — which is what lets a chip offer "use ACP: <agent>" for a
		* conversation that has never been routed, instead of going blank. The binding
		* outranks the live session because a switch applies from the next message:
		* until that turn materializes a session for the new agent, the live list still
		* names the previous one, and the chip must not read as "the click did nothing".
		*
		* `undefined` IS an answer, not a gap: with no binding, no live session and no
		* plugin default the guard's route rewrite has nothing to rewrite with and the
		* turn runs on the deployment default provider (see `boundModelFor` in
		* presets/acp/acp-guard.mjs). This function used to end in `agents[0]?.id`,
		* which put the first configured agent on the chip in exactly that state — a
		* name no message would ever reach (audit finding F5). The honest chip there is
		* the "选择 Agent" entry point, not a borrowed name.
		*/
		function routeAgentId(boundAgentId, bound, agents, defaultAgent) {
			if (boundAgentId !== void 0 && agents.some((agent) => agent.id === boundAgentId)) return boundAgentId;
			if (bound?.agentId !== void 0) return bound.agentId;
			if (defaultAgent !== void 0 && agents.some((agent) => agent.id === defaultAgent)) return defaultAgent;
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
		function agentBaseHasData(bound, agents, rosterLoaded) {
			return bound !== void 0 || agents.length > 0 || rosterLoaded;
		}
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
		function lockedAgentOf(hostLockedAgentId, bound) {
			return hostLockedAgentId ?? bound?.agentId;
		}
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
		function agentBaseHidden(lockedTo) {
			return lockedTo !== void 0;
		}
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
		function agentTagVisible(acpMode, lockedTo) {
			return (acpMode ?? true) && lockedTo !== void 0;
		}
		/**
		* Whether the tagged agent is LIVE: an ACP session serves this conversation
		* right now and it is not released (the process is up, or at least the host
		* has not marked the session suspended). This drives the tag's breathing
		* halo — released must turn it off, and the named agent must be the one the
		* live session actually serves. No session view at all reads as not alive:
		* before the first answer the state says nothing about the process.
		*/
		function agentTagAlive(bound, lockedTo) {
			return bound !== void 0 && !bound.released && bound.agentId === lockedTo;
		}
		/** One breath cycle per halo speed, in seconds. Settings card offers these three. */
		const TAG_HALO_PERIODS = {
			slow: "5.2s",
			normal: "3.2s",
			fast: "1.2s"
		};
		/**
		* The tag's halo presentation for one setting: the extra classes for the tag
		* span (`alive` — the session is live; steady mode replaces the pulse with a
		* constant glow) and the CSS variable the stylesheet reads for the period.
		* The variable is set for breath mode only: in steady mode nothing animates,
		* so a stale variable could never leak into the reduced-motion fallback.
		*/
		function agentTagHaloPresentation(halo, alive) {
			if (!alive) return {
				classes: "",
				style: {}
			};
			if (halo.mode === "steady") return {
				classes: " is-alive is-steady",
				style: {}
			};
			return {
				classes: " is-alive",
				style: { "--ntr-halo-period": TAG_HALO_PERIODS[halo.speed] }
			};
		}
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
		function describeRoute(agents, bound, defaultAgent, catalog, boundAgentId, choice) {
			const agentId = routeAgentId(boundAgentId, bound, agents, defaultAgent);
			if (agentId === void 0) return { efforts: [] };
			const agentTitle = agents.find((agent) => agent.id === agentId)?.title ?? bound?.agentTitle ?? catalog?.title ?? agentId;
			const pick = choice !== void 0 && choice.agentId === agentId ? choice : void 0;
			const modelId = bound?.modelId ?? pick?.modelId;
			const effort = bound?.reasoningEffort ?? pick?.effort;
			const reasoning = catalog?.reasoning;
			const agentModel = catalog?.currentModel;
			if (bound === void 0 && pick === void 0 && agentModel === void 0) return {
				agentId,
				agentTitle,
				efforts: []
			};
			const parsed = splitAcpModelId(modelId ?? "");
			const variant = catalog?.variants.find((entry) => entry.id === modelId);
			const currentName = catalog?.currentModel !== void 0 && parsed.choice === catalog.currentModel.value ? catalog.currentModel.name : void 0;
			const effectiveEffort = effort ?? reasoning?.defaultEffort;
			const modelLabel = modelId === void 0 ? agentModel?.name : parsed.choice === void 0 ? agentModel?.name ?? catalog?.base.name ?? agentTitle : variant?.name ?? currentName ?? parsed.choice;
			return {
				agentId,
				agentTitle,
				...modelId === void 0 ? {} : { modelId },
				...modelLabel === void 0 ? {} : { modelLabel },
				efforts: reasoning?.efforts ?? [],
				...effectiveEffort === void 0 ? {} : { effectiveEffort },
				...effectiveEffort === void 0 ? {} : { effortLabel: reasoning?.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort }
			};
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
		function advancedOptions(catalog, choice) {
			const extras = catalog?.extras ?? [];
			if (catalog === void 0 || extras.length === 0) return [];
			const picked = choice !== void 0 && choice.agentId === catalog.agentId ? choice.extraConfigs : void 0;
			return extras.map((option) => {
				const raw = picked?.[option.configId] ?? option.currentValue;
				const value = typeof raw === "boolean" ? raw ? "true" : "false" : raw;
				return {
					configId: option.configId,
					name: option.name,
					...option.kind === "boolean" ? { kind: "boolean" } : {},
					...value === void 0 ? {} : { value },
					choices: option.choices
				};
			});
		}
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
		function agentBaseChip(route, routed, acp, rosterEmpty = false) {
			return {
				label: route.agentTitle === void 0 ? routed ? "NTR" : acp.label("选择 Agent", "Choose agent") : `NTR · ${route.agentTitle}`,
				title: route.agentId === void 0 ? rosterEmpty ? acp.label("这条会话当前没有 NTR agent；点开可前往 NTR 设置添加", "No NTR agent is serving this conversation — open to set one up in NTR settings") : acp.label("这条会话当前没有 NTR agent 服务；点开可选择 agent", "No NTR agent is serving this conversation right now — open to choose one") : acp.label("这条会话由外接 NTR agent 服务；点开可切换 agent", "This conversation is served by an external NTR agent — open to switch the agent")
			};
		}
		/**
		* The composer-edge tag's label and tooltip.
		*
		* This tag is where the agent identity lives once the composer base steps
		* aside (see `agentBaseHidden`), so it names the agent unconditionally — the
		* caller only mounts it when the conversation is locked. It is a nameplate,
		* not a control: the tooltip says the lock is one-way and points at the only
		* way to use another agent (a new conversation).
		*/
		function agentTagChip(agentTitle, acp) {
			return {
				label: `NTR · ${agentTitle}`,
				title: acp.label(`这条会话已锁定在 ${agentTitle}；首轮开始后不能切换 agent（上下文属于它）。换 agent 请新建会话。`, `This conversation is locked to ${agentTitle}. It cannot switch agents once the first turn has started — the context belongs to it. Start a new conversation to use another agent.`)
			};
		}
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
		function AcpComposerAgentTag(props) {
			ensureAcpStyle();
			const { acp, sessionId, useSession } = props;
			const ui = useUi$2(acp);
			const running = useSession((snapshot) => snapshot.running);
			(0, react.useEffect)(() => {
				acp.loadChatSessions(sessionId);
			}, [
				acp,
				sessionId,
				running
			]);
			const bound = boundSession$1(ui, sessionId);
			const lockedTo = lockedAgentOf(ui.chatLockedAgent[sessionId], bound);
			const reveal = ui.agentLockReveal[sessionId];
			const phase = useAgentLockPhase(sessionId, reveal);
			(0, react.useEffect)(() => {
				if (reveal !== void 0) playAgentLockAnim(sessionId, reveal);
			}, [reveal, sessionId]);
			if (phase === "shatter") return null;
			if (!agentTagVisible(ui.acpMode[sessionId], lockedTo) || lockedTo === void 0) return null;
			const agentTitle = ui.agents.find((agent) => agent.id === lockedTo)?.title ?? bound?.agentTitle ?? lockedTo;
			const alive = phase !== "form" && agentTagAlive(bound, lockedTo);
			const halo = agentTagHaloPresentation(ui.tagHalo, alive);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `ntr-acp-tag${phase === "form" ? " is-forming" : ""}${halo.classes}`,
				style: halo.style,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpChip, {
					...agentTagChip(agentTitle, acp),
					children: phase === "form" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpShatterParts, { mode: "in" })
				})
			});
		}
		/** The composer cluster: agent, model and thought level — or nothing at all. */
		function AcpSessionControls(props) {
			ensureAcpStyle();
			const { acp, sessionId, useSession } = props;
			const ui = useUi$2(acp);
			const running = useSession((snapshot) => snapshot.running);
			const menu = useAcpMenu();
			(0, react.useEffect)(() => {
				acp.loadChatSessions(sessionId);
			}, [
				acp,
				sessionId,
				running
			]);
			const bound = boundSession$1(ui, sessionId);
			const agents = ui.agents;
			const choice = ui.chatChoice[sessionId];
			const lockedTo = lockedAgentOf(ui.chatLockedAgent[sessionId], bound);
			const reveal = ui.agentLockReveal[sessionId];
			const lockPhase = useAgentLockPhase(sessionId, reveal);
			(0, react.useEffect)(() => {
				if (reveal !== void 0) playAgentLockAnim(sessionId, reveal);
			}, [reveal, sessionId]);
			const agentId = lockedTo ?? routeAgentId(ui.chatBoundAgent[sessionId], bound, agents, ui.defaultAgent);
			const agentListed = agentId !== void 0 && agents.some((agent) => agent.id === agentId);
			const catalog = agentListed ? ui.seatCatalogs[agentId] : void 0;
			const served = agentId !== void 0;
			(0, react.useEffect)(() => {
				if (served && agentListed && agentId !== void 0) acp.loadAgentCatalog(agentId);
			}, [
				acp,
				served,
				agentListed,
				agentId
			]);
			const route = describeRoute(agents, bound, lockedTo === void 0 ? ui.defaultAgent : void 0, catalog, lockedTo ?? ui.chatBoundAgent[sessionId], choice);
			if (!agentBaseHasData(bound, agents, ui.agentsLoaded)) return null;
			const routed = route.agentId !== void 0;
			(0, react.useEffect)(() => {
				if (lockedTo === void 0 || menu === null) return;
				if (menu.sessionId === sessionId && menu.kind === "agent") closeAcpMenu();
			}, [
				lockedTo,
				menu?.sessionId,
				menu?.kind,
				sessionId
			]);
			const shattering = lockPhase === "shatter" && lockedTo !== void 0;
			const showAgentBase = !agentBaseHidden(lockedTo) || shattering;
			const modelLabel = routed ? route.modelLabel : void 0;
			const showModel = agentListed && modelLabel !== void 0;
			const showThought = agentListed && routed && route.efforts.length > 0;
			const extras = advancedOptions(catalog, choice);
			const showAdvanced = agentListed && routed && extras.length > 0;
			if (!showAgentBase && !showAdvanced && !showModel && !showThought) return null;
			const open = (kind, trigger) => {
				openAcpMenu(sessionId, kind, trigger);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "ntr-acp-cluster",
				children: [
					showAdvanced && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpChip, {
						label: `${acp.label("高级", "Advanced")} · ${String(extras.length)}`,
						title: acp.label(`agent 的额外配置项：${extras.map((option) => option.name).join("、")}`, `extra agent config options: ${extras.map((option) => option.name).join(", ")}`),
						active: menu?.sessionId === sessionId && menu.kind === "advanced",
						onClick: (trigger) => {
							open("advanced", trigger);
						}
					}),
					showModel && modelLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpChip, {
						label: modelLabel,
						title: acp.label("agent 自己的模型目录", "the agent's own model directory"),
						active: menu?.sessionId === sessionId && menu.kind === "model",
						onClick: (trigger) => {
							open("model", trigger);
						}
					}),
					showThought && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpChip, {
						label: `${acp.label("思考", "think")} · ${route.effortLabel ?? acp.label("默认", "default")}`,
						title: acp.label("思考等级（agent 的 thought_level）", "Thought level (the agent's thought_level)"),
						active: menu?.sessionId === sessionId && menu.kind === "thought",
						onClick: (trigger) => {
							open("thought", trigger);
						}
					}),
					showAgentBase && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpChip, {
						...agentBaseChip(route, routed, acp, agents.length === 0),
						active: routed,
						className: shattering ? "ntr-acp-shatter" : void 0,
						onClick: shattering ? void 0 : (trigger) => {
							open("agent", trigger);
						},
						children: shattering && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpShatterParts, { mode: "out" })
					})
				]
			});
		}
		/**
		* The model picker's explicit refresh row. It is an ACTION, not a model: the
		* pick handler intercepts it and probes the agent instead of recording a pick.
		* The id cannot collide with a real row — agent ids match
		* `[a-z0-9][a-z0-9._-]{0,63}` (no underscores) and variant ids always carry
		* `agentId@value`.
		*/
		const REFRESH_CATALOG_ITEM = "__refresh-catalog__";
		/**
		* The empty roster's setup action. Like the model picker's refresh row it is an
		* ACTION inside the picker, not an agent: agent ids match
		* `[a-z0-9][a-z0-9._-]{0,63}` (no leading underscore), so no real id can
		* collide with it.
		*/
		const OPEN_SETTINGS_ITEM = "__open-settings__";
		/** The agent roster rows: one row per configured ACP agent, current one marked. */
		function agentSection(context) {
			const { acp, route } = context;
			const items = context.agents.map((agent) => ({
				id: agent.id,
				label: agent.title ?? agent.id,
				detail: agentStateText(acp, agent.state),
				dot: STATE_COLORS[agent.state],
				active: route.agentId === agent.id
			}));
			if (items.length === 0) {
				items.push({
					id: "none",
					label: acp.label("还没有配置 NTR agent", "No NTR agent configured yet"),
					detail: acp.label("添加并启用一个 agent 后即可开始对话", "Add and enable an agent to start"),
					disabled: true
				});
				items.push({
					id: OPEN_SETTINGS_ITEM,
					label: acp.label("打开 NTR 设置", "Open NTR settings"),
					detail: acp.label("添加或启用 agent", "Add or enable an agent")
				});
			}
			return {
				id: "agent",
				items
			};
		}
		/**
		* The selected agent's OWN models — `undefined` when no agent is known yet.
		*
		* The rows come from `agent/catalog`, not from any DSH model directory: ACP
		* models are not advertised in DSH's catalog at all, and the exposure filter
		* (`exposedModels`) is applied host-side, so what arrives here is exactly what
		* this agent offers in this conversation.
		*
		* ONE ROW PER MODEL, and the checked row names its model (user report,
		* 2026-10-18). The bare `agentId` route ("let the agent choose") is NOT a model,
		* so it is folded onto the row of the model it currently resolves to: the
		* previous shape listed `<agent> · 默认` AND `<agent> · Hy3` as two entries for
		* one model, and the checked one was the row that did not say "Hy3".
		*/
		function modelSection(context) {
			const { acp, route, catalog } = context;
			if (route.agentId === void 0) return void 0;
			const refresh = {
				id: REFRESH_CATALOG_ITEM,
				label: context.probing === true ? acp.label("正在检测…", "Detecting…") : acp.label("刷新目录", "Refresh list"),
				detail: acp.label("向 agent 重新读取模型列表", "re-read the model list from the agent"),
				disabled: context.probing === true
			};
			if (catalog === void 0) {
				const items = route.modelId === void 0 ? [] : [{
					id: route.modelId,
					label: route.modelLabel ?? route.modelId,
					active: true
				}];
				items.push(refresh);
				return {
					id: "model",
					title: acp.label(`${route.agentTitle ?? "agent"} 的模型`, `Models of ${route.agentTitle ?? "the agent"}`),
					items
				};
			}
			const pickedChoice = splitAcpModelId(route.modelId ?? "").choice;
			const current = catalog.currentModel;
			const inForce = pickedChoice ?? current?.value;
			const offered = /* @__PURE__ */ new Map();
			for (const variant of catalog.variants) {
				const value = splitAcpModelId(variant.id).choice;
				if (value === void 0) continue;
				offered.set(value, {
					id: variant.id,
					label: variant.name,
					...variant.description === void 0 ? {} : { detail: variant.description },
					active: value === inForce
				});
			}
			const rows = [];
			if (inForce !== void 0 && !offered.has(inForce)) rows.push({
				id: buildAcpModelId(route.agentId, inForce),
				label: `${inForce === current?.value ? current?.name ?? inForce : route.modelLabel ?? inForce} · ${acp.label("当前", "current")}`,
				detail: acp.label("不在此列表出的模型里：可能在「设置 → NTR」里取消了勾选，也可能已从 agent 的目录掉出；若 agent 已不再提供，发送会被拒绝，请改选或用「刷新目录」重新读取。", "Not among the models listed here: it may be unchecked in Settings → NTR, or it may have dropped out of the agent's catalog. If the agent no longer offers it, sending is refused — pick another model or use Refresh list to re-read the directory."),
				active: true
			});
			if (current === void 0) rows.push({
				id: catalog.base.id,
				label: `${catalog.base.name} · ${acp.label("默认", "default")}`,
				...catalog.base.description === void 0 ? {} : { detail: catalog.base.description },
				active: inForce === void 0
			});
			rows.push(...offered.values());
			rows.push(refresh);
			return {
				id: "model",
				title: acp.label(`${route.agentTitle ?? "agent"} 的模型`, `Models of ${route.agentTitle ?? "the agent"}`),
				note: catalog.variants.length === 0 ? acp.label("agent 自己上报的模型目录；这里只列出它当前用的模型，其余可在「设置 → NTR」里勾选可见。", "The agent's own model directory; only the model it is on is offered here — enable more in Settings → NTR.") : acp.label("agent 自己上报的模型目录；勾选的那条就是这条会话正在用的模型。", "The agent's own model directory; the checked row is the model this conversation is running."),
				items: rows
			};
		}
		/** The agent's `thought_level` levels (its own vocabulary). */
		function thoughtSection(context) {
			const { acp, route } = context;
			const items = [{
				id: "provider-default",
				label: acp.label("跟随 agent 默认", "Agent default"),
				active: route.effectiveEffort === void 0
			}];
			for (const level of route.efforts) items.push({
				id: level.id,
				label: level.name,
				...level.description === void 0 ? {} : { detail: level.description },
				active: level.id === route.effectiveEffort
			});
			return {
				id: "thought",
				title: acp.label("思考等级", "Thought level"),
				note: acp.label("由 agent 的 thought_level 配置项驱动，下一次请求生效。", "Driven by the agent's own thought_level option; applies to the next request."),
				items
			};
		}
		/**
		* The advanced base's sections: one per extra config option.
		*
		* Section ids carry a `config:` prefix because `AcpMenu.onPick` hands the
		* section id back and the other pickers already own `agent` / `model` /
		* `thought` — an agent could legitimately name one of its options `model`,
		* and the pick would then be read as the primary model axis.
		*/
		function advancedSections(context) {
			return advancedOptions(context.catalog, context.choice).map((option) => {
				if (option.kind === "boolean") {
					const checked = option.value === "true";
					return {
						id: `config:${option.configId}`,
						items: [{
							id: checked ? "false" : "true",
							label: option.name,
							active: checked,
							checkbox: true
						}]
					};
				}
				return {
					id: `config:${option.configId}`,
					title: option.name,
					items: option.choices.map((choice) => {
						const detail = zhDescription(choice.id, choice.name, choice.description);
						return {
							id: choice.id,
							label: choice.name,
							...detail === void 0 ? {} : { detail },
							active: choice.id === option.value
						};
					})
				};
			});
		}
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
		function menuFor(kind, context) {
			const { acp, route } = context;
			if (kind === "agent") return {
				title: acp.label("选择你的 Agent", "Choose your agent"),
				sections: [{
					...agentSection(context),
					title: void 0,
					note: void 0
				}]
			};
			if (kind === "model") {
				const section = modelSection(context);
				if (section === void 0) return {
					title: acp.label("模型", "Models"),
					sections: []
				};
				return {
					title: section.title ?? acp.label("模型", "Models"),
					note: section.note,
					sections: [{
						...section,
						title: void 0,
						note: void 0
					}]
				};
			}
			if (kind === "thought") {
				const section = thoughtSection(context);
				return {
					title: section.title ?? acp.label("思考等级", "Thought level"),
					note: section.note,
					sections: [{
						...section,
						title: void 0,
						note: void 0
					}]
				};
			}
			if (kind === "advanced") return {
				title: acp.label("高级选项", "Advanced options"),
				note: acp.label("agent 自己发布的额外配置项；选中只作用于这条会话，下一条消息生效。", "Extra config options published by the agent; a pick belongs to this conversation and applies from the next message."),
				sections: advancedSections(context)
			};
			return {
				title: acp.label("NTR", "NTR"),
				sections: []
			};
		}
		/**
		* The picker itself, living in the composer's overlay seat. It renders nothing
		* unless a chip of THIS session opened it, so a stale menu can never leak
		* across a session switch.
		*/
		function AcpSessionMenu(props) {
			ensureAcpStyle();
			const { acp, sessionId } = props;
			const ui = useUi$2(acp);
			const menu = useAcpMenu();
			const [busy, setBusy] = (0, react.useState)(false);
			const bound = boundSession$1(ui, sessionId);
			const agents = ui.agents;
			const choice = ui.chatChoice[sessionId];
			const lockedTo = lockedAgentOf(ui.chatLockedAgent[sessionId], bound);
			const agentId = lockedTo ?? routeAgentId(ui.chatBoundAgent[sessionId], bound, agents, ui.defaultAgent);
			const catalog = agentId === void 0 ? void 0 : ui.seatCatalogs[agentId];
			const served = agentId !== void 0;
			(0, react.useEffect)(() => {
				if (menu !== null && served && agentId !== void 0) acp.loadAgentCatalog(agentId);
			}, [
				acp,
				menu,
				served,
				agentId
			]);
			if (menu === null || menu.sessionId !== sessionId) return null;
			const route = describeRoute(agents, bound, lockedTo === void 0 ? ui.defaultAgent : void 0, catalog, lockedTo ?? ui.chatBoundAgent[sessionId], choice);
			let model;
			try {
				const probing = menu.kind === "model" && agentId !== void 0 && ui.probingModels[agentId] === true;
				const menuError = menu.error ?? (menu.kind === "model" && agentId !== void 0 ? ui.probeErrors[agentId] : void 0);
				model = menuFor(menu.kind, {
					acp,
					agents,
					route,
					...catalog === void 0 ? {} : { catalog },
					...choice === void 0 ? {} : { choice },
					...probing ? { probing: true } : {},
					...menuError === void 0 ? {} : { error: menuError }
				});
			} catch (error) {
				model = {
					title: acp.label("NTR", "NTR"),
					sections: [],
					error: error instanceof Error ? error.message : String(error)
				};
			}
			const pick = async (sectionId, itemId) => {
				try {
					if (sectionId === "model" && itemId === "__refresh-catalog__") {
						if (agentId !== void 0) await acp.probeModels(agentId);
						return;
					}
					if (sectionId === "agent" && itemId === "__open-settings__") {
						closeAcpMenu();
						openAcpSettingsDialog();
						return;
					}
					if (sectionId === "agent") await acp.bindChatAgent(sessionId, itemId);
					else if (sectionId === "model") await acp.setChatSessionModel(sessionId, itemId, agentId);
					else if (sectionId === "thought") await acp.setChatSessionEffort(sessionId, itemId === "provider-default" ? void 0 : itemId, agentId);
					else if (sectionId.startsWith("config:")) await acp.setChatSessionConfig(sessionId, sectionId.slice(7), itemId, agentId);
					else return;
					await acp.loadChatSessions(sessionId);
					closeAcpMenu();
				} catch (error) {
					setAcpMenuError(error instanceof Error ? error.message : String(error));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpMenu, {
				model,
				anchor: menu.trigger,
				onPick: (itemId, sectionId) => {
					if (busy) return;
					setAcpMenuError(void 0);
					setBusy(true);
					pick(sectionId, itemId).finally(() => {
						setBusy(false);
					});
				},
				onClose: () => {
					closeAcpMenu();
				}
			});
		}
		//#endregion
		//#region src/client/acp-view.tsx
		/** Glyph per ACP tool kind, so a call's nature reads before its title does. */
		const TOOL_GLYPH = {
			read: "📖",
			edit: "✏️",
			delete: "🗑️",
			move: "📦",
			search: "🔍",
			execute: "⌨️",
			think: "🧠",
			fetch: "🌐",
			switch_mode: "⇄",
			other: "🛠️"
		};
		/** Tone class per ACP tool status. */
		const STATUS_TONE = {
			pending: "idle",
			in_progress: "busy",
			completed: "done",
			failed: "fail"
		};
		/** Cap on the rendered diff matrix: beyond it, show the edit as remove-all/add-all. */
		const DIFF_LCS_LIMIT = 300;
		/** Tool output lines shown before the "show all" toggle appears. */
		const TOOL_LINES_CLIP = 12;
		/** Split a text payload into lines, tolerating an empty / null side. */
		function linesOf(text) {
			if (text === null || text === "") return [];
			return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
		}
		/**
		* Line diff with a common prefix/suffix trim plus an LCS over the remaining
		* middle — the standard shape that keeps an edit reviewable without pulling a
		* diff library into a browser bundle.
		*/
		function diffRows(oldText, newText) {
			const oldLines = linesOf(oldText);
			const newLines = linesOf(newText);
			const rows = [];
			let start = 0;
			while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
			let tail = 0;
			while (tail < oldLines.length - start && tail < newLines.length - start && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
			for (let i = 0; i < start; i++) rows.push({
				sign: " ",
				text: oldLines[i]
			});
			const oldMiddle = oldLines.slice(start, oldLines.length - tail);
			const newMiddle = newLines.slice(start, newLines.length - tail);
			if (oldMiddle.length > DIFF_LCS_LIMIT || newMiddle.length > DIFF_LCS_LIMIT) {
				for (const text of oldMiddle) rows.push({
					sign: "-",
					text
				});
				for (const text of newMiddle) rows.push({
					sign: "+",
					text
				});
			} else rows.push(...lcsRows(oldMiddle, newMiddle));
			for (let i = tail; i > 0; i--) rows.push({
				sign: " ",
				text: oldLines[oldLines.length - i]
			});
			return rows;
		}
		/** LCS line alignment of two short blocks (DP table, bounded by the caller). */
		function lcsRows(oldLines, newLines) {
			const rows = oldLines.length;
			const cols = newLines.length;
			const table = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
			for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--) {
				const row = table[i];
				const below = table[i + 1];
				row[j] = oldLines[i] === newLines[j] ? below[j + 1] + 1 : Math.max(below[j], row[j + 1]);
			}
			const out = [];
			let i = 0;
			let j = 0;
			while (i < rows && j < cols) if (oldLines[i] === newLines[j]) {
				out.push({
					sign: " ",
					text: oldLines[i]
				});
				i++;
				j++;
			} else if (table[i + 1][j] >= table[i][j + 1]) {
				out.push({
					sign: "-",
					text: oldLines[i]
				});
				i++;
			} else {
				out.push({
					sign: "+",
					text: newLines[j]
				});
				j++;
			}
			while (i < rows) {
				out.push({
					sign: "-",
					text: oldLines[i]
				});
				i++;
			}
			while (j < cols) {
				out.push({
					sign: "+",
					text: newLines[j]
				});
				j++;
			}
			return out;
		}
		/** Inline `code` and **bold** spans; everything else stays literal text. */
		function inlineNodes(text) {
			const out = [];
			const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
			let last = 0;
			let match;
			let key = 0;
			while ((match = pattern.exec(text)) !== null) {
				if (match.index > last) out.push(text.slice(last, match.index));
				const token = match[0];
				key++;
				if (token.startsWith("`")) out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
					className: "ntr-acp-inline-code",
					children: token.slice(1, -1)
				}, key));
				else out.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: token.slice(2, -2) }, key));
				last = match.index + token.length;
			}
			if (last < text.length) out.push(text.slice(last));
			return out;
		}
		/** Fenced-code-aware text body: agent prose without a markdown dependency. */
		function RichText({ text }) {
			const parts = text.split("```");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: parts.map((part, index) => index % 2 === 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: "ntr-acp-code",
				children: part.replace(/^[a-zA-Z0-9_-]*\n/, "")
			}, index) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: inlineNodes(part) }, index)) });
		}
		/**
		* Whether one structured edit is a NEW FILE.
		*
		* Decided by the old side, never by the removal count: an existing file that
		* only gained lines also diffs to zero removals, and labelling that "new file"
		* hid a real edit behind a wrong badge (the audit's F8). The only old sides
		* that mean "nothing was there" are an absent one and one byte-identical to
		* the new content — the degenerate case where there is no edit at all.
		*/
		function isNewFileDiff(oldText, newText) {
			return oldText === null || oldText === "" || oldText === newText;
		}
		/** One structured edit, rendered as a unified diff. */
		function DiffView({ diff, t }) {
			const rows = diffRows(diff.oldText, diff.newText);
			const added = rows.filter((row) => row.sign === "+").length;
			const removed = rows.filter((row) => row.sign === "-").length;
			const isNewFile = isNewFileDiff(diff.oldText, diff.newText);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ntr-acp-diff",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-diff-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-diff-path",
							children: diff.path
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "ntr-acp-diff-stats",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "is-add",
									children: ["+", added]
								}),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "is-del",
									children: ["-", removed]
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-diff-body",
						children: rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `ntr-acp-diff-row is-${row.sign === "+" ? "add" : row.sign === "-" ? "del" : "ctx"}`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ntr-acp-diff-sign",
								children: row.sign
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ntr-acp-diff-text",
								children: row.text
							})]
						}, index))
					}),
					isNewFile && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-diff-note",
						children: t("新增文件", "new file")
					})
				]
			});
		}
		/** One tool call: header, arguments, text output, unknown payloads, and any structured edits it carried. */
		function ToolCard({ block, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [rawOpen, setRawOpen] = (0, react.useState)(false);
			const glyph = TOOL_GLYPH[block.toolKind ?? "other"] ?? TOOL_GLYPH.other;
			const tone = STATUS_TONE[block.status] ?? "idle";
			const clipped = !expanded && block.lines.length > TOOL_LINES_CLIP;
			const shown = clipped ? block.lines.slice(0, TOOL_LINES_CLIP) : block.lines;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `ntr-acp-tool is-${tone}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-tool-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": true,
								children: glyph
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "ntr-acp-tool-title",
								children: block.title === "" ? block.toolCallId : block.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `ntr-acp-badge is-${tone}`,
								children: block.status
							})
						]
					}),
					block.input !== void 0 && block.input !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body ntr-acp-tool-input",
						children: block.input
					}),
					block.details !== void 0 && block.details.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body ntr-acp-tool-meta",
						children: block.details.join("\n")
					}),
					shown.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body",
						children: `${shown.join("\n")}${clipped ? "\n…" : ""}`
					}),
					block.extras !== void 0 && block.extras.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body",
						children: block.extras.join("\n")
					}),
					block.diffs?.map((diff, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffView, {
						diff,
						t
					}, `${diff.path}#${String(index)}`)),
					block.lines.length > TOOL_LINES_CLIP && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "ntr-acp-more",
						onClick: () => {
							setExpanded(!expanded);
						},
						children: expanded ? t("收起", "collapse") : t(`显示全部 ${block.lines.length} 行`, `show all ${block.lines.length} lines`)
					}),
					block.raw !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "ntr-acp-more",
						onClick: () => {
							setRawOpen(!rawOpen);
						},
						children: rawOpen ? t("收起原始数据", "hide raw payload") : t("原始数据", "raw payload")
					}),
					rawOpen && block.raw !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body",
						children: block.raw
					})
				]
			});
		}
		/** One notification the view has no card of its own for: its readable fold, plus the untouched payload. */
		function EventCard({ block, t }) {
			const [rawOpen, setRawOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ntr-acp-tool is-done",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-tool-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": true,
							children: "ℹ️"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-tool-title",
							children: block.event
						})]
					}),
					block.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body",
						children: block.text
					}),
					block.raw !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "ntr-acp-more",
						onClick: () => {
							setRawOpen(!rawOpen);
						},
						children: rawOpen ? t("收起原始数据", "hide raw payload") : t("原始数据", "raw payload")
					}),
					rawOpen && block.raw !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "ntr-acp-tool-body",
						children: block.raw
					})
				]
			});
		}
		/** One plan snapshot (the agent's own todo list). */
		function PlanCard({ entries, t }) {
			const done = entries.filter((entry) => entry.status === "completed").length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ntr-acp-plan",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ntr-acp-plan-head",
					children: t(`计划 ${done}/${entries.length}`, `Plan ${done}/${entries.length}`)
				}), entries.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `ntr-acp-plan-row is-${entry.status}`,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-plan-glyph",
							"aria-hidden": true,
							children: entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "▸" : "○"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: entry.content }),
						entry.priority !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-plan-prio",
							children: entry.priority
						})
					]
				}, index))]
			});
		}
		/**
		* One stream block, dispatched by kind. Memoized on its props — `block`, the
		* store's instance-bound `label`, and `localeRev` (it moves on a language
		* switch, so translated copy re-renders) — so a folded batch re-renders only
		* the rows whose block object changed (`foldUpdate` replaces blocks immutably)
		* instead of the whole transcript on every store notification. `key` stays the
		* index on purpose: blocks fold append-only, and identity is the block object.
		*/
		const BlockView = (0, react.memo)(function BlockView({ block, label }) {
			const t = label;
			switch (block.kind) {
				case "user": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ntr-acp-bubble is-user",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RichText, { text: block.text })
				});
				case "agent": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ntr-acp-bubble is-agent",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RichText, { text: block.text })
				});
				case "thought": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					className: "ntr-acp-thought",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("思考过程", "reasoning") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-thought-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RichText, { text: block.text })
					})]
				});
				case "tool": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolCard, {
					block,
					t
				});
				case "plan": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanCard, {
					entries: block.entries,
					t
				});
				case "event": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EventCard, {
					block,
					t
				});
				default: return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: `ntr-acp-notice is-${block.tone}`,
					children: block.text
				});
			}
		});
		/** The bound ACP session for this chat, preferring the live one. */
		function boundSession(list) {
			return list.find((session) => !session.released) ?? list[0];
		}
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
		function boundAgentOf(session, hostBoundAgentId, pickedAgentId, agents) {
			const id = session?.agentId ?? hostBoundAgentId ?? pickedAgentId;
			if (id === void 0) return void 0;
			return {
				id,
				title: session?.agentTitle ?? agents.find((agent) => agent.id === id)?.title ?? id
			};
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
		function acpEmptyCopy(facts, t) {
			const bound = facts.bound;
			if (bound !== void 0) return {
				title: t("这个会话当前没有可显示的 ACP 会话", "This conversation has no ACP session to show right now"),
				body: t("给它发一条消息，它就会开始服务这个会话：原生聊天里会出现它的文字回复与思考过程，而它的工具调用、计划和 diff 会完整地出现在这个视图里。", "Send it a message and it starts serving this conversation: the native chat shows its prose and reasoning, while its tool calls, plans and diffs appear here in full."),
				hint: `${t("绑定的是", "bound to")} · ${bound.title}`
			};
			const copy = {
				title: t("这个会话还没有 NTR agent 参与", "No NTR agent has run in this conversation yet"),
				body: t("选中一个 NTR agent 后，本会话的对话就由它服务：原生聊天里会出现它的文字回复与思考过程，而它的工具调用、计划和 diff 会完整地出现在这个视图里。", "Pick a NTR agent and it serves this conversation: the native chat shows its prose and reasoning, while its tool calls, plans and diffs appear here in full.")
			};
			if (!facts.hasAgents) return {
				...copy,
				hint: `${t("还没有配置 agent", "No agent configured")} · ${t("设置 → NTR", "Settings → NTR")}`
			};
			if (facts.acpMode === true) return {
				...copy,
				hint: t("用输入框右侧的 NTR 底座选择一个 agent", "pick one from the NTR base in the composer")
			};
			if (facts.acpMode === false) return {
				...copy,
				hint: `${t("这个会话不在 NTR 模式", "This conversation is not in NTR mode")} · ${t("新建会话时可以选择 NTR 模式", "NTR is chosen when a conversation starts")}`
			};
			return copy;
		}
		/**
		* The ACP view tab body: who serves this conversation and how it is doing,
		* then the agent's own stream.
		*/
		function AcpConversationView(props) {
			ensureAcpStyle();
			const { acp, sessionId } = props;
			const t = (zh, en) => acp.label(zh, en);
			const ui = useUi$2(acp);
			const bound = ui.chatSessionsFor === sessionId ? boundSession(ui.chatSessions) : void 0;
			const transcript = acp.chatTranscriptOf(sessionId);
			const boundAgent = boundAgentOf(bound, ui.chatBoundAgent[sessionId], ui.chatChoice[sessionId]?.agentId, ui.agents);
			const streamRef = (0, react.useRef)(null);
			const pinned = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				acp.loadChatSessions(sessionId);
				acp.loadChatTranscript(sessionId);
			}, [
				acp,
				sessionId,
				bound?.sessionId,
				bound?.released
			]);
			const blockCount = transcript?.blocks.length ?? 0;
			const tail = transcript?.blocks[blockCount - 1];
			(0, react.useEffect)(() => {
				const node = streamRef.current;
				if (node === null || !pinned.current) return;
				node.scrollTop = node.scrollHeight;
			}, [blockCount, tail]);
			if (transcript === void 0) {
				const empty = acpEmptyCopy({
					bound: boundAgent,
					hasAgents: ui.agents.length > 0,
					acpMode: ui.acpMode[sessionId]
				}, t);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ntr-acp-view",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-empty",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ntr-acp-empty-title",
								children: empty.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "ntr-acp-empty-body",
								children: empty.body
							}),
							empty.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "ntr-acp-empty-hint",
								children: empty.hint
							}),
							ui.seatDiag !== "idle" && ui.seatDiag !== "gate disposed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ntr-acp-empty-hint ntr-acp-seat-diag",
								children: [
									t("模型座位", "model seat"),
									" · ",
									ui.seatDiag
								]
							}),
							ui.permissionSeatDiag !== "idle" && ui.permissionSeatDiag !== "gate disposed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ntr-acp-empty-hint ntr-acp-seat-diag",
								children: [
									t("权限底座", "permission seat"),
									" · ",
									ui.permissionSeatDiag
								]
							}),
							ui.slashDiag !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "ntr-acp-empty-hint ntr-acp-seat-diag",
								children: [
									t("斜杠菜单", "slash menu"),
									" · ",
									ui.slashDiag
								]
							})
						]
					})
				});
			}
			const session = transcript.session;
			const usage = session.usage;
			const agentTitle = ui.agents.find((agent) => agent.id === session.agentId)?.title ?? bound?.agentTitle ?? session.agentId;
			const health = session.released ? {
				text: t("已挂起 · 下一条消息自动恢复", "paused · resumes on your next message"),
				tone: "warn"
			} : session.closed ? {
				text: t("已关闭", "closed"),
				tone: "idle"
			} : session.running ? {
				text: t("运行中", "running"),
				tone: "busy"
			} : {
				text: t("空闲", "idle"),
				tone: "done"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ntr-acp-view",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "ntr-acp-view-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `ntr-acp-badge is-${health.tone}`,
							children: health.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-view-agent",
							children: agentTitle
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-view-meta",
							title: session.cwd,
							children: session.cwd
						}),
						usage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "ntr-acp-view-meta",
							children: [
								usage.used,
								"/",
								usage.size
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "ntr-acp-more",
							onClick: () => {
								acp.loadChatTranscript(sessionId);
							},
							children: t("刷新", "refresh")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ntr-acp-stream",
					ref: streamRef,
					onScroll: (event) => {
						const node = event.currentTarget;
						pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
					},
					children: transcript.blocks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-empty-hint",
						children: t("还没有消息：在下面的输入框里发给它。", "Nothing yet — send it a message below.")
					}) : transcript.blocks.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BlockView, {
						block,
						label: acp.label,
						localeRev: ui.localeRev
					}, index))
				})]
			});
		}
		//#endregion
		//#region src/client/settings-dialog.tsx
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
		/** Frame-wide NTR settings surface; renders nothing while closed. */
		function AcpSettingsDialog(props) {
			ensureAcpStyle();
			const { acp } = props;
			const open = useAcpSettingsDialogOpen();
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					closeAcpSettingsDialog();
				};
				document.addEventListener("keydown", onKey, true);
				return () => {
					document.removeEventListener("keydown", onKey, true);
				};
			}, [open]);
			if (!open) return null;
			const title = acp.label("NTR 设置", "NTR settings");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "ntr-acp-dialog-layer",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "ntr-acp-dialog-mask",
					"aria-hidden": true,
					onClick: closeAcpSettingsDialog
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "ntr-acp-dialog",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": title,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ntr-acp-dialog-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "ntr-acp-dialog-title",
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "ntr-acp-dialog-close",
							title: acp.label("关闭", "Close"),
							"aria-label": acp.label("关闭 NTR 设置", "Close NTR settings"),
							autoFocus: true,
							onClick: closeAcpSettingsDialog,
							children: "✕"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "ntr-acp-dialog-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AcpSettingsSection, { acp })
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/model-seat.tsx
		/** Exact key of the composer's model seat (a `single`, session-scoped slot). */
		const MODEL_SEAT_KEY = "conversation.input.model";
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
		const PERMISSION_SEAT_KEY = "conversation.input.permission";
		/**
		* Core generic slot claim engine.
		*
		* Installs and holds an occupant into a single-occupant slot, verifying via
		* `entriesOfSlot` and performing bounded retakes if displaced by later registrations.
		*/
		function createSeatClaim(options) {
			const { slots, slotKey, basePriority, occupant, inject } = options;
			const label = options.label ?? slotKey;
			const onDiag = options.onDiag;
			const maxClaims = options.maxClaims ?? 4;
			const ours = /* @__PURE__ */ new Set();
			const declared = /* @__PURE__ */ new Set();
			const installed = [];
			let retakes = 0;
			let holding = false;
			const say = (line) => onDiag?.(line);
			const describe = (entry) => {
				if (entry === void 0) return "no occupant";
				const who = entry.options?.registrant;
				const rank = entry.options?.priority;
				if (who === void 0 && rank === void 0) return "another entry";
				return `${who ?? "an unnamed entry"} (rank ${rank ?? 0})`;
			};
			const cell = () => {
				let isDeclared = true;
				if (typeof slots.spec === "function") try {
					isDeclared = slots.spec(slotKey) !== void 0;
				} catch {
					isDeclared = false;
				}
				if (typeof slots.entriesOfSlot !== "function") return {
					declared: isDeclared,
					verified: false
				};
				try {
					const heads = slots.entriesOfSlot(slotKey) ?? [];
					return {
						declared: isDeclared,
						verified: true,
						...heads[0] === void 0 ? {} : { entry: heads[0] }
					};
				} catch {
					return {
						declared: isDeclared,
						verified: false
					};
				}
			};
			const install = (head) => {
				const base = installed.length === 0 ? basePriority : basePriority - 1 - retakes;
				let rank = Math.min((head?.options?.priority ?? 0) - 1, base);
				while (declared.has(rank)) rank -= 1;
				const component = (props) => {
					return occupant()(props);
				};
				ours.add(component);
				declared.add(rank);
				try {
					installed.push(slots.inject(slotKey, () => slots.register({
						name: slotKey,
						priority: rank,
						...inject ? { inject } : {}
					}, component)));
					return true;
				} catch (error) {
					ours.delete(component);
					declared.delete(rank);
					say(`${label}: registration failed (${error instanceof Error ? error.message : String(error)})`);
					return false;
				}
			};
			return {
				get holding() {
					return holding;
				},
				sync() {
					if (installed.length === 0 && !install(void 0)) return;
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
						say(`${slotKey}: held by the ACP base${retakes === 0 ? "" : ` (retook it ${retakes}×)`}`);
						return;
					}
					const incumbent = view;
					if (retakes >= maxClaims) {
						holding = false;
						say(`${slotKey}: taken by ${describe(incumbent.entry)} — gave up after ${maxClaims} retakes`);
						return;
					}
					retakes += 1;
					if (!install(incumbent.entry)) return;
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
					while (installed.length > 0) try {
						installed.pop()?.();
					} catch {}
					ours.clear();
					declared.clear();
					retakes = 0;
					holding = false;
				}
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
		function createModelSeatClaim(options) {
			return createSeatClaim({
				slots: options.slots,
				slotKey: MODEL_SEAT_KEY,
				basePriority: -1,
				occupant: options.occupant,
				inject: options.inject,
				label: "model seat",
				onDiag: options.onDiag,
				maxClaims: options.maxClaims
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
		function createPermissionSeatClaim(options) {
			return createSeatClaim({
				slots: options.slots,
				slotKey: PERMISSION_SEAT_KEY,
				basePriority: -1,
				occupant: options.occupant ?? (() => BlankSlotOccupant),
				inject: options.inject ?? emptyInject,
				label: "permission seat",
				onDiag: options.onDiag,
				maxClaims: options.maxClaims
			});
		}
		//#endregion
		//#region src/client/slash-isolation.ts
		/**
		* Cross-instance marker. `apply()` can run again over the same live sources (a
		* page reload of the plugin, not just a page load), and a wrapper owned by the
		* previous instance closes over that instance's store — it must be restored
		* before the new one wraps, or the new callbacks never run.
		*/
		const WRAP_MARKER = Symbol.for("dsh-ntr.slash-isolation");
		/**
		* Whether one chat session runs the ACP preset, under the same two fact
		* sources the seat gate uses: the staged row's own preset when it speaks, and
		* the host-read verdict otherwise. `undefined` = no evidence yet, which every
		* caller reads as "not ACP" (fail-open: an ordinary conversation must never
		* lose its native commands to a guess).
		*/
		function slashAcpVerdict(snapshot, sessionId, verdict) {
			const staged = stagedSessionOf(snapshot);
			if (staged !== void 0 && staged.sessionId === sessionId) {
				const listed = rowAgentPreset(staged.row);
				if (listed !== void 0) return listed === "acp";
			}
			return verdict(sessionId);
		}
		const NO_MATCH = Number.NEGATIVE_INFINITY;
		/** Extra weight for name starts and separator boundaries (same as the host's ranker). */
		function boundaryBonus(name, index) {
			return index === 0 || name.charAt(index - 1) === "-" || name.charAt(index - 1) === "_" ? 8 : 0;
		}
		/**
		* Score the strongest ordered-subsequence alignment of `query` in `name`, or
		* `undefined` when the query is not a subsequence.
		*
		* A hand copy of `alignmentScore` from
		* `@deepseek-ai/dsh-client-ui-primitives`'s `rankByName`: this bundle does not
		* depend on that package, and the menu should rank exactly the way the host
		* ranks its own commands (prefix hits first, then this score). Keep the two in
		* sync if the host's ranker changes.
		*/
		function alignmentScore(name, query) {
			if (query.length > name.length) return void 0;
			let previous = new Array(name.length).fill(NO_MATCH);
			for (let index = 0; index < name.length; index++) if (name.charAt(index) === query.charAt(0)) previous[index] = 1 + boundaryBonus(name, index) - index;
			for (let queryIndex = 1; queryIndex < query.length; queryIndex++) {
				const current = new Array(name.length).fill(NO_MATCH);
				let left = NO_MATCH;
				let leftLeft = NO_MATCH;
				let bestGapped = NO_MATCH;
				for (let index = 0; index < name.length; index++) {
					const prior = previous[index] ?? NO_MATCH;
					if (leftLeft !== NO_MATCH) bestGapped = Math.max(bestGapped, leftLeft + index - 2);
					if (name.charAt(index) === query.charAt(queryIndex)) {
						const bonus = 1 + boundaryBonus(name, index);
						let score = NO_MATCH;
						if (left !== NO_MATCH) score = left + bonus + 4;
						if (bestGapped !== NO_MATCH) score = Math.max(score, bestGapped + bonus + 1 - index);
						current[index] = score;
					}
					leftLeft = left;
					left = prior;
				}
				previous = current;
			}
			let best = NO_MATCH;
			for (const score of previous) best = Math.max(best, score);
			return best === NO_MATCH ? void 0 : best;
		}
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
		function commandCandidates(commands, query) {
			const q = query.trim().toLowerCase();
			const seen = /* @__PURE__ */ new Set();
			const ranked = [];
			let order = 0;
			for (const command of commands) {
				if (command === null || typeof command !== "object") continue;
				const name = typeof command.name === "string" ? command.name.trim() : "";
				if (name === "" || seen.has(name)) continue;
				seen.add(name);
				const position = order;
				order += 1;
				const description = typeof command.description === "string" && command.description !== "" ? command.description : void 0;
				const input = command.input;
				const hint = typeof input?.hint === "string" && input.hint !== "" ? input.hint : void 0;
				const candidate = {
					name,
					...description !== void 0 ? { description } : {},
					...hint !== void 0 ? { hint } : {}
				};
				if (q === "") {
					ranked.push({
						candidate,
						order: position,
						prefix: true,
						score: 0
					});
					continue;
				}
				const lower = name.toLowerCase();
				const score = alignmentScore(lower, q);
				if (score === void 0) continue;
				ranked.push({
					candidate,
					order: position,
					prefix: lower.startsWith(q),
					score
				});
			}
			if (q === "") return ranked.map((match) => match.candidate);
			ranked.sort((left, right) => Number(right.prefix) - Number(left.prefix) || right.score - left.score || left.order - right.order);
			return ranked.map((match) => match.candidate);
		}
		function createSlashIsolation(options) {
			/** This instance's identity in the wrap marker (see `dispose`). */
			const owner = {};
			/** Sources this instance wrapped, so dispose can restore them. */
			const owned = /* @__PURE__ */ new Set();
			/**
			* The ONE `/` source whose menu group serves the agent's commands. Every
			* other `/` source is silenced in ACP mode — otherwise the same list would
			* appear once per group (`command` AND `skill` both register on `/`). The
			* host's command group is the natural carrier; it is picked by name so the
			* choice does not depend on registration order.
			*/
			let serving;
			let lastDiag = "idle";
			/** A problem line was reported during the current sync. */
			let failed = false;
			const report = (line) => {
				failed = true;
				if (lastDiag === line) return;
				lastDiag = line;
				options.onDiag?.(line);
			};
			const sessionIdOf = (session) => typeof session?.sessionId === "string" && session.sessionId !== "" ? session.sessionId : void 0;
			/** The verdict held synchronously, or `undefined`. Never asks. */
			const heldVerdict = (session) => {
				const sessionId = sessionIdOf(session);
				if (sessionId === void 0) return void 0;
				try {
					return options.verdict(sessionId);
				} catch {
					return;
				}
			};
			/**
			* Last host ask per session. The menu re-polls `candidates` on every
			* keystroke, and a host that never answers the verdict query would otherwise
			* turn each one into a `session/chat-list` round-trip — in ORDINARY
			* conversations too, since the wrapped source is shared by all of them.
			*/
			const askedAt = /* @__PURE__ */ new Map();
			const ASK_INTERVAL_MS = 1e3;
			/** Same idea for the "no commands known" refresh: one read per window, not per keystroke. */
			const refreshedAt = /* @__PURE__ */ new Map();
			const REFRESH_INTERVAL_MS = 1500;
			/** The verdict, asking the host at most once per {@link ASK_INTERVAL_MS}. */
			const settledVerdict = async (session) => {
				const sessionId = sessionIdOf(session);
				if (sessionId === void 0) return void 0;
				const held = heldVerdict(session);
				if (held !== void 0) return held;
				const last = askedAt.get(sessionId) ?? 0;
				if (Date.now() - last < ASK_INTERVAL_MS) return void 0;
				askedAt.set(sessionId, Date.now());
				try {
					return await options.ensureVerdict(sessionId);
				} catch {
					return;
				}
			};
			const wrap = (source) => {
				if (owned.has(source)) return false;
				const existing = source[WRAP_MARKER];
				try {
					existing?.restore();
				} catch {}
				if (typeof source.candidates !== "function") {
					report(`slash source "${source.name}" has no candidates hook; left alone`);
					return false;
				}
				const originals = {
					candidates: source.candidates,
					matchEnter: source.matchEnter,
					matchSpace: source.matchSpace,
					onPick: source.onPick,
					warm: source.warm,
					lexicon: source.lexicon,
					header: source.header
				};
				const hadOwn = /* @__PURE__ */ new Map();
				for (const key of Object.keys(originals)) hadOwn.set(key, Object.prototype.hasOwnProperty.call(source, key));
				const patched = [];
				const candidates = async (session, req) => {
					if (await settledVerdict(session) !== true) return originals.candidates.call(source, session, req);
					if (serving !== source) return [];
					const sessionId = sessionIdOf(session);
					let commands;
					try {
						commands = await options.commands(sessionId);
					} catch {
						commands = void 0;
					}
					if (commands === void 0) {
						const last = refreshedAt.get(sessionId) ?? 0;
						if (Date.now() - last >= REFRESH_INTERVAL_MS) {
							refreshedAt.set(sessionId, Date.now());
							options.refresh(sessionId);
						}
						return [];
					}
					const rows = commandCandidates(commands, req?.query ?? "");
					return req?.position === "inline" ? rows.filter((row) => row.hint === void 0) : rows;
				};
				source.candidates = candidates;
				patched.push({
					key: "candidates",
					wrapper: candidates
				});
				if (typeof originals.matchEnter === "function") {
					const matchEnter = async (session, line, signal, envelope) => {
						if (await settledVerdict(session) === true) return void 0;
						return originals.matchEnter.call(source, session, line, signal, envelope);
					};
					source.matchEnter = matchEnter;
					patched.push({
						key: "matchEnter",
						wrapper: matchEnter
					});
				}
				if (typeof originals.matchSpace === "function") {
					const matchSpace = (session, token) => {
						if (heldVerdict(session) === true) return void 0;
						return originals.matchSpace.call(source, session, token);
					};
					source.matchSpace = matchSpace;
					patched.push({
						key: "matchSpace",
						wrapper: matchSpace
					});
				}
				if (typeof originals.onPick === "function") {
					const onPick = (pick) => {
						if (heldVerdict(pick?.session) !== true) return originals.onPick.call(source, pick);
						const name = typeof pick?.candidate?.name === "string" ? pick.candidate.name.trim() : "";
						return name === "" ? void 0 : { text: `/${name} ` };
					};
					source.onPick = onPick;
					patched.push({
						key: "onPick",
						wrapper: onPick
					});
				}
				if (typeof originals.warm === "function") {
					const warm = (session) => {
						if (heldVerdict(session) === true) return;
						originals.warm.call(source, session);
					};
					source.warm = warm;
					patched.push({
						key: "warm",
						wrapper: warm
					});
				}
				if (typeof originals.lexicon === "function") {
					const lexicon = (session) => {
						if (heldVerdict(session) === true) return void 0;
						return originals.lexicon.call(source, session);
					};
					source.lexicon = lexicon;
					patched.push({
						key: "lexicon",
						wrapper: lexicon
					});
				}
				if (typeof originals.header === "function") {
					const header = (session, req) => {
						if (heldVerdict(session) === true) return void 0;
						return originals.header.call(source, session, req);
					};
					source.header = header;
					patched.push({
						key: "header",
						wrapper: header
					});
				}
				const slots = source;
				const restore = () => {
					for (const { key, wrapper } of patched) {
						if (slots[key] !== wrapper) continue;
						const original = originals[key];
						if (original !== void 0) slots[key] = original;
						else if (hadOwn.get(key) === false) delete slots[key];
						else slots[key] = void 0;
					}
				};
				source[WRAP_MARKER] = {
					owner,
					restore
				};
				owned.add(source);
				return true;
			};
			return {
				sync() {
					failed = false;
					let sources;
					try {
						sources = options.sources();
					} catch {
						sources = void 0;
					}
					if (sources === void 0) {
						report("the slash registry is unavailable; host slash commands stay in charge");
						return false;
					}
					serving = sources.find((source) => source?.trigger === "/" && source.name === "command") ?? sources.find((source) => source?.trigger === "/");
					let inForce = false;
					for (const source of sources) {
						if (source === null || typeof source !== "object") continue;
						if (source.trigger !== "/") continue;
						try {
							if (wrap(source) || owned.has(source)) inForce = true;
						} catch (error) {
							report(`could not wrap slash source "${String(source.name)}": ${error instanceof Error ? error.message : String(error)}`);
						}
					}
					if (!failed && inForce && lastDiag !== "idle") {
						lastDiag = "idle";
						options.onDiag?.("idle");
					}
					return inForce;
				},
				dispose() {
					for (const source of owned) {
						const marker = source[WRAP_MARKER];
						if (marker?.owner !== owner) continue;
						try {
							marker.restore();
						} catch {}
						source[WRAP_MARKER] = void 0;
					}
					owned.clear();
					askedAt.clear();
					refreshedAt.clear();
				}
			};
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-ntr-client";
		const inject = ["slots", "connection"];
		const browserPrefersZh = typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language);
		/**
		* How long a host verdict may stand as the gate's ONLY fact source before the
		* gate asks the host again.
		*
		* The gate prefers the staged session row's own preset. On a host whose client
		* rows carry no `agentPreset` the row is silent, and then the
		* `session/chat-list` verdict is all there is — and it used to be asked ONCE
		* per session, for the rest of the page's life. A preset switch that no
		* `agent-preset/selected` frame announced (the `remote` face absent when this
		* effect ran, or a runtime that never forwards the frame) therefore left the
		* gate judging a conversation that had already left ACP mode: both cells stayed
		* claimed, and the permission cell's product is an ABSENCE — an ordinary
		* conversation silently lost its Access mode control with nothing on screen to
		* say why. The host reads the session log every switch is appended to, so
		* re-asking is what lets the truth arrive late; the bound keeps that at one
		* round-trip per window per staged session instead of one per store mutation
		* (the resolve-loop the one-shot ask was bought to prevent).
		*/
		const ACP_MODE_VERDICT_TTL_MS = 2e3;
		/**
		* Slash-source discovery retry (see the slash-isolation effect): a source
		* registers with no event, so a module that loads after this one is found by
		* polling the roster a bounded number of times. 20 × 500ms covers a slow page
		* load; the timer stops as soon as a source is wrapped.
		*/
		const SLASH_SYNC_ATTEMPTS = 20;
		const SLASH_SYNC_DELAY_MS = 500;
		function apply(ctx) {
			const rpc = ctx.get("connection")?.rpc;
			if (rpc === void 0) throw new Error("dsh-ntr: browser connection.rpc is unavailable");
			const call = (channel, endpoint, payload) => rpc.call(channel, endpoint, payload);
			/**
			* Resolve one optional service without injecting it. A plain `ctx.get` at
			* call time keeps the plugin loadable when the service is absent AND picks it
			* up when it arrives later — which an `inject` dependency cannot do without
			* also making its absence fatal.
			*/
			const service = (name) => ctx.get(name);
			/**
			* Resolve a Chinese/English pair against the shell's active locale. Read per
			* call, so a language switch reaches every render-time `label()` call without
			* rebuilding the store. A host without the locale service keeps the
			* browser-derived choice the pairs shipped with.
			*/
			const label = (zhText, enText) => {
				const resolved = service("locale")?.resolveText?.({
					zh: zhText,
					en: enText
				});
				return typeof resolved === "string" && resolved !== "" ? resolved : browserPrefersZh ? zhText : enText;
			};
			const store = new AcpStore(call, label);
			store.start();
			ctx.effect(() => {
				let stop;
				const attach = () => {
					if (stop !== void 0) return;
					stop = service("locale")?.subscribe?.(() => {
						store.refreshLocale();
					});
				};
				attach();
				const stopService = ctx.on("internal/service", attach);
				return () => {
					stopService();
					stop?.();
				};
			}, "dsh-ntr: locale switch re-render");
			/** This session's command/projection face (`ctx.sessions`); `undefined` before it materializes. */
			const faceFor = (sessionId) => {
				try {
					return service("sessions")?.binding(sessionId)?.session;
				} catch {
					return;
				}
			};
			/** The injected face every ACP conversation entry receives. */
			const chatFace = (sessionId) => ({
				acp: store,
				sessionId: String(sessionId),
				faceFor
			});
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "acp-agents",
				order: 120,
				label: () => "NTR",
				inject: () => ({ acp: store })
			}, AcpSettingsSection)), "dsh-ntr: settings section");
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "acp-settings-dialog",
				order: 30,
				inject: () => ({ acp: store })
			}, AcpSettingsDialog)), "dsh-ntr: NTR settings dialog");
			ctx.effect(() => ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "acp-mode",
				order: 20,
				inject: (sessionId) => chatFace(sessionId)
			}, AcpComposerMode)), "dsh-ntr: composer agent-mode control");
			ctx.effect(() => ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
				name: "conversation.input.overlay",
				id: "acp-menu",
				order: 10,
				inject: (sessionId) => chatFace(sessionId)
			}, AcpSessionMenu)), "dsh-ntr: composer ACP picker");
			ctx.effect(() => ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
				name: "conversation.input.overlay",
				id: "acp-agent-tag",
				order: 5,
				inject: (sessionId) => chatFace(sessionId)
			}, AcpComposerAgentTag)), "dsh-ntr: composer agent tag");
			/**
			* The client runtime's session list store, read structurally. Used to find
			* the session the composer is staged on and whether it runs the ACP preset —
			* which is what every ACP conversation entry keys off.
			*/
			const sessionsList = () => {
				const list = service("sessions")?.list;
				if (list === void 0 || typeof list.getSnapshot !== "function" || typeof list.subscribe !== "function") return void 0;
				return list;
			};
			/**
			* Chat session ids the ACP-mode tracker has already asked the host about (the
			* `session/chat-list` fallback), mapped to WHEN the last ask went out. The
			* ask is once per id so a host whose answer carries no `acpMode` cannot turn
			* every store mutation into a fresh RPC — the classic resolve-loop this file
			* already guards against elsewhere. `agent-preset/selected` clears an id so a
			* committed preset switch re-asks.
			*
			* An id is REMOVED again when its ask comes back without a verdict: a
			* one-shot ask that cannot answer must not wedge the gate for the rest of
			* the page's life. The next store mutation or list notification retries it,
			* which is what makes the fallback recoverable rather than a single coin
			* flip (a host half that transiently fails, or answers `{}` because the
			* session's projection row is not resident yet, used to leave the native
			* model seat visible forever with nothing in the console to say why).
			*
			* A verdict that IS held is re-asked once per {@link ACP_MODE_VERDICT_TTL_MS}
			* while the row stays silent — see the constant for why a held verdict may
			* not be permanent.
			*/
			const acpModeAsked = /* @__PURE__ */ new Map();
			/** The host-side verdict for the seat gate, when we hold one (`AcpStore.acpMode`). */
			const acpModeVerdict = (sessionId) => store.getSnapshot().acpMode[sessionId];
			ctx.effect(() => {
				let stopWatch;
				/**
				* The claim on the host's model seat, held while the staged conversation
				* runs the ACP preset. That cell is where the host's own base sits (the
				* trailing group, right before the submit button), so the claim installs
				* the ACP base there rather than blanking it — one cell, one occupant, and
				* the position the user expects. Ownership of the cell is NOT settled by
				* the rank a registration declares — the client runner rewrites non-chain
				* priorities with its own page-global counter, so the last registrant
				* wins — which is why the claim verifies the cell's winner and retakes it
				* when a rival (a shipped occupant, or a third-party seat plugin later in
				* the load order) is holding it. See model-seat.tsx.
				*/
				let claim;
				/**
				* Claim on the host's native permission seat (`conversation.input.permission`),
				* held while the staged conversation runs in ACP mode to blank out the
				* Access mode dropdown — the DSH read-only / workspace-write /
				* danger-full-access knob, which describes policies this runtime applies to
				* ITS OWN tools and therefore says nothing about a separate agent process.
				*
				* Unlike the model seat, the right answer here is an empty cell rather than
				* an ACP replacement: the ACP agent's own permission surface is what it
				* sends over `session/request_permission`, and there is nothing of ours to
				* put in this slot. So the occupant is a component that renders `null`.
				*
				* That makes the lifecycle discipline load-bearing in a way the model seat
				* does not rely on: the evidence for taking the cell (the staged preset) is
				* derived from a store that can go silent, while the entry itself is
				* indistinguishable from a permanent one to anyone looking at the screen.
				* A claim that outlives its reason has silently removed a control from
				* ordinary conversations, so {@link standDown} runs on every path that is
				* not a confirmed ACP verdict — including the ones where no verdict is
				* available yet.
				*/
				let permissionClaim;
				/**
				* Last diagnostic line from {@link syncAcpMode}. Every way this gate can
				* end with the native seat still on screen used to be silent — an inner
				* `catch { return [] }` and an outer `catch { … }` between them swallowed
				* both the registration failure and the inject failure, leaving "the ACP
				* conversation still shows the native model picker" with nothing to read
				* it from. This string is the gate's own account of what it last decided,
				* verified or not, and why; the ACP view renders it.
				*/
				let seatDiag = "idle";
				let permissionSeatDiag = "idle";
				/**
				* Hand BOTH cells back to their shipped occupants.
				*
				* Every path that is not "this staged conversation is CONFIRMED to run the
				* ACP preset" ends here — including the paths that carry no verdict at all
				* (no session list, nothing staged, an addressed subagent route). Standing
				* down is the only safe default, because keeping a blanking entry installed
				* while the evidence has gone silent hides a control the user needs: the
				* cells sit in every conversation's composer bar, so an entry that outlives
				* its reason is indistinguishable from a permanent one. The next evaluation
				* re-installs if ACP mode is confirmed again, so this is not a decision
				* about the conversation — only about whose chrome is on screen while we
				* cannot answer.
				*/
				const standDown = (reason) => {
					seatDiag = reason;
					permissionSeatDiag = `${reason} (released)`;
					disarmVerdictReask();
					if (claim !== void 0) {
						claim.release();
						claim = void 0;
					}
					if (permissionClaim !== void 0) {
						permissionClaim.release();
						permissionClaim = void 0;
					}
				};
				/**
				* Re-ask timer for the staged session, armed while the row is silent and a
				* verdict is held (see {@link ACP_MODE_VERDICT_TTL_MS}). A re-ask needs a
				* trigger of its own: on the host shape this covers nothing else moves —
				* the row never speaks, the frame path may be dead, and a page with no
				* store traffic would otherwise never re-run the gate, which is exactly
				* how a stale verdict became permanent. One timer at a time, because the
				* gate judges exactly one staged session; cleared whenever the row speaks,
				* whenever the gate stands down, and on teardown.
				*/
				let verdictReask;
				const armVerdictReask = () => {
					if (verdictReask !== void 0) return;
					verdictReask = setTimeout(() => {
						verdictReask = void 0;
						runGate();
					}, ACP_MODE_VERDICT_TTL_MS);
				};
				const disarmVerdictReask = () => {
					if (verdictReask === void 0) return;
					clearTimeout(verdictReask);
					verdictReask = void 0;
				};
				const syncAcpMode = () => {
					const list = sessionsList();
					const snapshot = list?.getSnapshot();
					if (list === void 0) {
						standDown("no session list service");
						return;
					}
					const staged = stagedSessionOf(snapshot);
					if (staged === void 0) {
						standDown("no staged session (nothing retains the main view)");
						return;
					}
					if (staged.subagent) {
						standDown(`staged ${staged.sessionId} is an addressed subagent route`);
						return;
					}
					const verdictHeld = acpModeVerdict(staged.sessionId) !== void 0 || store.hasAcpModeVerdict(staged.sessionId);
					const askedAt = acpModeAsked.get(staged.sessionId);
					const askIsDue = askedAt === void 0 || !verdictHeld || Date.now() - askedAt >= ACP_MODE_VERDICT_TTL_MS;
					if (rowAgentPreset(staged.row) === void 0 && askIsDue) {
						acpModeAsked.set(staged.sessionId, Date.now());
						store.loadChatSessions(staged.sessionId, verdictHeld ? { settleVerdict: true } : void 0);
					} else if (!verdictHeld && askedAt !== void 0) acpModeAsked.delete(staged.sessionId);
					if (!stagedIsAcpMode(snapshot, acpModeVerdict)) {
						standDown(`staged ${staged.sessionId} is not in ACP mode`);
						return;
					}
					if (rowAgentPreset(staged.row) !== void 0) disarmVerdictReask();
					seatDiag = `staged ${staged.sessionId} is ACP mode`;
					claim ??= createModelSeatClaim({
						slots: ctx.slots,
						occupant: () => AcpSessionControls,
						inject: (sessionId) => chatFace(sessionId),
						onDiag: (line) => {
							seatDiag = `staged ${staged.sessionId} · ${line}`;
						}
					});
					claim.sync();
					permissionSeatDiag = `staged ${staged.sessionId} is ACP mode`;
					permissionClaim ??= createPermissionSeatClaim({
						slots: ctx.slots,
						onDiag: (line) => {
							permissionSeatDiag = `staged ${staged.sessionId} · ${line}`;
						}
					});
					permissionClaim.sync();
					if (rowAgentPreset(staged.row) === void 0) armVerdictReask();
				};
				let stopPreset;
				const attachPresetFrames = () => {
					if (stopPreset !== void 0) return;
					const remote = ctx.get("remote");
					if (typeof remote?.$on !== "function") return;
					stopPreset = remote.$on("agent-preset/selected", (...args) => {
						const sessionId = args[0];
						if (typeof sessionId !== "string") return;
						acpModeAsked.delete(sessionId);
						if (args.length >= 2) {
							store.abandonChatSessionRead(sessionId);
							store.noteAcpMode(sessionId, acpModeFromPresetEvent(args[1]));
						} else store.invalidateAcpMode(sessionId);
						runGate();
					});
				};
				const attach = () => {
					const list = sessionsList();
					if (list !== void 0 && stopWatch === void 0) stopWatch = list.subscribe(runGate);
					attachPresetFrames();
					runGate();
				};
				/**
				* Wrap {@link syncAcpMode} so every evaluation also publishes its verdict
				* to the store. The gate runs on every store mutation, list notification,
				* preset frame and change to the model-seat cell itself, so the published
				* line is always the latest verdict — which is the whole point: the visible
				* symptom ("the native seat is still there") looks identical whether the
				* seat was never declared, refused us, or was taken by a rival, and only
				* this line tells them apart.
				*
				* NOT RE-ENTRANT, and deliberately so. The host's slot registry emits
				* `slots/changed` SYNCHRONOUSLY from inside `slots.register` and from
				* inside an entry's disposer (`SlotCore.markDirty` → the registry's
				* `onMutate` bridge → `ctx.emit`), and the store re-runs this gate from
				* inside its own `mutate`. So an evaluation that installs or releases an
				* entry re-enters itself from within its own call stack — and a nested
				* evaluation reads the SAME evidence (neither the session snapshot nor the
				* store has changed), so it can only repeat the decision. Worse, a nested
				* install sees `installed.length === 0` because the outer install has not
				* pushed its disposer yet, registers a second entry, and that entry's own
				* `slots/changed` re-enters again: an unbounded registration pile whose
				* store-subscriber feedback never settles. A nested run is therefore
				* dropped — the evaluation already in flight judged this evidence and is
				* about to publish its verdict, and the next trigger tries again.
				*/
				let gateRunning = false;
				const runGate = () => {
					if (gateRunning) return;
					gateRunning = true;
					try {
						syncAcpMode();
						store.noteSeatDiag(seatDiag);
						store.notePermissionSeatDiag(permissionSeatDiag);
					} finally {
						gateRunning = false;
					}
				};
				attach();
				const stopStore = store.subscribe(runGate);
				const stopCell = ctx.on("slots/changed", (...args) => {
					if (args[0] !== "conversation.input.model" && args[0] !== "conversation.input.permission") return;
					runGate();
				});
				const stopService = ctx.on("internal/service", attach);
				return () => {
					stopService();
					stopStore();
					stopCell();
					stopPreset?.();
					stopWatch?.();
					disarmVerdictReask();
					if (claim !== void 0) {
						claim.release();
						claim = void 0;
					}
					if (permissionClaim !== void 0) {
						permissionClaim.release();
						permissionClaim = void 0;
					}
					store.noteSeatDiag("gate disposed");
					store.notePermissionSeatDiag("gate disposed");
				};
			}, "dsh-ntr: ACP mode tracking");
			/**
			* Slash isolation (`src/client/slash-isolation.ts`): in an ACP conversation
			* the composer's `/` menu, Enter and Space adjudication belong to the AGENT.
			* The host's slash sources describe commands THIS runtime would execute, and
			* a name they recognize never reaches the prompt sink — so `/model` in an NTR
			* conversation would run DSH's model picker instead of reaching the agent.
			*
			* The host pipeline offers no per-session seam (adjudication polls sources in
			* registration order; duplicates throw; no availability hook), so the live
			* sources are wrapped in memory. The verdict is the same two-source read the
			* seat gate uses: the staged row's own preset, else the host's answer.
			*
			* Re-runs on `internal/service` (a late `inputTriggers`) and on store traffic
			* (a source registering after us), and is idempotent. Everything is restored
			* on teardown so a plugin reload never leaves the previous instance's
			* callbacks behind.
			*/
			ctx.effect(() => {
				let warned = "";
				const isolation = createSlashIsolation({
					sources: () => {
						const triggers = service("inputTriggers");
						if (triggers === void 0) return [];
						const sources = triggers.live?.sources;
						return Array.isArray(sources) ? sources : void 0;
					},
					verdict: (sessionId) => slashAcpVerdict(sessionsList()?.getSnapshot(), sessionId, (id) => store.getSnapshot().acpMode[id]),
					ensureVerdict: async (sessionId) => {
						const held = () => slashAcpVerdict(sessionsList()?.getSnapshot(), sessionId, (id) => store.getSnapshot().acpMode[id]);
						const known = held();
						if (known !== void 0) return known;
						await store.loadChatSessions(sessionId);
						return held();
					},
					commands: async (sessionId) => {
						const live = store.chatSessionCommands(sessionId);
						if (live !== void 0) return live;
						const agentId = store.chatAgentFor(sessionId);
						if (agentId === void 0) return void 0;
						const cached = store.agentCommands(agentId);
						if (cached !== void 0) return cached;
						await store.loadAgentCatalog(agentId);
						return store.agentCommands(agentId);
					},
					refresh: (sessionId) => {
						store.loadChatSessions(sessionId);
					},
					onDiag: (line) => {
						store.noteSlashDiag(line);
						if (warned === line) return;
						warned = line;
						if (line !== "idle") console.warn(`[dsh-ntr] slash isolation: ${line}`);
					}
				});
				/**
				* Sources register with no event of their own: `inputTriggers` announces
				* the SERVICE, not the roster. A client module that loads after this one
				* therefore adds the `command` source in silence. The retry below is the
				* bounded answer to that gap — stop as soon as something is wrapped, and
				* give up after {@link SLASH_SYNC_ATTEMPTS} so a host with no slash
				* pipeline does not keep a timer alive.
				*/
				let retryTimer;
				let attempts = 0;
				const sync = () => {
					if (isolation.sync()) {
						if (retryTimer !== void 0) {
							clearTimeout(retryTimer);
							retryTimer = void 0;
						}
						return;
					}
					if (service("inputTriggers") === void 0) return;
					if (retryTimer !== void 0 || attempts >= SLASH_SYNC_ATTEMPTS) return;
					attempts += 1;
					retryTimer = setTimeout(() => {
						retryTimer = void 0;
						sync();
					}, SLASH_SYNC_DELAY_MS);
				};
				sync();
				const stopService = ctx.on("internal/service", sync);
				const stopStore = store.subscribe(sync);
				return () => {
					if (retryTimer !== void 0) clearTimeout(retryTimer);
					stopStore();
					stopService();
					isolation.dispose();
					store.noteSlashDiag("idle");
				};
			}, "dsh-ntr: slash isolation");
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "acp",
				order: 20,
				label: () => "NTR",
				inject: (sessionId) => chatFace(sessionId)
			}, AcpConversationView)), "dsh-ntr: ACP view tab");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map