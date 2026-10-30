/**
 * dsh-ntr-plus shared contracts (browser-safe: types only, zero runtime code).
 *
 * Two planes:
 * - `AcpEvent`: host → browser, one JSON frame per `session/update` fold,
 *   permission round-trip, agent process status, and turn lifecycle.
 * - RPC payloads: browser → host unary calls on the `/acp` Connection channel.
 *
 * Security invariants encoded here (enforced host-side in impl.ts):
 * - A SESSION never names a program to spawn: `session/start` and the
 *   conversation↔agent binding only select a configured agent id and a cwd
 *   that must resolve inside the agent's allowed roots. Naming a program is
 *   a CONFIGURATION act instead — the browser may do it through `agent/save`
 *   / `agent/test`, both of which run the command through `validateAgentDef`
 *   (a command line, not a bare path) and both of which really spawn.
 * - Agent environment variables flow config → child process only.
 */
/** Default when nothing was ever saved: the breathing halo at normal speed. */
export const DEFAULT_TAG_HALO = { mode: 'breath', speed: 'normal' };
