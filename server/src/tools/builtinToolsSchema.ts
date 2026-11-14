// Auto-extracted from builtinTools.ts — static tool schema definitions.
export const BUILTIN_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description:
        'Execute any shell or system command in the interactive terminal (powershell.exe on Windows, /bin/zsh on macOS) with full workstation permissions and stream live stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Optional working directory anywhere on the system' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of any file on the workstation (supports relative workspace paths, system aliases like "strata", "models", and absolute system paths like ~/Downloads/file.txt).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, system alias, or absolute system file path' },
          start_line: { type: 'number', description: 'Optional 1-based start line' },
          end_line: { type: 'number', description: 'Optional 1-based end line' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to any file on the system or workspace with automatic pre-edit snapshot backup in file_checkpoints for 1-click undo/revert.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, system alias, or absolute system file path' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Use this tool to edit an existing file. Replaces the exact Target string with the Replacement string, with automatic checkpoint rollback snapshot.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path or absolute file path to modify' },
          target: { type: 'string', description: 'The exact character sequence to be replaced' },
          replacement: { type: 'string', description: 'The content to replace the target with' },
        },
        required: ['path', 'target', 'replacement'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_diff',
      description:
        'Apply a target/replacement edit to any file on the system or workspace with automatic pre-edit snapshot backup in file_checkpoints for 1-click undo/revert.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, system alias, or absolute system file path' },
          target: { type: 'string', description: 'Exact string block to replace' },
          replacement: { type: 'string', description: 'Replacement string block' },
        },
        required: ['path', 'target', 'replacement'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description:
        'SEARCH THE LIVE WEB IMMEDIATELY: Your primary instinct when you do not know an answer with 100% certainty, or when dealing with current documentation, library usage, how-to guides, error codes, recipe/drink ingredients, prices, or technical tutorials. DO NOT GUESS or make excuses. Call this tool freely and frequently—it runs in under 1 second and provides verified real-world facts, titles, snippets, and source URLs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query or error message' },
          limit: { type: 'number', description: 'Optional maximum results to return (default: 8, max: 15)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_models',
      description:
        'Search Hugging Face Model Hub for open-source AI models, GGUF quantizations, and mmproj vision projectors, or list files in any repository directly.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Model keywords or filename filter (e.g. "Qwen3.8-Flash-Next", "mmproj", "gguf")',
          },
          repo: {
            type: 'string',
            description: 'Optional specific Hugging Face repository to list files for (e.g. "ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF")',
          },
          limit: { type: 'number', description: 'Optional maximum models to return (default: 8)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description:
        'Recursively locate files by filename or pattern across directories (e.g. "setup.py", "*.json", "*vision*", "mmproj*") without needing to guess directory structures.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Filename or wildcard pattern to search for (e.g. "setup.py", "*.json", "*vision*")',
          },
          path: {
            type: 'string',
            description: 'Optional starting directory (supports "strata", "models", "downloads", or absolute path; default: workspace root)',
          },
          max_results: { type: 'number', description: 'Optional maximum files to return (default: 50)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description:
        'Search file contents across any directory on the computer (workspace, strata, models, downloads, etc.). Uses safe case-insensitive substring matching by default with optional regex.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or regex pattern' },
          path: {
            type: 'string',
            description: 'Optional directory path (supports "strata", "models", "downloads", "desktop", or absolute paths; default: workspace root)',
          },
          file_pattern: { type: 'string', description: 'Optional file extension filter (e.g. .ts, .py, .json)' },
          is_regex: {
            type: 'boolean',
            description: 'Whether query should be treated as regex (default: false, safe literal substring)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'code_outline',
      description:
        'Extract a structured code outline (classes, functions, methods, interfaces, types, exports) with exact line numbers from source files (TypeScript, JavaScript, Python, C#, Rust, Go). Rapidly inspect file architecture without reading hundreds of lines.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to inspect (supports relative, aliases, or absolute)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_json',
      description:
        'Safely inspect, get, set, or delete keys in JSON configuration files (e.g. Strata iq3_s-64k.json, package.json, tsconfig.json) without fragile string replacements.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to JSON file (supports "strata/launch/iq3_s-64k.json", workspace, etc.)' },
          action: {
            type: 'string',
            enum: ['read', 'set', 'delete'],
            description: 'Action: "read" to inspect key or whole file, "set" to update/add key, "delete" to remove key',
          },
          key_path: {
            type: 'string',
            description: 'Optional dot-separated key path (e.g. "vision.elastic", "args", "scripts.build"). Omit to read full JSON.',
          },
          value: {
            description: 'Value to set (for action "set": can be boolean, number, string, array, or object)',
          },
        },
        required: ['path', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'download_file',
      description:
        'Download any remote file (model weights, mmproj projector, archive, script, dataset) directly to a local directory with streaming and validation.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Direct HTTP/HTTPS download URL' },
          destination: {
            type: 'string',
            description: 'Destination path or folder (supports "models", "strata", "downloads", workspace, or absolute path)',
          },
          filename: { type: 'string', description: 'Optional explicit filename (inferred from URL if omitted)' },
        },
        required: ['url', 'destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description:
        'Send an HTTP request (GET, POST, PUT, DELETE) to any local or remote API endpoint (e.g. Strata port 8080, ComfyUI port 8188, Ollama 11434, Central Brain 3390). Returns status, headers, and parsed data. (Ports 5000 and 5001 forbidden).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to call' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default: GET)' },
          headers: { type: 'object', description: 'Optional request headers' },
          body: { description: 'Optional request body (JSON object or string)' },
          timeout_ms: { type: 'number', description: 'Optional timeout in milliseconds (default: 10000)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_files',
      description:
        'Perform filesystem management: inspect file metadata ("stat"), copy file/directory ("copy"), move/rename ("move"), or safely delete ("delete").',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['stat', 'copy', 'move', 'delete'], description: 'File operation to perform' },
          source: { type: 'string', description: 'Source file or folder path' },
          destination: { type: 'string', description: 'Destination path (for copy or move)' },
        },
        required: ['action', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_models',
      description:
        'Inspect the local inference engines (Strata / TabbyAPI), loaded model metadata, vision/multimodal status, and local model files on disk (E:/Models and Strata launch configs). Also supports testing vision inference or restarting Strata.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['inspect', 'test_vision', 'restart'],
            description: '"inspect" (default): reports active model, vision status, context size, and disk models. "test_vision": sends a live multimodal test image to Strata and verifies end-to-end vision processing. "restart": restarts the Strata inference engine on port 8080.',
          },
          test_prompt: {
            type: 'string',
            description: 'Optional prompt when action is "test_vision" (default: "What color is this test image?")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_system',
      description:
        'Inspect workstation hardware and processes: GPU VRAM usage and temperature (Nvidia), active listening network ports, or running system processes.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['gpu_stats', 'list_ports', 'find_process'],
            description: 'Action: "gpu_stats" for VRAM/GPU utilization, "list_ports" for active listeners, "find_process" to search running processes by name',
          },
          filter: { type: 'string', description: 'Optional process name or port filter (e.g. "strata", "node", "8080", "3390")' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List files and subdirectories in any directory on the computer (e.g. "strata", "models", "downloads", "desktop", "C:/", or workspace root). Full system access is granted.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path (e.g. "strata", "models", "downloads", "C:/", or "." for workspace root)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_screen',
      description:
        'Capture a live screenshot of the desktop or active window for Vision-Language multimodal grounding.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['desktop', 'active_window'],
            description: 'Capture full desktop or active window',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_window',
      description: 'Inspect active desktop windows and capture grounding metadata + screenshot.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_inspect',
      description: 'Inspect a live web URL (DOM structure, title, headings, cleaned text content, and preview).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to inspect' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restart_brain',
      description:
        'Restart the LocalGravity Central Brain process. The Windows Tray supervisor immediately captures exit code 42 and reboots the daemon with fresh code, models, and tools. Use whenever the user asks to restart or reload LocalGravity.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Optional explanation for restart (e.g. "Reloading after code modifications")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_system_logs',
      description:
        'Read the latest system logs to diagnose issues autonomously: "strata" (Strata Engine port 8080 log), "tray" (LocalGravity tray supervisor log), or "daemon" (Central Brain runtime log).',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['strata', 'tray', 'daemon'],
            description: 'Log source to read: "strata" (Strata port 8080 log), "tray" (Tray supervisor log), "daemon" (Central Brain)',
          },
          lines: {
            type: 'number',
            description: 'Number of recent lines to read (default: 50, max: 200)',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_strata',
      description:
        'Inspect or control the Strata local inference engine on port 8080: "status" (check if active and get loaded model/context), "test_vision" (verify live multimodal vision processing with a test image), "restart" (reboot engine).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'test_vision', 'restart'],
            description: 'Action to perform on Strata engine',
          },
          test_prompt: {
            type: 'string',
            description: 'Optional prompt when action is "test_vision"',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_document',
      description:
        'Deeply inspect and parse documents (PDF, DOCX, TXT, CSV, Markdown, EPUB, JSON): extracts full text content, page count, document outline/info, and extracts embedded raster images (e.g. photos of drink menus, receipts, scanned book pages) to disk as JPG files for visual perception.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the document file on disk (supports relative, alias like "downloads/menu.pdf", or absolute path)',
          },
          extract_images: {
            type: 'boolean',
            description: 'Whether to extract embedded photos/raster images to disk for visual analysis (default true)',
          },
          max_pages: {
            type: 'number',
            description: 'Maximum number of pages or sections to extract text from (default 30)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_file_metadata',
      description:
        'Inspect deep metadata of any file, document, or image on the workstation: extracts image dimensions & EXIF metadata (camera make/model, lens, GPS coordinates, date/time, ISO, exposure, f-number), file hash (SHA-256), byte size, MIME type, and line/text stats.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to file or image (supports relative, alias like "downloads/photo.jpg", or absolute path)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_release',
      description:
        'Build, cryptographically sign, and publish an official LocalGravity release to GitHub. Automates compilation checks, version bumping, Windows MSI building with minisign signatures, macOS DMG signing, latest.json updater manifest creation, Git push, and GitHub Release publishing so users can hit Check for Updates to install new features immediately.',
      parameters: {
        type: 'object',
        properties: {
          bump: {
            type: 'string',
            enum: ['patch', 'minor', 'major'],
            description: 'Semver bump type: patch (default) or minor',
          },
          notes: {
            type: 'string',
            description: 'Changelog summarizing the new features, UI/UX changes, or fixes built',
          },
        },
        required: ['notes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_task',
      description:
        'Manage asynchronous background tasks: start a long-running build/command without blocking ("start"), list running tasks ("list"), inspect status and recent log output ("status"), or cancel a task ("kill").',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'list', 'status', 'kill'],
            description: 'Action to perform on background tasks',
          },
          command: {
            type: 'string',
            description: 'Command line to run in the background (when action="start")',
          },
          title: {
            type: 'string',
            description: 'Optional human-readable title for the background task',
          },
          task_id: {
            type: 'string',
            description: 'Task ID for "status" or "kill" actions (e.g. "task-1")',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule',
      description:
        'Schedule a non-blocking countdown timer that displays a live visual countdown badge in the GUI and fires a high-priority notification when completed.',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: {
            type: 'number',
            description: 'Seconds to count down before triggering notification',
          },
          prompt: {
            type: 'string',
            description: 'Message or instruction to trigger when the timer finishes',
          },
          title: {
            type: 'string',
            description: 'Optional short label for the GUI countdown badge',
          },
        },
        required: ['duration_seconds', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'invoke_subagent',
      description:
        'Delegate codebase scanning, multi-file research, or targeted investigation to an isolated Subagent Worker. Returns a clean, distilled report without bloating your main conversation context window.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description: 'Job title for the subagent (e.g. "Codebase Researcher", "UI Component Scanner")',
          },
          prompt: {
            type: 'string',
            description: 'Specific task or search query for the subagent to investigate and summarize',
          },
          directory: {
            type: 'string',
            description: 'Optional subdirectory to scope the scan (e.g. "client/src" or "server/src")',
          },
        },
        required: ['role', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_artifact',
      description:
        'Create or update a structured Markdown, Plan, Walkthrough, or Diff Artifact displayed in the user Side-by-Side Artifacts Drawer.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the artifact (e.g. "Architecture Plan", "Release Walkthrough")',
          },
          type: {
            type: 'string',
            enum: ['plan', 'walkthrough', 'report', 'code', 'diff', 'task', 'html'],
            description: 'Kind of artifact ("html" saves a live interactive widget rendered in an iframe)',
          },
          content: {
            type: 'string',
            description: 'Full Markdown or HTML content of the artifact',
          },
          summary: {
            type: 'string',
            description: 'Brief 1-sentence summary of the artifact',
          },
          requestFeedback: {
            type: 'boolean',
            description: 'Set true when asking the user to review and click Proceed before continuing',
          },
          userFacing: {
            type: 'boolean',
            description: 'Set true to highlight this artifact inline in the chat feed',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swarm',
      description:
        'Manage a multi-agent swarm working on the shared message board (add workers, check status, list/switch models, kill workers, or set swarm title).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'models', 'add', 'model', 'kill', 'title'],
            description: 'Swarm management action',
          },
          name: { type: 'string', description: 'Short lowercase worker name (e.g. parser, verifier)' },
          brief: { type: 'string', description: 'Worker assignment brief (for add)' },
          model: { type: 'string', description: 'Model name (optional)' },
          workspace: {
            type: 'string',
            enum: ['inherit', 'share', 'branch'],
            description: 'Workspace isolation mode for add',
          },
          n: { type: 'number', description: 'Number of homogeneous copies to spawn' },
          tasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Per-worker slice targets for sharded add',
          },
          title: { type: 'string', description: 'Short title for the swarm' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_question',
      description:
        'Ask the user one or more structured multiple-choice questions to clarify requirements or design decisions (ideal for /grill-me or ambiguous specs). Renders an interactive choice card in the chat UI.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'List of multiple-choice questions to present to the user',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The question prompt' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Choices for the user (put recommended option first, prefixed with "(Recommended) ")',
                },
                is_multi_select: {
                  type: 'boolean',
                  description: 'Whether the user can select multiple options',
                },
              },
              required: ['question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
];

