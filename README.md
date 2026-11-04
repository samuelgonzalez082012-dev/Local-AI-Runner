# Local AI Runner

Local AI Runner is an Electron desktop app for chatting with locally hosted language models and organizing related documents, projects, memories and bounded work tasks.

## Code editor

The shared code editor is available as a full workspace page, a dock beside chat, and a separate Electron window. Open **Code editor** from the navigation, or use the **Editor** control beside the chat composer. The views share open tabs and editor preferences.

The editor includes a VS Code-inspired activity rail, file explorer, workspace-wide text search, tabs with unsaved indicators, syntax-coloured editing, line and cursor status, an output panel, and customizable themes and typography. The AI assistant can explain, debug, refactor, design tests for, or review the selected code (or the active file when no selection exists). AI responses are sent through the configured model in chat; the editor does not silently apply AI-generated changes. Review suggestions and save changes explicitly.

Workspace saves continue to use the app's existing workspace writer and backup behavior. This editor build uses the existing lightweight in-app editing surface; it does not yet bundle the Monaco editor engine or language-server integrations.

## Requirements

- Windows, macOS or Linux
- Node.js 22.13 or newer (or Node.js 24 or newer)
- npm
- [Ollama](https://ollama.com/), an OpenAI-compatible inference server, or an Anthropic API key for cloud API access

## Install and run

1. Extract this project folder.
2. Open a terminal in the project folder.
3. Install dependencies:

   ```sh
   npm install
   ```

4. Start the desktop app:

   ```sh
   npm start
   ```

5. Start Ollama (or your compatible local inference server), open **Connections**, and connect to the server. The default Ollama address is `http://localhost:11434`.

The app does not download models. Install and manage models using your inference server's own tools.

### Supported model providers

- **Ollama:** connect to `http://localhost:11434`. Tool calling uses native model support when available, with a structured request fallback for models that do not advertise native tool calling.
- **OpenAI-compatible API:** connect to your compatible server URL and provide its API key if required.
- **Anthropic API:** choose **Anthropic API**, use the default `https://api.anthropic.com` URL, and enter an Anthropic API key. The app uses the Anthropic Messages API, including its streaming and native tool-use formats. Remote server approval is required before prompts are sent. API access and any provider charges are managed by Anthropic.

### Universal tool registry

Open **Inspector → Tools** to enable the tool system and manage individual built-in or connected MCP tools. Each registered tool has a validated JSON Schema; arguments are checked again immediately before execution. Workspace writes continue to require the app's native confirmation and backup flow. MCP calls keep their connector approval checks.

The recent activity list stores tool names, source, category, result status, timing and a short error message. It does not store tool arguments, prompts or file contents. The local audit file is kept in the app's user-data folder.

Built-in model tools include local conversation/workspace search, project-document context, bounded CSV/JSON summaries, workspace file listing/reading/search, file creation and editing with confirmation, browser interaction and DuckDuckGo web search, and agent planning. Web search runs in the visible integrated browser, sends the query to DuckDuckGo, and follows the browser's site-approval safeguards. Models can also list/create projects, list/save/delete memories, list/create reusable workflows, and save, schedule or start tasks/workflows. Persistent changes and task runs require an in-app confirmation; scheduled tasks only run while the app is open. Voice input/output, screen snapshots and vision routing are available through their app features. Models without native function calling use the validated structured tool-request fallback.

This is a local desktop workspace, not a clone of hosted ChatGPT or Claude services. Tabular analysis is a bounded local summary (not arbitrary Python execution); connected apps require an MCP server; cloud research, GPT/skill marketplaces, hosted image generation, remote agents and general desktop control need separate providers or integrations and are not implied by the built-in tools.

## Integrated browser and Cowork agent (1.3.0)

Turn on **Inspector → Tools → Browser tools** (this also enables built-in tools), then use Agent mode with a model that supports tool calling.

- **Browser page / dock:** open the Browser page from the sidebar, or dock it beside the chat with the button in the composer.
- **Plan:** for multi-step requests the agent writes a checklist above the composer. Pause, resume, stop, edit or add steps at any time.
- **Seeing pages:** the agent reads numbered interactive elements. For visual pages it uses screenshots (needs an image-capable chat model or a vision model selected in Tools).
- **Safety:** the browser is isolated from the app and from your normal browser. The agent never types passwords or payment details; submits, risky clicks and JavaScript need your approval; page text is treated as untrusted. Use "Clear browser data" to reset cookies and storage.

**Games and fast pages (1.4.0):** the assistant can look with small fast screenshots, send timed key sequences and coordinate mouse input, and start a *reflex*, a short script that runs inside the page every frame. A model still needs a second or more per decision, so real-time play works by the model learning the game and then writing a reflex that reacts at frame speed. It works best on games that expose their state in the page or have clear colours on a canvas. Turn on **Auto-approve browser actions** in Tools to stop approval prompts; leave it off for untrusted sites.

Limitations: no file uploads or downloads in the browser, no captcha solving, no extensions, and small local models may struggle with long browsing tasks.

## Previous build (1.2.4)

- Fixes sidebar navigation: both the upper Workspace group and lower Connections/Memory/Insights/Help/Settings group now respond to clicks and correctly synchronize active state and translated labels.
- Refines Projects, Models, Tasks and Settings with one consistent visual system, clearer hierarchy, accessible controls, responsive layouts and visible keyboard focus.
- Adds six-language interface localization (English, Spanish, French, German, Japanese and Chinese) for navigation, dynamic screen content, task states, conversation actions and assistant status announcements. Switching language refreshes the currently open screen.
- Improves the conversation sidebar's semantics: each conversation is a list item with separate open, options and delete buttons. Action controls remain keyboard reachable and become visible on focus.
- Keeps the chat transcript out of the live announcement stream while a separate polite status region announces when the assistant is responding, completes, stops or encounters an error.
- Strengthens Settings tab semantics and arrow/Home/End keyboard navigation, labels file pickers and search controls, and keeps `aria-expanded` state synchronized with collapsible panels.
- Validates and sanitizes MCP tool input schemas and arguments before exposing or calling tools; rejects unsafe schema constructs, prototype-pollution keys, malformed values and oversized payloads. Approval previews mask credential-like values.
- Improves configuration and workspace durability with a reusable atomic file writer, private file permissions, atomic credential/configuration writes and atomic workspace edits, backup-index updates and restores.
- Hardens model-server and MCP configuration handling, including endpoint validation, regular-file/size checks for credential/config files, remote-server approval and bounded request/response data.
- Adds optional scanned-PDF OCR. When Poppler (`pdftoppm`) and Tesseract are installed and available on PATH, image-only PDF pages can be OCR processed. OCR is bounded to at most eight pages, a 60-second document budget, 120-DPI rendering capped to a 2400-pixel longest edge, 18 MB per page image and bounded text output. English OCR data is used by default. Without those tools, text-based PDF extraction still works and scanned-only files report the missing dependency.
- Keeps model downloading deliberately excluded; installed model discovery and local-server selection remain unchanged.

## Previous build (1.2.3)

The 1.2.3 release consolidated interface localization, accessibility improvements, MCP validation and service hardening.

## Previous build (1.2.1)

- Adds an agent file-generation workflow: Work mode can create new HTML, CSS, JavaScript, Python, JSON, Markdown and other supported text/source files in the selected workspace.
- New files use an exclusive create operation and can never silently overwrite an existing file; each creation requires a native approval dialog. Existing-file edits retain the backup-before-write approval flow.
- Adds general file-building instructions so the local model can handle related natural-language requests rather than one hard-coded prompt. Standalone web apps are generated as self-contained HTML files by default when appropriate.
- Preserves the three-file renderer structure: `index.html`, `styles.css` and `renderer.js`.
- Uses Electron 45.2.0 and the asynchronous `safeStorage` APIs for encrypted API-key persistence, including re-encryption when the OS key provider requests rotation. Linux systems reporting the weak `basic_text` backend keep keys in memory only.
- Uses current compatible document-parser releases (`pdfjs-dist` 6.2.108 and `mammoth` 1.13.0); PDF text extraction stops at a strict character/page budget and DOCX archives are preflighted before extraction.
- Limits model-server, streaming and MCP response sizes while reading data, and cancels oversized responses.
- Adds process/system memory metrics separately from model-server VRAM reporting.
- Bounds global search indexing and deduplicates results by source record.
- Includes appearance profiles in full backups and validates imported appearance settings.
- Improves scheduled-task isolation and project/document context handling.

## Generate files with Work mode

1. In **Connections**, choose the folder where generated files should be saved.
2. Turn on **Allow approved file creation and edits**. The app still asks before every creation or modification.
3. Open the right-side Inspector, enable **Built-in tools**, and select a model that supports tool calling. For Ollama, the app must report tool support for that model.
4. Turn on **Work mode** in the chat composer and describe the deliverable. For example: “Make a standalone HTML ideas notebook that saves ideas in IndexedDB.”
5. Review the native approval dialog. Accepting creates the new file in the selected workspace. The model reports its relative path when the tool succeeds.

Work mode is general-purpose: it can create supported HTML, CSS, JavaScript, Python, JSON, Markdown, CSV and other text/source files according to the prompt. A small standalone web tool is normally delivered as one self-contained HTML file. New-file creation refuses existing paths rather than replacing them. To change an existing file, explicitly ask for that change; the separate edit action previews the change and creates a backup.

The example output for the IndexedDB ideas prompt is in `examples/ideas.html`. It is provided as a reference deliverable and is not required by the app runtime.

## Interface update (1.1.1)

- Improved readability across navigation, chat, settings, cards and inspector controls.
- Added compact-window navigation/inspector drawers with a shared dismiss backdrop and Escape support.
- Corrected the New chat shortcut hint (`Ctrl+N`) and kept `Ctrl+K` for global search.
- Fixed global search form submission so pressing Enter does not close the search dialog.
- Prevented new chats and general tasks from inheriting a project accidentally; project chats remain explicitly linked.
- Fixed the scheduled-task queue so due tasks remain eligible while another run is active.
- Added interface contract tests for the split renderer files and the corrected interaction paths.

## Main areas

- **Chats:** saved conversations, per-chat model selection, image and document attachments, streaming, response regeneration and Markdown export.
- **Projects:** local document collections and keyword-ranked project context retrieval.
- **Models:** installed model inventory, capability display, simple response-speed comparison and runtime information when exposed by the backend.
- **Tasks:** saved prompts, manually started agent runs and scheduled runs while the app remains open.
- **Connections:** model server setup, a user-selected file workspace and MCP Streamable HTTP servers.
- **Memory:** user-managed local facts that can optionally be included in prompts.
- **Insights:** user-triggered summaries of recent local activity.
- **Settings:** themes, colors, layout, language options, voice options, backup/restore and data controls.

## Supported attachments

- Images: JPEG, PNG, WebP and GIF (subject to selected model vision capability).
- Documents: PDF and DOCX, extracted locally before their text is added to a prompt.
- Text/code: common text and source formats supported by the file picker.

Scanned/image-only PDFs can use optional local OCR when Poppler (`pdftoppm`) and Tesseract are installed and available on PATH. OCR uses the English language pack by default and is subject to page, time, image-size and text-size limits. Without these external tools, ordinary selectable PDF text and DOCX extraction continue to work; a scanned-only PDF reports that OCR is unavailable. PDF/DOCX extraction is bounded by file and extracted-text size limits.

### Enable scanned-PDF OCR

OCR is optional and uses local command-line tools rather than a cloud OCR service:

1. Install Poppler utilities that provide `pdftoppm`.
2. Install Tesseract OCR and its English language data.
3. Add both executables to the system `PATH`, then restart Local AI Runner.
4. Verify in a terminal that `pdftoppm -v` and `tesseract --version` both work.

The app does not install these tools or download language models. OCR currently invokes Tesseract with the English (`eng`) language pack. It processes at most eight selected pages and stops at its configured time/output limits. If the commands are unavailable, selectable PDF text is still extracted normally.

## Privacy and permissions

- Conversations, project records, task definitions, preferences and memory are stored locally in the Electron app's user data.
- The app keeps the existing Electron application identity and user-data path from the project so existing conversations, IndexedDB storage, encrypted credentials, workspace selection and MCP server settings remain available when replacing an installation of the same app. Make a backup before upgrading.
- Model prompts and attached context are sent to the configured inference server. Remote model servers require explicit approval and HTTPS.
- API keys are stored using Electron `safeStorage` when operating-system encryption is available. If encryption is unavailable, the key remains in memory for that session rather than being saved in plain text.
- Screen understanding is a one-time, user-selected snapshot. The app does not continuously monitor the screen.
- Workspace file access is scoped to a folder explicitly selected by the user. File creation and modifications require native confirmation; existing files are backed up before they are modified.
- External MCP tool calls require individual native confirmation. Only MCP Streamable HTTP is supported here; OAuth-specific login flows and service-specific integrations are not included.

## Agent and task limitations

- Agent runs are bounded, can be stopped, and run only while the app is open.
- Scheduled tasks are checked while the app is open; the app does not run as a background service after it exits.
- Workspace file tools are limited to supported text/source formats. The app does not run shell commands or arbitrary executables. New generated files are create-only; existing-file edits require the approved write tool and create a backup.
- A local model must support tool calling for agent tools to work. Capability detection is not available for every backend.
- Project retrieval currently uses local keyword-ranked text chunks, not embedding-based vector search.

## Data backup

Use **Settings → Data & backup** to export or import a JSON backup. API keys are excluded. Attached image binaries and files in a selected workspace are also excluded; image names are retained in chat history.

## Tests

Run the built-in service tests with:

```sh
npm test
```

The current suite contains **80 automated tests**. It covers create-only workspace output, workspace boundary checks, atomic file writes, scanned-PDF OCR (when Poppler and Tesseract are present), OCR timeout/output limits, the IndexedDB example deliverable, document input validation, MCP protocol behavior and schema/argument validation, backup/restore handling, response-size limits, credential storage contracts and important interface/accessibility contracts. It does not replace end-to-end testing with a packaged Electron build and a running Ollama or OpenAI-compatible server.

## Development notes

Direct runtime dependencies are pinned in `package.json`. This archive does not include an npm lockfile, so npm may resolve different transitive dependency versions when installing at a later date.

The renderer is intentionally separated into three primary files:

- `index.html` — application structure
- `styles.css` — visual system and layout
- `renderer.js` — renderer-side application logic

Electron startup, the isolated preload bridge and local services remain separate so native permissions, secure storage, document parsing and filesystem access do not run in the page renderer.
