# AI Workspace redesign

This branch introduces the first integration layer for the redesign.

## Included
- OpenRouter service with encrypted API-key storage via Electron safeStorage, model discovery and chat completion requests.
- Main-process IPC and context-isolated preload methods for OpenRouter and agent activity.
- Persisted, bounded activity event store.
- Workspace tab shell with draggable tabs and a basic split-layout state.
- Agent Control Center concept with Planner-only coordination and a team-instruction event.
- OpenRouter provider drawer and Planner response path for team instructions.

## Design decisions
- Unified workspace tabs with tool-specific views and split groups.
- Planner is the only agent allowed to create/reassign tasks; other agents report or ask questions.
- Inspector presents live activity and concise decision summaries, not private internal chain-of-thought.

## Current limitations requiring follow-up before claiming feature-complete
- The split surface is an initial two-group implementation, not yet a fully recursive nested split tree with draggable dividers and independent tab strips in each group.
- Existing editor/browser views need full mounting adapters into each workspace tab group; placeholder surfaces remain for tools without a current mount.
- The Planner response path uses OpenRouter chat, but does not yet dispatch executable delegated work to independent developer/reviewer model sessions.
- Activity events are persisted and can be subscribed to, but the current inspector still needs a complete live event projection and timeline visualization.
- Agent-specific provider/model assignment UI and provider routing across every existing execution path remain to be integrated.
- Run the full Electron app and automated tests in a Node/Electron environment before release.
