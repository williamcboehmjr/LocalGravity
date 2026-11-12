import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SkillDefinition {
  name: string;
  description: string;
  skillPath: string;
  rootType: 'user' | 'builtin' | 'workspace';
}

export const SKILL_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List all available specialized skills in LocalGravity with their names, descriptions, and file paths.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description: 'Read the full instructions, guidelines, and rules for a specific skill by name.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The exact name of the skill (e.g. "localgravity-guide", "automation", "generative_ui", "gemma-local-agent").',
          },
        },
        required: ['name'],
      },
    },
  },
];

export class SkillManager {
  private skills = new Map<string, SkillDefinition>();
  private skillRoots: Array<{ path: string; rootType: 'user' | 'builtin' | 'workspace' }> = [];

  constructor(workspaceRoot: string) {
    const userProfile = os.homedir();
    this.skillRoots = [
      // 1. User Global Skills (e.g. Gemma Local Agent)
      {
        path: path.join(userProfile, '.gemini', 'config', 'skills'),
        rootType: 'user',
      },
      // 2. LocalGravity Builtin Skills (e.g. localgravity-guide, automation, generative_ui)
      {
        path: path.join(userProfile, '.gemini', 'localgravity', 'builtin', 'skills'),
        rootType: 'builtin',
      },
      // 3. User .agents/skills (LocalGravity standard)
      {
        path: path.join(userProfile, '.agents', 'skills'),
        rootType: 'user',
      },
      // 4. Workspace Local Skills (.localgravity & .agents/skills)
      {
        path: path.join(workspaceRoot, '.localgravity', 'harness', 'skills'),
        rootType: 'workspace',
      },
      {
        path: path.join(workspaceRoot, '.agents', 'skills'),
        rootType: 'workspace',
      },
    ];
    this.discoverSkills();
  }

  public discoverSkills(): SkillDefinition[] {
    this.skills.clear();

    for (const root of this.skillRoots) {
      if (!fs.existsSync(root.path)) continue;

      try {
        const entries = fs.readdirSync(root.path, { withFileTypes: true });
        for (const entry of entries) {
          // Strictly exclude non-coding or external project skills
          if (entry.name.toLowerCase().includes('glasshouse') || entry.name.toLowerCase().includes('glass_house')) {
            continue;
          }

          if (entry.isDirectory()) {
            const skillMd = path.join(root.path, entry.name, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
              const def = this.parseSkillFile(skillMd, entry.name, root.rootType);
              if (def) {
                this.skills.set(def.name, def);
              }
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const filePath = path.join(root.path, entry.name);
            const baseName = path.basename(entry.name, '.md');
            const def = this.parseSkillFile(filePath, baseName, root.rootType);
            if (def) {
              this.skills.set(def.name, def);
            }
          }
        }
      } catch (err) {
        console.error(`[SkillManager] Failed to read skills from ${root.path}:`, err);
      }
    }

    return Array.from(this.skills.values());
  }

  private parseSkillFile(
    filePath: string,
    defaultName: string,
    rootType: 'user' | 'builtin' | 'workspace'
  ): SkillDefinition | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      let name = defaultName;
      let description = `Skill defined at ${filePath}`;

      // Parse YAML frontmatter if present
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (match) {
        const frontmatter = match[1];
        const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
        const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
      } else {
        // Fallback: extract first heading as description
        const headingMatch = content.match(/^#+\s*(.+)$/m);
        if (headingMatch) {
          description = headingMatch[1].trim();
        }
      }

      return {
        name,
        description,
        skillPath: filePath.replace(/\\/g, '/'),
        rootType,
      };
    } catch {
      return null;
    }
  }

  public listSkills(): SkillDefinition[] {
    if (this.skills.size === 0) {
      this.discoverSkills();
    }
    return Array.from(this.skills.values());
  }

  public readSkill(name: string): { name: string; path: string; content: string } | null {
    const skill = this.skills.get(name);
    if (!skill || !fs.existsSync(skill.skillPath)) {
      // Fuzzy lookup by base name
      for (const [k, v] of this.skills.entries()) {
        if (k.toLowerCase() === name.toLowerCase() || k.includes(name) || name.includes(k)) {
          if (fs.existsSync(v.skillPath)) {
            return {
              name: v.name,
              path: v.skillPath,
              content: fs.readFileSync(v.skillPath, 'utf-8'),
            };
          }
        }
      }
      return null;
    }

    return {
      name: skill.name,
      path: skill.skillPath,
      content: fs.readFileSync(skill.skillPath, 'utf-8'),
    };
  }

  public buildSkillsPromptSection(): string {
    const list = this.listSkills();
    if (list.length === 0) return '';

    let out = '<skills>\n';
    out += 'You can use specialized skills to help you with complex tasks. Each skill has detailed guidelines and production rules.\n';
    out += 'If a skill seems relevant to what you are doing, you MUST read its instructions using `read_skill({ name })` before proceeding.\n\n';
    out += 'Available skills:\n';

    for (const s of list) {
      out += `- ${s.name} (${s.skillPath}): ${s.description}\n`;
    }
    out += '</skills>\n';
    return out;
  }
}
