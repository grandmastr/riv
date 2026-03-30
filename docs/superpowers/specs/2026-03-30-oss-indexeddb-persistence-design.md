# OSS IndexedDB Persistence Design

## Goal

Make the open-source version of Riv easy to run without requiring Postgres for basic persistence.

The OSS product should:

- keep the agent running through the backend
- persist threads, messages, proposals, and local memories in extension-local `IndexedDB`
- remain usable across browser restarts in the same browser profile
- avoid storing transient page/selection context durably unless explicitly promoted later

This design does not remove the backend. It removes Postgres from the critical path for OSS persistence.

## Non-Goals

- local model execution inside the extension
- cross-device or cross-browser sync in OSS mode
- replacing the paid/server-backed persistence model
- implementing export/import in this milestone
- persisting active-page snapshots or selected text as durable history by default

## Product Modes

### OSS mode

- source of truth for persistence: extension `IndexedDB`
- backend responsibility: run the agent turn and stream output
- no Postgres required for normal local usage

### Paid mode

- source of truth for persistence: backend Postgres
- backend responsibility: persistence plus agent execution
- intended for account-backed sync across browsers/devices

This spec focuses only on OSS mode.

## User Experience

In OSS mode, a user should be able to:

- install the extension and run the backend for inference
- create threads and continue previous conversations without setting up Postgres
- close and reopen the browser and still see their local Riv history
- ask a question about the current page while keeping page/selection context transient for that turn

The user should not need to understand database infrastructure to get durable local history.

## Architecture

### Source of truth

The extension becomes the source of truth for OSS persistence.

Durable records move to `IndexedDB`:

- threads
- messages
- action proposals and their resolution state
- local memories

The backend becomes turn-oriented compute for OSS mode:

- accepts the current turn request
- accepts recent local conversation context supplied by the extension
- accepts transient attachments like page snapshot and selected text
- streams the assistant response back

### Persistence boundary

Persist locally:

- thread metadata
- user and assistant messages
- proposal metadata and status
- memories created by the user

Keep transient:

- active page snapshot
- selected text context
- other ephemeral browser context captured just for a single turn

This preserves privacy and avoids bloating local history with stale page state.

### Data model

The contract shapes should remain aligned across OSS and paid modes.

The same core entities should exist in both:

- `ConversationThread`
- `ConversationMessage`
- `ActionProposal`
- `MemoryRecord`

The difference is repository location, not entity shape.

That keeps the UI and agent-facing types stable while allowing different persistence backends.

## OSS Turn Flow

In OSS mode, the extension owns the local conversation lifecycle.

### Send flow

1. Read the active thread and recent local messages from `IndexedDB`.
2. Refresh transient page and selection context from the browser.
3. Append the new user message to local storage immediately.
4. Send the current turn to the backend along with:
   - thread metadata
   - recent persisted conversation context
   - local memories
   - transient attachments for the current page/selection
5. Stream assistant deltas back from the backend.
6. Persist the completed assistant message locally.
7. Persist any returned action proposals locally.

### Read flow

When the sidepanel loads in OSS mode, it should read threads, messages, proposals, and memories from `IndexedDB`, not from backend thread endpoints.

### Failure behavior

If the backend inference request fails:

- keep the just-created local user message
- do not lose the thread
- surface the backend error in UI
- do not create a fake assistant message unless product UX explicitly wants one

## Backend Contract Changes

The current backend thread/message endpoints assume server-owned persistence. That is the wrong default for OSS mode.

OSS mode should introduce or evolve toward a stateless turn endpoint whose responsibility is inference, not durable conversation ownership.

The request should be extension-supplied context, not backend-owned thread state.

At minimum, the backend needs:

- current user message
- recent message history
- thread metadata if prompt shaping needs it
- local memories
- transient attachments

The backend does not need to persist those records in OSS mode.

## Extension Storage Design

Use `IndexedDB` for durable local persistence.

Repository responsibilities:

- `ThreadRepository`
- `MessageRepository`
- `ActionProposalRepository`
- `MemoryRepository`

These should mirror the current runtime repository concepts closely so the app logic stays coherent.

Expected characteristics:

- asynchronous API
- stable indexes for thread lookup and per-thread message listing
- deterministic ordering by `createdAt`
- straightforward upgrade path for schema migrations

## Privacy and Data Retention

OSS local history should minimize accidental retention of browsing context.

Default retention policy:

- persist authored conversation and explicit memories
- do not persist raw page snapshots
- do not persist selected text automatically

If a later feature needs durable citations or saved research artifacts, that should be a separate explicit design.

## Migration Strategy

For the OSS milestone:

- new local conversations should write to `IndexedDB`
- existing in-memory-only behavior becomes a dev/test fallback, not product storage
- no Postgres requirement remains for local persistence

Future migration to paid sync can map local entities to server-backed entities because the data model stays aligned.

## Testing Strategy

### Extension storage tests

- `IndexedDB` repository create/read/list/update behavior
- ordering and thread scoping
- proposal state transitions
- memory persistence

### Sidepanel flow tests

- sending a message persists the user message locally before inference completes
- assistant response persists locally after streaming completes
- proposals returned from backend are saved locally
- transient page/selection attachments are used for the turn but not stored as durable history

### Backend tests

- turn endpoint accepts extension-supplied recent context
- backend does not assume server-owned thread persistence in OSS mode
- streamed output remains compatible with the current UI contract

## Risks

### Split-brain product modes

Running OSS local persistence and paid server persistence with different assumptions can create drift.

Mitigation:

- keep entity shapes shared
- keep repository interfaces parallel
- isolate mode differences near storage and transport boundaries

### IndexedDB complexity

Browser storage adds async and migration complexity.

Mitigation:

- keep schema small
- use focused repository wrappers
- add explicit migration/version tests

### Accidental persistence of transient context

If the extension stores page snapshots or selections with durable messages, local history quality and privacy degrade.

Mitigation:

- treat transient attachments as send-time only
- test that persisted messages do not retain them by default

## Recommendation

For OSS, make `IndexedDB` the default durable store and keep the backend as inference-only compute.

That gives Riv:

- low setup friction
- persistence across browser restarts in one profile
- a clear upgrade path to paid synced persistence later

It also matches the product reality more closely than a server-owned persistence model for a browser extension that should feel easy to adopt.
