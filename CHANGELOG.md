# Changelog

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
