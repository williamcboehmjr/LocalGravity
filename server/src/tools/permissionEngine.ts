import fs from 'node:fs';
import path from 'node:path';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  id: string;
  toolPattern: string;
  commandPattern?: string;
  action: PermissionDecision;
  description?: string;
}

export interface PermissionEvaluation {
  decision: PermissionDecision;
  matchedRule?: PermissionRule;
  reason?: string;
}

const DEFAULT_RULES: PermissionRule[] = [
  {
    id: 'deny-destructive-root-rm',
    toolPattern: 'run_terminal',
    commandPattern: '*rm -rf /*',
    action: 'deny',
    description: 'Block destructive recursive root deletion',
  },
  {
    id: 'deny-format-drive',
    toolPattern: 'run_terminal',
    commandPattern: '*format ?:/*',
    action: 'deny',
    description: 'Block drive formatting commands',
  },
  {
    id: 'deny-remove-root-ps',
    toolPattern: 'run_terminal',
    commandPattern: '*Remove-Item -Recurse -Force C:\\*',
    action: 'deny',
    description: 'Block recursive C: drive deletion',
  },
  {
    id: 'allow-readonly-tools',
    toolPattern: 'read_file',
    action: 'allow',
    description: 'Allow read-only file inspection',
  },
  {
    id: 'allow-list-dir',
    toolPattern: 'list_directory',
    action: 'allow',
    description: 'Allow directory listing',
  },
  {
    id: 'allow-search-codebase',
    toolPattern: 'search_codebase',
    action: 'allow',
    description: 'Allow codebase search',
  },
  {
    id: 'allow-lsp-diagnostics',
    toolPattern: 'lsp_diagnostics',
    action: 'allow',
    description: 'Allow LSP diagnostics and repo map',
  },
  {
    id: 'allow-git-readonly',
    toolPattern: 'run_terminal',
    commandPattern: 'git status*',
    action: 'allow',
    description: 'Allow read-only git status checks',
  },
  {
    id: 'allow-git-diff',
    toolPattern: 'run_terminal',
    commandPattern: 'git diff*',
    action: 'allow',
    description: 'Allow read-only git diff checks',
  },
  {
    id: 'default-allow-all',
    toolPattern: '*',
    action: 'allow',
    description: 'Default local workstation execution policy',
  },
];

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

export class PermissionEngine {
  private rulesPath: string;
  private rules: PermissionRule[] = [];

  constructor(repoRoot: string) {
    this.rulesPath = path.join(repoRoot, '.runtime', 'permissions.json');
    this.load();
  }

  public load(): PermissionRule[] {
    try {
      if (fs.existsSync(this.rulesPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.rulesPath, 'utf-8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.rules = parsed;
          return this.rules;
        }
      }
    } catch {}
    this.rules = [...DEFAULT_RULES];
    return this.rules;
  }

  public saveRules(rules: PermissionRule[]): PermissionRule[] {
    this.rules = rules;
    try {
      fs.mkdirSync(path.dirname(this.rulesPath), { recursive: true });
      fs.writeFileSync(this.rulesPath, JSON.stringify(this.rules, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[PermissionEngine] Failed to persist rules:', err);
    }
    return this.rules;
  }

  public listRules(): PermissionRule[] {
    return this.rules;
  }

  public upsertRule(rule: PermissionRule): PermissionRule[] {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    const next = [...this.rules];
    if (idx >= 0) {
      next[idx] = rule;
    } else {
      // Insert custom rules above fallback wildcard rules
      next.unshift(rule);
    }
    return this.saveRules(next);
  }

  public deleteRule(id: string): PermissionRule[] {
    return this.saveRules(this.rules.filter((r) => r.id !== id));
  }

  public evaluate(toolName: string, args: Record<string, any> = {}): PermissionEvaluation {
    const commandTarget = String(
      args.command ?? args.path ?? args.Path ?? args.ServerName ?? args.query ?? ''
    ).trim();

    for (const rule of this.rules) {
      if (!globMatch(rule.toolPattern, toolName)) continue;
      if (rule.commandPattern && !globMatch(rule.commandPattern, commandTarget)) continue;
      return {
        decision: rule.action,
        matchedRule: rule,
        reason: rule.description,
      };
    }

    return { decision: 'allow' };
  }
}
