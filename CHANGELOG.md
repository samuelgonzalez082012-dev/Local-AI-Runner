# Changelog

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
