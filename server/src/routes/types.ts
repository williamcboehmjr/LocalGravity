import type { FastifyInstance } from 'fastify';
import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { TabbyEngine } from '../tabby/tabbyEngine.js';
import type { BrainProviderId, GoogleModelId } from '../google/googleAiEngine.js';
import type { McpClientManager } from '../mcp/mcpManager.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { SharedTerminalManager } from '../terminal/terminalManager.js';
import type { BuiltinToolExecutor } from '../tools/builtinTools.js';
import type { Harness2Manager } from '../harness/harnessManager.js';
import type { AttachmentManager } from '../files/attachmentManager.js';
import type { ProviderRegistry } from '../providers/providerRegistry.js';
import type { BackgroundTaskManager } from '../tools/taskManager.js';
import type { SubagentManager } from '../tools/subagentManager.js';
import type { ArtifactManager } from '../tools/artifactManager.js';
import type { SwarmManager } from '../swarm/swarmManager.js';
import type { ActiveTurnSnapshot } from '../agent/promptTurn.js';
import type { RuntimePortsConfig } from '../portAllocator.js';

export interface RouteContext {
  app: FastifyInstance;
  repoRoot: string;
  ports: RuntimePortsConfig;
  db: LocalGravityDB;
  tabby: TabbyEngine;
  mcp: McpClientManager;
  skills: SkillManager;
  terminal: SharedTerminalManager;
  tools: BuiltinToolExecutor;
  harness: Harness2Manager;
  attachmentManager: AttachmentManager;
  providerRegistry: ProviderRegistry;
  taskMgr: BackgroundTaskManager;
  subagentMgr: SubagentManager;
  artifactMgr: ArtifactManager;
  swarmMgr: SwarmManager;
  activeAbortControllers: Map<string, AbortController>;
  activeTurns: Map<string, ActiveTurnSnapshot>;
  broadcastSync: (event: Record<string, any>) => void;
  applyBrainProviderUpdate: (update: {
    provider?: BrainProviderId;
    googleApiKey?: string;
    selectedGoogleModel?: GoogleModelId;
  }) => any;
  handlePromptTurn: (params: {
    threadId: string;
    prompt: string;
    tier: ModelTier;
    thinkingBudget: ThinkingBudget;
    attachments?: any[];
  }) => Promise<void>;
  stopGenerationHandler: (threadId?: string, rawTurnId?: string) => Promise<any>;
}
