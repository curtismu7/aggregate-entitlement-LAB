export const DEFAULT_PORT = 7802;

export function port(env = process.env) { return Number(env.PORT) || DEFAULT_PORT; }
export function scanMaxBytes(env = process.env) { return Number(env.AGG_ENT_SCAN_MAX_BYTES) || 1_048_576; }
