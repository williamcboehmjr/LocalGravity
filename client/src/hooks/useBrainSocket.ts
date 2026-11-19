import { useState, useEffect, useRef, useCallback } from 'react';
import {
  useSessionStore,
  isPhaseProtocolActive,
  resetTurnProtocolState,
  getSavedLastLocation,
} from '../store/useSessionStore';
import { useArtifactStore } from '../store/useArtifactStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { loadClientComfyPref } from '../store/slices/comfySlice';

export const getOrCreateEdgeClientId = (): string => {
  try {
    const existing = localStorage.getItem('lg_edge_client_id');
    if (existing) return existing;
    const created = `edge-${crypto.randomUUID()}`;
    localStorage.setItem('lg_edge_client_id', created);
    return created;
  } catch {
    return `edge-${Date.now()}`;
  }
};

export interface UseBrainSocketOptions {
  hostUrl: string;
  brainHost: string;
  brainPort: string;
  isConnected: boolean;
  onSelectThread: (threadId: string, opts?: { keepMobileDrawer?: boolean }) => void | Promise<void>;
  onOpenRightDrawer: () => void;
}

export interface UseBrainSocketResult {
  wsRef: React.MutableRefObject<WebSocket | null>;
  reconnectCountdown: number;
  reconnectAttempt: number;
  handleManualReconnect: () => void;
  timerCountdown: number;
  timerTotal: number;
  timerLabel: string;
  lastCompaction: { previousTokens: number; compactedTokens: number } | null;
  adaptiveCotLabel: string;
}

