"""
Standard tool schemas for Ollama chat function calling.
"""

from typing import Any, Dict, List

STANDARD_TOOLS_SCHEMA: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "parallel_web_search",
            "description": "Concurrently search the live internet across multiple search queries without API keys. Use whenever real-time facts, current weather, temperature, news, sports, or documentation are needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of distinct, targeted search queries to execute in parallel (e.g. ['current temperature 90024', 'Los Angeles weather today']).",
                    }
                },
                "required": ["queries"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_web_pages",
            "description": "Concurrently fetch and extract clean Markdown content from up to 5 URLs for deep reading.",
            "parameters": {
                "type": "object",
                "properties": {
                    "urls": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of HTTP/HTTPS URLs to fetch and convert to Markdown.",
                    }
                },
                "required": ["urls"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Execute a shell command on the edge client machine (PowerShell on Windows, bash/zsh on Unix) and return output.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The exact shell command line string to execute.",
                    }
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read file contents from the client workspace filesystem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative or absolute path to the file to read.",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file in the client workspace filesystem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative or absolute path to the file to write.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The complete file content to write.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_task_list",
            "description": "Update the reactive task checklist (task.md) rendered in the Right Drawer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "Markdown formatted checklist (e.g., - [/] Task 1\\n- [ ] Task 2).",
                    }
                },
                "required": ["content"],
            },
        },
    },
]
