/**
 * dsh-ntr-plus browser entry: builds the store over the Connection RPC face and
 * contributes every public seat — the settings section, the ACP conversation
 * view, the agent-native mode control, and the ACP base in the composer's
 * model seat (installed by the ACP-mode gate, which is what keeps it out of
 * every non-ACP conversation).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-ntr-plus-client";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
