import React, { useState } from 'react';
import { Folder, Edit2, Check } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

export const WorkspacePicker: React.FC = () => {
  const { workspacePath, setWorkspacePath } = useSessionStore();
  const [isEditing, setIsEditing] = useState(false);
  const [tempPath, setTempPath] = useState(workspacePath);

  const handleSave = () => {
    setWorkspacePath(tempPath.trim());
    setIsEditing(false);
  };

  return (
    <div className="p-3 bg-surface border border-border-subtle rounded-lg">
      <div className="flex items-center justify-between text-xs text-text-secondary mb-1.5">
        <span className="flex items-center gap-1 font-medium text-text-primary">
          <Folder className="w-3.5 h-3.5 text-accent-blue" />
          <span>Active Workspace</span>
        </span>
        <button
          onClick={() => isEditing ? handleSave() : setIsEditing(true)}
          className="p-1 hover:bg-surface-muted rounded text-text-muted hover:text-text-primary transition-colors"
          title={isEditing ? 'Save path' : 'Edit path'}
        >
          {isEditing ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Edit2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isEditing ? (
        <input
          type="text"
          value={tempPath}
          onChange={(e) => setTempPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="w-full bg-canvas border border-accent-blue/50 rounded px-2 py-1 text-xs text-text-primary font-mono outline-none"
          autoFocus
        />
      ) : (
        <div
          onClick={() => setIsEditing(true)}
          className="text-xs font-mono text-text-secondary truncate hover:text-text-primary cursor-pointer"
          title={workspacePath}
        >
          {workspacePath}
        </div>
      )}
    </div>
  );
};
