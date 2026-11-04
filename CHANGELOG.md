# Changelog

## 1.4.2 — VS Code-style editor workbench polish

- Updated the editor workbench to a VS Code-inspired dark palette, compact title bar, activity rail, Explorer, tabs, breadcrumbs, output area, and status bar.
- Added prominent, language-colored file glyphs for HTML, JavaScript, TypeScript, CSS, JSON, Python, Java, C/C++, C#, Markdown, YAML, SQL, Rust, Go, PHP, Ruby, shell, and common configuration formats.
- Changed the Explorer from single-folder navigation to an expandable, nested folder tree with lazy directory loading.
- Added collapsible editor tabs, horizontal tab scrolling, active-tab state, and middle-click tab closing.
- Kept the existing workspace, save/backup, AI chat bridge, search, preferences, and detached editor integration intact.
- Automated tests: 43 passing. Electron GUI smoke testing is still required on a machine with dependencies installed.

## 1.4.1 — Editor workspace improvements

- Reworked the shared editor shell with a VS Code-inspired activity rail, Explorer/search area, editor breadcrumbs, output panel, and AI assistant sidebar.
- Added workspace-wide text search with bounded results and direct navigation to matching lines.
- Added editor-to-chat AI actions for explaining, debugging, refactoring, test design, and code review. Selected code is preferred; otherwise the active file is included.
- Routed editor AI requests through a validated Electron IPC bridge so the pop-out window reuses the main app's configured model and credentials.
- Kept AI output advisory-only: suggestions appear in chat and are not written to project files automatically.
- Fixed malformed Save button markup and improved editor status feedback.
- Added Ctrl/Cmd+P quick-open, Ctrl/Cmd+F in-file find, Ctrl/Cmd+Shift+F workspace search, Ctrl/Cmd+S save, and line-aware Tab / Shift+Tab indentation.
- Added regression coverage for editor wiring and workspace search. Automated suite: 43 tests passing.

## 1.4.0 — Game-speed browser and auto-approve

- Added **Auto-approve browser actions** (Inspector → Tools). When on, the assistant does not ask before submitting forms, clicking risky buttons, running page scripts or visiting new public sites. Turning it on shows a warning first. Passwords, payment and one-time-code fields are still never filled, and addresses on your own network still ask.
- New fast tools for games and quick pages: `browser_keys` (timed key sequences with held keys, real input), `browser_mouse` (move, click, double, drag, wheel at page coordinates), `browser_look` (small fast screenshots, up to 4 frames to show motion, optional zoom region) and `browser_reflex`.
- `browser_reflex` runs a small script inside the page every animation frame, so reactions take milliseconds instead of a model round trip. The script can press keys, click, and read canvas pixels; it runs in the background with status, stop and a time limit, and is stopped by the Stop button or when the task ends.
- The agent guide now teaches the look → act in bursts → write a reflex workflow.
- Maximum agent steps can now be set up to 300.
- Fixed a rare race where typing into a field could append to the old text instead of replacing it.
- Tests: 14 unit tests and 57 Electron browser checks, including key timing, mouse coordinates, frame capture, reflex pixel reading, interrupt and auto-approve.

## 1.3.0 — Integrated browser and Cowork-style agent

- Added an integrated browser (Electron WebContentsView in an isolated `persist:agent-browser` session with no preload). Use it full size from the new Browser page or docked beside the chat.
- Added 15 `browser_*` agent tools: navigate, get_dom, click, type, select, press_key, scroll, get_text, screenshot, execute_js, new_tab, close_tab, switch_tab, list_tabs and wait. Pages are read as numbered interactive elements (Set-of-Marks) that are also drawn on the page, with a visible agent cursor and glow border. Clicks and keys use real input events.
- Screenshots go to the chat model when it supports images, or to a separate vision model chosen in Inspector → Tools. Canvas-only pages fall back to a screenshot automatically.
- Added a Cowork-style plan: the agent writes a visible checklist (`update_plan`, `complete_step`) above the composer. You can pause, resume, stop, edit steps and add steps while it works.
- Safety: web content is wrapped as untrusted data; passwords, payment and one-time-code fields are never filled by the agent; form submits, Enter in forms, risky clicks and JavaScript execution need approval; private-network addresses always need approval; new sites ask first while the agent is active (optional); permissions and downloads are denied; file:// and javascript: URLs are blocked. "Clear browser data" is in Tools.
- Agent step limit is now configurable (default 25, was 12) and a time limit counts only active, unpaused time.
- Added unit tests for URL policy, click-risk and sensitive-field rules, plus `npm run smoke`, an Electron end-to-end browser test (27 checks).
- New interface text for these features is English only for now.

## 1.2.4 — Sidebar navigation fix

- Fixed the bottom sidebar navigation group so Connections, Memory, Insights, Help & guides, and Settings respond to clicks just like Chats, Projects, Models and Tasks.
- Moved sidebar navigation event delegation to the shared sidebar container, covering both navigation groups.
- Synchronized selected-button styling and six-language navigation labels across every sidebar item.
- Added a regression test covering the split navigation markup, shared click handler and active-state updates.
- Verified the complete automated suite: 81 tests passed.

## 1.2.3 — Consolidated interface, localization, accessibility and service hardening

- Unified the Projects, Models, Tasks and Settings screens with a consistent responsive design system and improved keyboard focus states.
- Expanded dynamic interface localization across English, Spanish, French, German, Japanese and Chinese. Language changes refresh the currently active view.
- Rebuilt conversation-list semantics around list items and separate open/options/delete buttons; localized conversation actions and empty states.
- Separated assistant status announcements from the streaming transcript and added accessible responding/completed/stopped/error messages.
- Improved Settings tab roles, selected state, panel relationships and arrow/Home/End keyboard navigation; labeled search and file-selection controls and synchronized disclosure states.
- Added MCP schema sanitization and argument validation, fail-closed handling of unsupported schema features, bounded JSON values, prototype-key rejection and credential masking in approval previews.
- Added atomic file persistence for credentials, MCP configuration, workspace data, workspace edits and backup-index/restore operations, with private default permissions.
- Hardened model-server and MCP configuration validation and bounded file/response handling.
- Added optional, resource-bounded OCR for scanned PDFs using Poppler and Tesseract when installed. Rendering and OCR are capped by page count, resolution, image size, text output and execution time; missing OCR tools do not block ordinary selectable-text PDF extraction.
- Kept model downloading excluded. Existing app features and user-data identity are retained.
- Added tests for atomic persistence, MCP schema/argument safeguards, OCR output/time limits and scanned-image text extraction when dependencies are available. The complete suite currently passes 80 tests.

## 1.2.2 — Screen design refinement

- Refined Projects, Models, Tasks and Settings into a consistent visual system.
- Improved project cards, document rows, model inventory cards, capability selection controls and model metric panels.
- Improved task filters, task cards, status badges, task actions and reusable workflow surfaces.
- Reworked Settings into a responsive category rail with grouped preference surfaces, more legible controls and improved touch targets.
- Preserved existing application workflows, data formats, security boundaries and the three-file renderer structure.
- Model downloading remains intentionally excluded.
- Added four screen-design contract tests.

## 1.2.1

See the 1.2.1 section in `README.md` for the previous release notes.