export function useBrainSocket({
  hostUrl,
  brainHost,
  brainPort,
  isConnected,
  onSelectThread,
  onOpenRightDrawer,
}: UseBrainSocketOptions): UseBrainSocketResult {
  const wsRef = useRef<WebSocket | null>(null);
  const onSelectThreadRef = useRef(onSelectThread);
  onSelectThreadRef.current = onSelectThread;
  const onOpenRightDrawerRef = useRef(onOpenRightDrawer);
  onOpenRightDrawerRef.current = onOpenRightDrawer;

  const [reconnectCountdown, setReconnectCountdown] = useState<number>(0);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [reconnectKey, setReconnectKey] = useState<number>(0);

  const [timerCountdown, setTimerCountdown] = useState<number>(0);
  const [timerTotal, setTimerTotal] = useState<number>(0);
  const [timerLabel, setTimerLabel] = useState<string>('Timer');
  const [lastCompaction, setLastCompaction] = useState<{
    previousTokens: number;
    compactedTokens: number;
  } | null>(null);
  const [adaptiveCotLabel, setAdaptiveCotLabel] = useState<string>('');

  const handleManualReconnect = useCallback(() => {
    setReconnectCountdown(0);
    setReconnectKey((k) => k + 1);
  }, []);

  // Connect and multiplex state over `/ws/sync` (depends strictly on hostUrl & reconnectKey)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isDisposed = false;

    const effectiveHost = hostUrl;

    const connect = () => {
      if (isDisposed) return;

      try {
        const cleanHost = effectiveHost.replace(/^http/, 'ws').replace('localhost', '127.0.0.1');
        const url = `${cleanHost}/ws/sync`;
        ws = new WebSocket(url);
        wsRef.current = ws;
        let pendingClientPrefSync = false;

        ws.onopen = () => {
          if (isDisposed) {
            try {
              ws?.close();
            } catch {}
            return;
          }
          useSessionStore.getState().setIsConnected(true);
          setReconnectAttempt(0);
          setReconnectCountdown(0);

          const savedPref = loadClientComfyPref();
          if (savedPref && ws && ws.readyState === WebSocket.OPEN) {
            pendingClientPrefSync = true;
            ws.send(
              JSON.stringify({
                type: 'CLIENT_MODE_PREFERENCE',
                payload: {
                  client_id: getOrCreateEdgeClientId(),
                  ...savedPref,
                },
              })
            );
          }

          // Register this Tauri desktop host with Central Brain for Remote Host Bridge execution
          if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
            import('@tauri-apps/api/core')
              .then(({ invoke }) =>
                invoke<{ hostname: string; platform: string; home_dir: string }>('get_edge_identity')
              )
              .then((identity) => {
                useSessionStore.getState().setLocalHostName(identity.hostname);
                if (!isDisposed && ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'EDGE_REGISTER',
                      payload: {
                        client_id: getOrCreateEdgeClientId(),
                        hostname: identity.hostname,
                        platform: identity.platform,
                        home_dir: identity.home_dir,
                      },
                    })
                  );
                }
              })
              .catch(() => {});
          }
        };

        ws.onclose = () => {
          if (isDisposed) return;
          const store = useSessionStore.getState();
          store.setIsConnected(false);
          setReconnectAttempt((prev) => prev + 1);
          setReconnectCountdown(3);
          if ((brainHost === '127.0.0.1' || brainHost === 'localhost') && brainPort !== '3390') {
            fetch('http://127.0.0.1:3390/health', { signal: AbortSignal.timeout(1200) })
              .then((r) => {
                if (!isDisposed && r.ok) {
                  useSessionStore.getState().setBrainConnection('127.0.0.1', '3390');
                }
              })
              .catch(() => {});
          }
        };

        ws.onerror = () => {
          if (isDisposed) return;
          useSessionStore.getState().setIsConnected(false);
        };

        ws.onmessage = (event) => {
          if (isDisposed) return;
          try {
            const data = JSON.parse(event.data);
            const { type, payload } = data;
            const store = useSessionStore.getState();
            const artStore = useArtifactStore.getState();
            const telemetryStore = useTelemetryStore.getState();

            const activeThreadId = store.sessionId;
            const evtThreadId: string | undefined =
              payload?.thread_id || payload?.threadId || payload?.session_id;
            const isForActiveThread = !evtThreadId || evtThreadId === activeThreadId;
            const evtTurnId: string | undefined = payload?.turn_id || payload?.turnId;
            const evtMessageId: string | undefined = payload?.message_id || payload?.messageId;
            const curTurn = store.activeTurn;
            const isStaleTurnEvent = Boolean(
              (evtTurnId &&
                curTurn?.turnId &&
                !curTurn.turnId.startsWith('pending-') &&
                curTurn.turnId !== evtTurnId) ||
                (evtMessageId &&
                  curTurn?.isActive &&
                  curTurn.messageId &&
                  curTurn.messageId !== evtMessageId)
            );

            if (type === 'EDGE_TOOL_REQUEST') {
              const reqId = payload?.request_id;
              const toolName = payload?.tool_name;
              const toolArgs = payload?.args || {};
              const wsRoot = payload?.workspace_root || store.workspacePath || '.';
              if (reqId && toolName && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
                import('@tauri-apps/api/core')
                  .then(({ invoke }) =>
                    invoke<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }>(
                      'execute_edge_tool',
                      {
                        toolName,
                        args: toolArgs,
                        workspaceRoot: wsRoot,
                      }
                    )
                  )
                  .then((res) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: 'EDGE_TOOL_RESULT',
                          payload: {
                            request_id: reqId,
                            stdout: res.stdout,
                            stderr: res.stderr,
                            exit_code: res.exit_code,
                            duration_ms: res.duration_ms,
                          },
                        })
                      );
                    }
                  })
                  .catch((err) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: 'EDGE_TOOL_RESULT',
                          payload: {
                            request_id: reqId,
                            stdout: '',
                            stderr: `Tauri edge tool error: ${err?.message || String(err)}`,
                            exit_code: 1,
                            duration_ms: 0,
                          },
                        })
                      );
                    }
                  });
              }
              return;
            }

            if (type === 'EDGE_HOSTS_UPDATE') {
              store.setHostPresence(payload?.brainHost, payload?.edgeHosts);
              return;
            }

            if (type === 'PROJECT_DELETED' && payload?.projectId) {
              const remaining = store.projects.filter((p) => p.id !== payload.projectId);
              const nextActive =
                store.activeProjectId === payload.projectId
                  ? (remaining[0]?.id ?? undefined)
                  : store.activeProjectId ?? undefined;
              store.setProjects(remaining, nextActive);
              return;
            }

            if (type === 'SYNC_STATE') {
              if (payload.brainHost || payload.edgeHosts) {
                store.setHostPresence(payload.brainHost, payload.edgeHosts);
              }
              const savedLoc = getSavedLastLocation();
              const inMemProjectId =
                store.activeProjectId && store.activeProjectId !== 'proj-default'
                  ? store.activeProjectId
                  : null;
              const preferredProjectId =
                (inMemProjectId && payload.projects?.some((p: any) => p.id === inMemProjectId)
                  ? inMemProjectId
                  : null) ||
                (savedLoc.projectId && payload.projects?.some((p: any) => p.id === savedLoc.projectId)
                  ? savedLoc.projectId
                  : null) ||
                payload.activeProject?.id;

              const inMemThreadId =
                store.sessionId && store.sessionId !== 'thread-default' ? store.sessionId : null;
              const preferredThreadId = inMemThreadId || savedLoc.threadId || payload.activeThreadId;

              const switchedToSavedProject = Boolean(
                preferredProjectId &&
                  payload.activeProject?.id &&
                  preferredProjectId !== payload.activeProject.id
              );

              if (payload.projects?.length > 0) {
                store.setProjects(payload.projects, preferredProjectId);
              }

              if (switchedToSavedProject && preferredProjectId) {
                const base = useSessionStore.getState().apiBaseUrl;
                fetch(`${base}/api/threads?project_id=${encodeURIComponent(preferredProjectId)}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((projData) => {
                    const list = projData?.threads || [];
                    const targetTid =
                      (preferredThreadId && list.some((t: any) => t.id === preferredThreadId)
                        ? preferredThreadId
                        : list[0]?.id) || '';
                    if (list.length > 0) {
                      useSessionStore.getState().setThreads(list, targetTid);
                    }
                    if (targetTid) {
                      void onSelectThreadRef.current(targetTid, { keepMobileDrawer: true });
                    }
                  })
                  .catch(() => {});
              } else {
                const resolvedPreferredThread =
                  (preferredThreadId &&
                  Array.isArray(payload.threads) &&
                  payload.threads.some((t: any) => t.id === preferredThreadId)
                    ? preferredThreadId
                    : payload.activeThreadId) || undefined;

                if (payload.threads) {
                  store.setThreads(payload.threads, resolvedPreferredThread);
                }

                if (resolvedPreferredThread && resolvedPreferredThread !== payload.activeThreadId) {
                  void onSelectThreadRef.current(resolvedPreferredThread, { keepMobileDrawer: true });
                } else {
                  const resolvedThreadId = useSessionStore.getState().sessionId;
                  const activeThreadObj = Array.isArray(payload.threads)
                    ? payload.threads.find((t: any) => t.id === resolvedThreadId)
                    : null;
                  const matchingStreams = Array.isArray(payload.activeStreams)
                    ? payload.activeStreams.filter(
                        (s: any) => !s?.thread_id || s.thread_id === resolvedThreadId
                      )
                    : [];
                  if (payload.messages) {
                    store.hydrateMessagesFromServer(
                      payload.messages,
                      matchingStreams,
                      activeThreadObj?.status,
                      payload.activeTurn
                    );
                  }
                  const isServerThreadBusy =
                    activeThreadObj?.status === 'thinking' || activeThreadObj?.status === 'executing_tool';
                  const hasActiveStream = matchingStreams.length > 0 || isServerThreadBusy;
                  if (
                    payload.activeTurn &&
                    (!payload.activeTurn.thread_id || payload.activeTurn.thread_id === resolvedThreadId)
                  ) {
                    store.applyTurnPhase(payload.activeTurn);
                    if (!payload.activeTurn.is_active) setAdaptiveCotLabel('');
                  } else {
                    store.syncGenerating(hasActiveStream);
                    if (!hasActiveStream) setAdaptiveCotLabel('');
                  }
                }
              }

              if (payload.checkpoints) {
                artStore.setCheckpoints(payload.checkpoints);
              }
              if (Array.isArray(payload.artifacts)) {
                artStore.setArtifacts(payload.artifacts);
              }
              if (payload.mcpServers) {
                telemetryStore.setMcpServers(payload.mcpServers);
              }
              if (payload.brainProvider) {
                store.setBrainProviderState(payload.brainProvider);
              }
              if (payload.comfyStudio) {
                if (pendingClientPrefSync) {
                  const { config: _ignoredServerCfg, ...restComfy } = payload.comfyStudio;
                  store.setComfyStudioState({ ...restComfy, apiUnsupported: false });
                } else {
                  store.setComfyStudioState({ ...payload.comfyStudio, apiUnsupported: false });
                }
              }
              if (Array.isArray(payload.backgroundTasks)) {
                store.setBackgroundTasks(payload.backgroundTasks);
              }
              if (payload.swarm !== undefined) {
                store.setSwarmState(payload.swarm || null);
              } else {
                store.setSwarmState(null);
              }
              if (payload.tabby || payload.telemetry) {
                telemetryStore.setTelemetry({
                  vramUsedGb: payload.telemetry?.vramUsedGb ?? 14.8,
                  vramTotalGb: payload.telemetry?.vramTotalGb ?? 16.0,
                  vramPercent: payload.telemetry?.vramPercent ?? 92,
                  hostRamUsedGb: payload.telemetry?.hostRamUsedGb ?? 24.0,
                  hostRamTotalGb: payload.telemetry?.hostRamTotalGb ?? 128.0,
                  hostRamPercent: payload.telemetry?.hostRamPercent ?? 19,
                  gpuUtilization: payload.telemetry?.gpuUtilization ?? 12,
                  cpuUtilization: payload.telemetry?.cpuUtilization ?? 8,
                  activeTier: payload.tabby?.activeTier || 'high',
                  activeModel: payload.tabby?.activeModel || 'qwen3.8-flash-next-iq3_s',
                  tokensPerSec: payload.tabby?.tokensPerSec ?? 74.2,
                  lastSwapDurationMs: payload.tabby?.lastSwapDurationMs ?? 840,
                  sysramCache: payload.tabby?.sysramCache,
                  daemonPort: payload.ports?.daemonPort ?? 3390,
                  tabbyPort: payload.ports?.tabbyPort ?? 8080,
                  lanUrl: payload.ports?.lanUrl ?? window.location.origin,
                });
              }
            } else if (type === 'BRAIN_PROVIDER_UPDATED') {
              store.setBrainProviderState(payload || {});
            } else if (type === 'COMFY_CONFIG_UPDATED') {
              pendingClientPrefSync = false;
              store.setComfyStudioState({ ...(payload || {}), apiUnsupported: false });
            } else if (type === 'MODEL_STATE') {
              store.setModelState(payload.status, payload.active_model, payload.status_text);
              if (payload.active_tier) store.setSelectedTier(payload.active_tier);
              telemetryStore.setTelemetry({
                activeTier: payload.active_tier,
                activeModel: payload.active_model,
                ...(payload.tokens_per_sec ? { tokensPerSec: payload.tokens_per_sec } : {}),
                ...(payload.swap_duration_ms ? { lastSwapDurationMs: payload.swap_duration_ms } : {}),
                ...(payload.sysram_cache ? { sysramCache: payload.sysram_cache } : {}),
              });
            } else if (type === 'TURN_PHASE') {
              store.applyTurnPhase(payload);
              if (isForActiveThread && !payload?.is_active) {
                setAdaptiveCotLabel('');
              }
            } else if (type === 'TURN_STARTED') {
              if (!isForActiveThread) {
                store.setThreadStatus(evtThreadId!, 'thinking');
                return;
              }
              store.applyLegacyTurnStart(payload);
            } else if (type === 'THOUGHT_STREAM') {
              if (!isForActiveThread) {
                store.setThreadStatus(evtThreadId!, 'thinking');
                return;
              }
              if (isStaleTurnEvent) return;
              if (!isPhaseProtocolActive()) store.setIsGenerating(true);
              if (payload.tokens_per_sec) {
                telemetryStore.setTelemetry({ tokensPerSec: payload.tokens_per_sec });
              }
              store.appendStreamingThought(
                payload.chunk,
                payload.elapsed_ms,
                payload.token_count,
                payload.is_finished
              );
            } else if (type === 'TOKEN_STREAM') {
              if (!isForActiveThread) return;
              if (isStaleTurnEvent) return;
              if (payload.tokens_per_sec) {
                telemetryStore.setTelemetry({ tokensPerSec: payload.tokens_per_sec });
              }
              if (payload.chunk) {
                store.updateLastAssistantMessage(
                  payload.chunk,
                  payload.output_tokens,
                  payload.tokens_per_sec,
                  payload.message_id
                );
              }
              if (payload.is_finished) {
                store.finalizeAssistantMessage(payload.message_id);
                if (!isPhaseProtocolActive()) {
                  store.setIsGenerating(false);
                }
                setAdaptiveCotLabel('');
              } else if (!isPhaseProtocolActive()) {
                store.setIsGenerating(true);
              }
            } else if (type === 'TURN_COMPLETED' || type === 'TURN_ABORTED' || type === 'TURN_ERROR') {
              const phase =
                type === 'TURN_ABORTED' ? 'aborted' : type === 'TURN_ERROR' ? 'error' : 'completed';
              if (!isForActiveThread) {
                store.setThreadStatus(evtThreadId!, phase === 'error' ? 'error' : 'idle');
                return;
              }
              store.applyLegacyTurnEnd(payload, phase);
              if (!isStaleTurnEvent) setAdaptiveCotLabel('');
            } else if (type === 'STEP_NOTE_COMMITTED') {
              if (!isForActiveThread || isStaleTurnEvent) return;
              if (!isPhaseProtocolActive()) store.setIsGenerating(true);
              store.commitAssistantStepNote(payload.note, payload.committed_content, payload.message_id);
            } else if (type === 'SUBAGENT_EVENT') {
              if (!isForActiveThread) return;
              if (!isPhaseProtocolActive()) {
                if (payload?.status === 'running') {
                  store.setIsGenerating(true);
                } else if (payload?.status === 'completed' || payload?.status === 'error') {
                  if (!store.activeTurn?.isActive) store.setIsGenerating(false);
                }
              }
              store.upsertSubagentTask(payload);
            } else if (type === 'TOOL_EVENT') {
              if (!isForActiveThread) {
                store.setThreadStatus(
                  evtThreadId!,
                  payload?.status === 'running' ? 'executing_tool' : 'thinking'
                );
                return;
              }
              if (isStaleTurnEvent) return;
              if (!isPhaseProtocolActive() && payload?.status === 'running') {
                store.setIsGenerating(true);
              }
              store.updateLastAssistantTool(payload.command, payload.output, payload.status, {
                id: payload.tool_execution_id,
                toolName: payload.tool_name,
                durationMs: payload.duration_ms,
                exitCode: payload.exit_code,
                messageId: payload.message_id,
              });
            } else if (type === 'TOOL_STREAM') {
              if (!isForActiveThread || isStaleTurnEvent) return;
              if (!isPhaseProtocolActive()) store.setIsGenerating(true);
              if (payload?.chunk) {
                store.updateLastAssistantTool(
                  payload.tool_name || '',
                  payload.chunk,
                  'running',
                  {
                    id: payload.tool_execution_id,
                    appendOutput: true,
                    messageId: payload.message_id,
                  }
                );
              }
            } else if (type === 'CHECKPOINT_CREATED') {
              if (!isForActiveThread) return;
              if (payload.checkpoint) {
                const latestCheckpoints = useArtifactStore.getState().checkpoints;
                artStore.setCheckpoints([payload.checkpoint, ...latestCheckpoints]);
              }
            } else if (type === 'VISION_CAPTURE') {
              if (payload?.base64DataUrl) {
                artStore.setLatestVisionCapture(payload);
              }
            } else if (type === 'ARTIFACT_SYNC') {
              const syncId = payload.id || payload.artifact_name || 'art-' + Date.now();
              const syncType =
                payload.type ||
                (payload.artifact_name === 'walkthrough.md'
                  ? 'walkthrough'
                  : payload.artifact_name === 'task.md'
                  ? 'task'
                  : payload.artifact_name?.endsWith('.html')
                  ? 'html'
                  : 'plan');
              if (payload.id || payload.requestFeedback !== undefined || syncType === 'html') {
                artStore.upsertArtifact({
                  id: syncId,
                  threadId: evtThreadId || activeThreadId,
                  title: payload.title || payload.artifact_name,
                  type: syncType,
                  content: payload.content || '',
                  requestFeedback: Boolean(payload.requestFeedback),
                  userFacing: payload.userFacing,
                  updatedAt: Date.now(),
                });
              }
              if (payload.artifact_name === 'task.md' || syncType === 'task') {
                artStore.setTaskMarkdown(payload.content);
              } else if (payload.artifact_name === 'walkthrough.md' || syncType === 'walkthrough') {
                artStore.setWalkthroughMarkdown(payload.content);
                artStore.setActiveArtifactDoc('walkthrough.md');
                if (payload.id) artStore.setActiveArtifactId(syncId);
                artStore.setActiveTab('plan');
                onOpenRightDrawerRef.current();
              } else if (syncType === 'html') {
                artStore.setActiveArtifactId(syncId);
                artStore.setActiveArtifactDoc(syncId);
                artStore.setActiveTab('plan');
                onOpenRightDrawerRef.current();
              } else if (
                payload.artifact_name === 'implementation_plan.md' ||
                payload.artifact_name === 'plan.md' ||
                syncType === 'plan'
              ) {
                artStore.setPlanMarkdown(payload.content);
                artStore.setActiveArtifactDoc('plan.md');
                if (payload.id) artStore.setActiveArtifactId(syncId);
                artStore.setActiveTab('plan');
                onOpenRightDrawerRef.current();
              }
            } else if (type === 'ARTIFACT_UPDATED') {
              const art = payload?.artifact;
              if (art) {
                const artId = art.id || art.title || 'art-' + Date.now();
                artStore.upsertArtifact({
                  id: artId,
                  threadId: art.threadId || art.thread_id || evtThreadId || activeThreadId,
                  title: art.title,
                  type: art.type,
                  content: art.content || '',
                  summary: art.summary,
                  filePath: art.filePath || art.file_path,
                  requestFeedback: Boolean(art.requestFeedback),
                  userFacing: art.userFacing,
                  updatedAt: art.updatedAt || Date.now(),
                });
                if (art.type === 'plan') {
                  artStore.setPlanMarkdown(art.content);
                  artStore.setActiveArtifactId(artId);
                  artStore.setActiveArtifactDoc('plan.md');
                  artStore.setActiveTab('plan');
                  onOpenRightDrawerRef.current();
                } else if (art.type === 'walkthrough') {
                  artStore.setWalkthroughMarkdown(art.content);
                  artStore.setActiveArtifactId(artId);
                  artStore.setActiveArtifactDoc('walkthrough.md');
                  artStore.setActiveTab('plan');
                  onOpenRightDrawerRef.current();
                } else if (art.type === 'html') {
                  artStore.setActiveArtifactId(artId);
                  artStore.setActiveArtifactDoc(artId);
                  artStore.setActiveTab('plan');
                  onOpenRightDrawerRef.current();
                } else if (art.type === 'task') {
                  artStore.setTaskMarkdown(art.content);
                }
              }
            } else if (type === 'COUNTDOWN') {
              const rem = Number(payload?.secondsRemaining || 0);
              const tot = Number(payload?.totalSeconds || rem || 10);
              setTimerCountdown(rem);
              setTimerTotal(tot);
              setTimerLabel(payload?.label || 'Timer');
            } else if (type === 'TIMER_FIRED') {
              setTimerCountdown(0);
              if (payload?.prompt) {
                store.addMessage({
                  id: 'sys-timer-' + Date.now(),
                  role: 'system',
                  content: `⏰ **Scheduled Timer Fired:** ${payload.prompt}`,
                  timestamp: Date.now(),
                });
              }
            } else if (
              type === 'SWARM_STATE' ||
              type === 'SWARM_MESSAGE' ||
              type === 'SWARM_MEMBER_UPDATED'
            ) {
              if (!isForActiveThread) return;
              store.applySwarmEvent(type, payload);
            } else if (type === 'BACKGROUND_TASK_UPDATED') {
              if (Array.isArray(payload?.allTasks)) {
                store.setBackgroundTasks(payload.allTasks);
              }
            } else if (type === 'CONTEXT_COMPACTED') {
              setLastCompaction({
                previousTokens: payload?.previousTokens || 0,
                compactedTokens: payload?.compactedTokens || 0,
              });
            } else if (type === 'ADAPTIVE_COT_STATE') {
              if (!isForActiveThread) return;
              if (!isPhaseProtocolActive()) store.setIsGenerating(true);
              setAdaptiveCotLabel(payload?.modeLabel || '');
            } else if (type === 'TELEMETRY') {
              telemetryStore.setTelemetry({
                vramUsedGb: payload.vram_used_gb,
                vramTotalGb: payload.vram_total_gb,
                vramPercent: payload.vram_percent,
                hostRamUsedGb: payload.host_ram_used_gb,
                hostRamTotalGb: payload.host_ram_total_gb,
                gpuUtilization: payload.gpu_utilization_percent,
                cpuUtilization: payload.cpu_utilization_percent,
                ...(payload.tokens_per_sec ? { tokensPerSec: payload.tokens_per_sec } : {}),
                ...(payload.swap_duration_ms ? { lastSwapDurationMs: payload.swap_duration_ms } : {}),
                ...(payload.sysram_cache ? { sysramCache: payload.sysram_cache } : {}),
              });
            }
          } catch (e) {
            console.error('Failed to parse incoming WebSocket message', e);
          }
        };
      } catch {
        if (!isDisposed) {
          useSessionStore.getState().setIsConnected(false);
          setReconnectAttempt((prev) => prev + 1);
          setReconnectCountdown(3);
        }
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        try {
          ws.close();
        } catch {}
      }
    };
  }, [hostUrl, brainHost, brainPort, reconnectKey]);

  // Reset turn-protocol tracking when switching backend hosts
  useEffect(() => {
    resetTurnProtocolState();
  }, [hostUrl]);

  // Reconnection countdown timer (ticks every second when disconnected)
  const isCountingDown = !isConnected && reconnectCountdown > 0;
  useEffect(() => {
    if (isConnected) {
      setReconnectCountdown(0);
      setReconnectAttempt(0);
      return;
    }

    if (!isCountingDown) return;

    const timer = setInterval(() => {
      setReconnectCountdown((curr) => (curr <= 1 ? 0 : curr - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isConnected, isCountingDown]);

  const prevReconnectCountdownRef = useRef(0);
  useEffect(() => {
    if (!isConnected && prevReconnectCountdownRef.current === 1 && reconnectCountdown === 0) {
      handleManualReconnect();
    }
    prevReconnectCountdownRef.current = reconnectCountdown;
  }, [isConnected, reconnectCountdown, handleManualReconnect]);

  // Scheduled Timer live countdown effect
  const hasActiveTimer = timerCountdown > 0;
  useEffect(() => {
    if (!hasActiveTimer) return;
    const t = setInterval(() => {
      setTimerCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [hasActiveTimer]);

  // Proactive HTTP health probe when disconnected: detects server recovery & auto-discovers port
  useEffect(() => {
    if (isConnected) return;
    let isDisposed = false;

    const probe = async () => {
      const candidatePorts = [brainPort, '3390', '3391', '3392', '3393'].filter(
        (v, i, a) => a.indexOf(v) === i
      );

      for (const p of candidatePorts) {
        if (isDisposed) return;
        try {
          const res = await fetch(`http://${brainHost}:${p}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(900),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.status === 'ok') {
              if (p !== brainPort) {
                useSessionStore.getState().setBrainConnection(brainHost, p);
              } else {
                handleManualReconnect();
              }
              return;
            }
          }
        } catch {}
      }
    };

    const interval = setInterval(probe, 1500);
    probe();

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [isConnected, brainHost, brainPort, handleManualReconnect]);

  return {
    wsRef,
    reconnectCountdown,
    reconnectAttempt,
    handleManualReconnect,
    timerCountdown,
    timerTotal,
    timerLabel,
    lastCompaction,
    adaptiveCotLabel,
  };
}
