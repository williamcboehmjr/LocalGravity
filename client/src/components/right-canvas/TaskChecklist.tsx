import React from 'react';
import { CheckSquare, Square, ListTodo } from 'lucide-react';
import { useArtifactStore } from '../../store/useArtifactStore';

interface TaskChecklistProps {
  onSync?: (markdown: string) => void;
}

export const TaskChecklist: React.FC<TaskChecklistProps> = ({ onSync }) => {
  const { parsedTasks, toggleTask } = useArtifactStore();

  const handleToggle = (id: string) => {
    const updatedMd = toggleTask(id);
    if (onSync) onSync(updatedMd);
  };

  // Group by category
  const categories = Array.from(new Set(parsedTasks.map((t) => t.category || 'General')));

  const total = parsedTasks.length;
  const completed = parsedTasks.filter((t) => t.completed).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs">
      {/* Progress Header */}
      <div className="p-3 bg-surface border-b border-border-subtle space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium text-text-primary">
            <ListTodo className="w-3.5 h-3.5 text-accent-blue" />
            <span>Task Checklist (task.md)</span>
          </div>
          <span className="font-mono text-text-muted">{completed}/{total} ({percent}%)</span>
        </div>

        <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-blue transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {categories.map((cat) => {
          const tasksInCat = parsedTasks.filter((t) => (t.category || 'General') === cat);
          return (
            <div key={cat} className="space-y-1.5">
              <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider px-1">
                {cat}
              </h4>
              <div className="space-y-1">
                {tasksInCat.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => handleToggle(task.id)}
                    className="group flex items-start gap-2.5 p-2 rounded-lg hover:bg-surface-muted cursor-pointer transition-colors select-none"
                  >
                    <button className="mt-0.5 shrink-0 text-accent-blue">
                      {task.completed ? (
                        <CheckSquare className="w-4 h-4 fill-accent-blue/20" />
                      ) : (
                        <Square className="w-4 h-4 text-text-muted group-hover:text-text-secondary" />
                      )}
                    </button>
                    <span
                      className={`leading-relaxed text-xs transition-colors ${
                        task.completed
                          ? 'line-through text-text-muted'
                          : 'text-text-primary group-hover:text-white'
                      }`}
                    >
                      {task.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
