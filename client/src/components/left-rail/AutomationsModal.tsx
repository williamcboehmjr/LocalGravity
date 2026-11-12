import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  Plus,
  Play,
  Trash2,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';
import { ModelTier } from '../../types/protocol';

interface AutomationItem {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  tier: ModelTier;
  enabled: boolean;
  lastRunAt: string | null;
}

interface AutomationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunAutomationNow?: (prompt: string, tier: ModelTier) => void;
}

export const AutomationsModal: React.FC<AutomationsModalProps> = ({
  isOpen,
  onClose,
  onRunAutomationNow,
}) => {
  const { apiBaseUrl } = useSessionStore();
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCron, setNewCron] = useState('0 9 * * *');
  const [newPrompt, setNewPrompt] = useState('/goal ');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadAutomations = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/automations`);
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      loadAutomations();
    }
  }, [isOpen, apiBaseUrl]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          cron: newCron.trim() || '0 9 * * *',
          prompt: newPrompt.trim(),
          tier: 'high',
          enabled: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
        setIsCreating(false);
        setNewName('');
        setNewPrompt('/goal ');
        setStatusMsg('Scheduled task created!');
        setTimeout(() => setStatusMsg(null), 2200);
      }
    } catch {}
  };

  const handleToggle = async (item: AutomationItem) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/automations/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/automations/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-lg max-h-[85%] flex flex-col bg-[#16171A] border border-[#2D2F34] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#25272C] bg-[#1B1C20] shrink-0">
          <div className="flex items-center gap-2 font-medium text-[#E8EAED] text-sm">
            <Clock className="w-4 h-4 text-orange-400" />
            <span>Scheduled Tasks & Automations (/schedule)</span>
          </div>
          <div className="flex items-center gap-2">
            {statusMsg && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                {statusMsg}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 hover:bg-[#282A2E] rounded text-[#9AA0A6] hover:text-[#E8EAED] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 text-xs flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-[#9AA0A6]">
              Configure standing background automations executed by{' '}
              <strong className="text-[#E8EAED]">Strata • Qwen 3.8 Flash-Next</strong>.
            </p>
            <button
              type="button"
              onClick={() => setIsCreating(!isCreating)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#8AB4F8] hover:bg-[#A8C7FA] text-[#101114] font-semibold text-xs transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Schedule</span>
            </button>
          </div>

          {isCreating && (
            <div className="p-3 rounded-xl bg-[#111214] border border-[#2D2F34] space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] text-[#80868B] uppercase tracking-wider">
                    Task Name
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Morning Git & Build Check"
                    className="w-full bg-[#18191C] border border-[#2C2E33] rounded-lg px-2.5 py-1.5 text-xs text-[#E8EAED] outline-none focus:border-[#8AB4F8]"
                  />
                </div>
                <div className="col-span-1 space-y-1">
                  <label className="text-[10px] text-[#80868B] uppercase tracking-wider">
                    Cron (5-field)
                  </label>
                  <input
                    type="text"
                    value={newCron}
                    onChange={(e) => setNewCron(e.target.value)}
                    placeholder="0 9 * * *"
                    className="w-full bg-[#18191C] border border-[#2C2E33] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#E8EAED] outline-none focus:border-[#8AB4F8]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-[#80868B] uppercase tracking-wider">
                  Autonomous Prompt / Slash Command
                </label>
                <textarea
                  rows={2}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="/goal Check git status, run tests, and summarize findings"
                  className="w-full bg-[#18191C] border border-[#2C2E33] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#E8EAED] outline-none focus:border-[#8AB4F8] resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-2.5 py-1 rounded text-xs text-[#9AA0A6] hover:text-[#E8EAED]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="px-3 py-1 rounded-lg bg-[#E8EAED] hover:bg-white text-[#101114] font-semibold text-xs cursor-pointer"
                >
                  Save Automation
                </button>
              </div>
            </div>
          )}

          {/* List of Automations */}
          <div className="space-y-2">
            {automations.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-xl bg-[#1B1C20] border border-[#282A2F] flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#E8EAED] text-xs truncate">
                      {item.name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[#111214] border border-[#2C2E33] font-mono text-[10px] text-orange-300">
                      {item.cron}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[#111214] border border-[#2C2E33] font-mono text-[10px] text-[#8AB4F8]">
                      Qwen 3.8 Flash-Next
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-[#9AA0A6] truncate">
                    {item.prompt}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggle(item)}
                    className={`px-2 py-1 rounded text-[10.5px] font-medium cursor-pointer transition-colors ${
                      item.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                        : 'bg-[#111214] text-[#6E6E73] border border-[#282A2F]'
                    }`}
                  >
                    {item.enabled ? 'Active' : 'Paused'}
                  </button>

                  {onRunAutomationNow && (
                    <button
                      type="button"
                      onClick={() => {
                        onRunAutomationNow(item.prompt, item.tier || 'high');
                        onClose();
                      }}
                      className="p-1.5 rounded-lg bg-[#24262B] hover:bg-[#2E3036] text-[#8AB4F8] transition-colors cursor-pointer"
                      title="Trigger Automation Now"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-950/50 text-[#6E6E73] hover:text-rose-400 transition-colors cursor-pointer"
                    title="Delete Automation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#1B1C20] border-t border-[#25272C] flex items-center justify-between text-[11px] text-[#80868B]">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#8AB4F8]" />
            <span>Persisted in .localgravity/harness/automations.json</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-[#282A2E] hover:bg-[#32343A] text-[#E8EAED] font-medium cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