export const SWARM_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'post_message',
      description: 'Post a message to the swarm message board. Use @name or @all to wake sleeping workers.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Message content to post' },
          channel: { type: 'string', description: 'Optional channel name (default: main)' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_board',
      description: 'Read messages from the swarm message board, oldest first.',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'number', description: 'Read messages strictly after this seq number' },
          limit: { type: 'number', description: 'Maximum messages to return (default 20)' },
          seqs: { type: 'array', items: { type: 'number' }, description: 'Specific seq numbers to read' },
          channel: { type: 'string', description: 'Optional channel filter' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lsp_diagnostics',
      description:
        'Run fast LSP syntax/parse diagnostics on a file or workspace, extract symbol outlines (classes/functions/interfaces with line numbers), or generate a compact ~1,000-token structural repo map.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['diagnostics', 'symbols', 'repo_map'],
            description: 'LSP inspection action to perform',
          },
          path: {
            type: 'string',
            description: 'Target file path (required for symbols, optional for diagnostics)',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swarm_wait',
      description: 'Park the current worker at zero GPU cost until another swarm member posts a matching message.',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'number', description: 'Highest seq already read' },
          mentions_only: { type: 'boolean', description: 'Wake only on @name or @all (default true)' },
        },
        required: ['since'],
      },
    },
  },
];
