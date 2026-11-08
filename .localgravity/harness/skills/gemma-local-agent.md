---
name: gemma-local-agent
description: >-
  Conservative local offloader: selectively offload simple, deterministic boilerplate,
  repetitive schemas, and basic scaffolding to native internal Gemma 4 models (via LiteRT-LM,
  not Ollama or cloud tokens) only when high confidence of fast, easy, and correct output,
  saving cloud tokens during large builds.
---

# Native Gemma 4 Local Agent Skill

This skill defines a **conservative, quality-first offloading policy** for Antigravity's internal on-device Gemma 4 models (via Google AI Edge LiteRT-LM runtime, completely native and independent of Ollama or cloud tokens).

## 1. Default Operating Policy: Selective & Quality-Gated

By default, Cloud Gemini handles almost all primary logic, complex problem solving, and architectural coding. **Antigravity should NOT use local models frequently.**

Antigravity should only autonomously decide to offload to local Gemma 4 when:
1. **The task is low-complexity boilerplate:** Writing standard data models, basic JSON/YAML schemas, repetitive Pydantic/dataclass structures, mock datasets, or simple utility stubs.
2. **High confidence of correctness:** The task is deterministic and does not require cross-file reasoning or ambiguous business logic.
3. **Speed & Efficiency:** It is fast, easy, and clearly saves unnecessary cloud tokens during large multi-file project scaffolding.

---

## 2. Decision Matrix

| Scenario | Engine Decision | Why |
| :--- | :--- | :--- |
| **Complex logic, refactoring, multi-file architecture, debugging** | ☁️ **Cloud Gemini (Default)** | Requires deep reasoning, broad context, and precise logic. |
| **Repetitive boilerplate, standard dataclasses, simple CRUD stubs** | 💻 **Native Gemma 4 (`gemma-4-e4b-gpu`)** | Fast, simple, and saves cloud tokens with high accuracy. |
| **Explicit user request** (*"use your internal Gemma 4"*) | 💻 **Native Gemma 4** | Directly follow user intent. |
| **Offline environment** | 💻 **Native Gemma 4** | Full local execution capability. |

---

## 3. Internal LiteRT Execution Commands

When Antigravity decides to offload boilerplate to internal Gemma 4, use the native LiteRT-LM engine:

**Internal LiteRT Runtime Path:**
`C:\Users\Sue\Documents\GitHub\ComfyUI\ComfyUI-Easy-Install\python_embeded\Scripts\litert-lm.exe`

### Running Single-Turn Boilerplate Generation
```powershell
& "C:\Users\Sue\Documents\GitHub\ComfyUI\ComfyUI-Easy-Install\python_embeded\Scripts\litert-lm.exe" run gemma-4-e4b-gpu --prompt "<YOUR_BOILERPLATE_PROMPT>"
```

### Running Local OpenAI-Compatible Server (Optional)
```powershell
& "C:\Users\Sue\Documents\GitHub\ComfyUI\ComfyUI-Easy-Install\python_embeded\Scripts\litert-lm.exe" serve gemma-4-e4b-gpu --port 8000
```
