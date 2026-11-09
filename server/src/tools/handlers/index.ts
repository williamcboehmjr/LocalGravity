// Builtin tool registry: maps toolName -> migrated handler.
// The executor's executeTool() checks this map first (Strangler-Fig); unmigrated
// tools still fall through to the legacy switch until each is moved here.

import type { BuiltinToolHandler } from './types.js';

import * as restartBrain from './restartBrain.js';

export const HANDLER_REGISTRY: Record<string, BuiltinToolHandler> = {
  [restartBrain.name]: restartBrain.execute,
};
