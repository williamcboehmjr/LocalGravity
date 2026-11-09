// Builtin tool registry: maps toolName -> migrated handler.
// The executor's executeTool() checks this map first (Strangler-Fig); unmigrated
// tools still fall through to the legacy switch until each is moved here.

import type { BuiltinToolHandler } from './types.js';

import * as restartBrain from './restartBrain.js';
import * as readSystemLogs from './readSystemLogs.js';
import * as listSkills from './listSkills.js';
import * as readSkill from './readSkill.js';
import * as callMcpTool from './callMcpTool.js';
import * as publishRelease from './publishRelease.js';
import * as manageTask from './manageTask.js';
import * as scheduleTimer from './scheduleTimer.js';
import * as invokeSubagent from './invokeSubagent.js';
import * as writeArtifact from './writeArtifact.js';

export const HANDLER_REGISTRY: Record<string, BuiltinToolHandler> = {
  [restartBrain.name]: restartBrain.execute,
  [readSystemLogs.name]: readSystemLogs.execute,
  [listSkills.name]: listSkills.execute,
  [readSkill.name]: readSkill.execute,
  [callMcpTool.name]: callMcpTool.execute,
  [publishRelease.name]: publishRelease.execute,
  [manageTask.name]: manageTask.execute,
  [scheduleTimer.name]: scheduleTimer.execute,
  [invokeSubagent.name]: invokeSubagent.execute,
  [writeArtifact.name]: writeArtifact.execute,
};
