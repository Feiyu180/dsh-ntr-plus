/**
 * dsh-ntr-plus host entry: mounts the `/acp` Connection RPC channel and the
 * `/api/acp/stream` SSE route, owns every spawned ACP child, and tears all of
 * them down with the plugin fiber. Named exports only (a default export would
 * hide the loader metadata — see harness postmortem 0001).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-ntr-plus";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: unknown): void;
