// Complete builtin tool handler registry (Strangler-Fig migration finished).

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
import * as comfyui from './comfyui.js';
import * as runCodeBatch from './runCodeBatch.js';
import * as reloadHarness from './reloadHarness.js';
import { swarmTool, postMessageTool, readBoardTool, swarmWaitTool } from './swarmTools.js';
import { FS_TOOL_HANDLERS } from './fsTools.js';
import { SEARCH_TOOL_HANDLERS } from './searchTools.js';
import { WEB_TOOL_HANDLERS } from './webTools.js';
import { SYSTEM_TOOL_HANDLERS } from './systemTools.js';
import { VISION_TOOL_HANDLERS } from './visionTools.js';

export const HANDLER_REGISTRY: Record<string, BuiltinToolHandler> = {
  ...FS_TOOL_HANDLERS,
  ...SEARCH_TOOL_HANDLERS,
  ...WEB_TOOL_HANDLERS,
  ...SYSTEM_TOOL_HANDLERS,
  ...VISION_TOOL_HANDLERS,
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
  [comfyui.name]: comfyui.execute,
  [runCodeBatch.name]: runCodeBatch.execute,
  [reloadHarness.name]: reloadHarness.execute,
  [swarmTool.name]: swarmTool.execute,
  [postMessageTool.name]: postMessageTool.execute,
  [readBoardTool.name]: readBoardTool.execute,
  [swarmWaitTool.name]: swarmWaitTool.execute,
};
