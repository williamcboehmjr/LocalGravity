import type { ActiveTurnSnapshot, TurnPhaseName } from './promptTurn.js';

export interface TurnPhaseEmitterOptions {
  threadId: string;
  turnId: string;
  initialMaxSteps: number;
  activeTurns?: Map<string, ActiveTurnSnapshot>;
  send: (event: Record<string, any>) => void;
}

export class TurnPhaseEmitter {
  private seq = 0;
  private step = 0;
  private maxSteps: number;
  private thinkingFinished = false;
  private lastPhase: TurnPhaseName | null = null;
  private lastLabel = '';
  private terminalSent = false;

  constructor(private readonly opts: TurnPhaseEmitterOptions) {
    this.maxSteps = opts.initialMaxSteps;
  }

  public setStepState(step: number, maxSteps: number, thinkingFinished: boolean): void {
    this.step = step;
    this.maxSteps = maxSteps;
    this.thinkingFinished = thinkingFinished;
  }

  public setThinkingFinished(finished: boolean): void {
    this.thinkingFinished = finished;
  }

  public emit(
    phase: TurnPhaseName,
    statusLabel: string,
    extra: { active_tool_id?: string; error?: string } = {}
  ): void {
    const isActive = !(phase === 'completed' || phase === 'aborted' || phase === 'error');
    if (!isActive) {
      if (this.terminalSent) return;
      this.terminalSent = true;
    } else if (this.terminalSent) {
      return;
    }
    if (phase === this.lastPhase && statusLabel === this.lastLabel && !extra.active_tool_id) {
      return;
    }
    this.lastPhase = phase;
    this.lastLabel = statusLabel;

    const payload: ActiveTurnSnapshot = {
      seq: ++this.seq,
      thread_id: this.opts.threadId,
      threadId: this.opts.threadId,
      turn_id: this.opts.turnId,
      message_id: this.opts.turnId,
      phase,
      is_active: isActive,
      step: this.step,
      max_steps: this.maxSteps,
      status_label: statusLabel,
      thinking_finished: this.thinkingFinished,
      ...(extra.active_tool_id ? { active_tool_id: extra.active_tool_id } : {}),
      ...(extra.error ? { error: extra.error } : {}),
      timestamp: Date.now(),
    };

    if (isActive) {
      this.opts.activeTurns?.set(this.opts.threadId, payload);
    } else if (this.opts.activeTurns?.get(this.opts.threadId)?.turn_id === this.opts.turnId) {
      this.opts.activeTurns.delete(this.opts.threadId);
    }

    this.opts.send({ type: 'TURN_PHASE', payload });
  }
}
