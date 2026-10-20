# How Morrow is built

Morrow is an Electron app. A React interface runs in the window, and a small
main process does everything that needs the computer: files, sync, the
assistant's network calls. The vault is a folder of Markdown files, and the app
keeps an in-memory model of it that it writes back as files.

## The folders

| Folder         | What lives there                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/`    | The main process. `main.cts` makes the window and answers the interface over IPC, `vault.cts` reads, writes and watches the vault folder, `sync.cts` syncs between computers on a network, `cloud.cts` finds cloud folders, `ai.cts` calls the assistant's provider. `preload.cts` is the only bridge into the page. |
| `src/core/`    | Pure logic with no UI or storage: the data model, commands, Markdown, databases, formulas, search, links, the vault's file layout. Most tests are here.                                                                                                                                                              |
| `src/storage/` | Turns the model into files and back. `session.ts` runs commands and holds the state, `vaultRepository.ts` decides which files to write, `saveQueue.ts` batches saves.                                                                                                                                                |
| `src/app/`     | The React interface: `components/`, the Tiptap editor in `editor/`, the assistant panel in `assistant/`, and app wide helpers such as `operations.ts` and `actions.ts`.                                                                                                                                              |
| `src/mcp/`     | The MCP server that other AI apps start, bundled on its own into `dist-electron/mcp.cjs`. It reads the vault with `src/core` and writes plain files.                                                                                                                                                                 |
| `scripts/`     | Build tooling, such as collecting third party licences.                                                                                                                                                                                                                                                              |

## From a keystroke to a file

1. The editor or a component calls `run()` with a **command**, like
   `{ type: 'page.setDoc', id, doc }`.
2. `WorkspaceSession` runs it through `applyCommand` in
   `src/core/commands.ts`. That is a pure function: it returns the new state and
   which pages changed, or an error, and never throws.
3. React re-renders from the new state.
4. The save queue hands the changed pages to `VaultRepository`, which works out
   each page's file and folder (`src/core/vault/layout.ts`), renders its
   Markdown and frontmatter (`src/core/vault/pageFile.ts`,
   `src/core/markdown/serialize.ts`), and sends the file operations to the main
   process.
5. `electron/vault.cts` writes each file atomically, next to the old one and
   then renamed into place, and refuses any path outside the vault.

Reading goes the other way. At start `scanVault` reads the folder,
`loadVault` (`src/core/vault/load.ts`) turns it into pages, and the Markdown
parser (`src/core/markdown/parse.ts`) turns each body into the editor's
document. While Morrow is open the file watcher reports edits made in other
apps, and the session merges them in, keeping any unsaved edits and the other
version in page history.

## A page and its file

- A page is `Title.md`. Its subpages live in a folder named `Title/` beside it.
- Frontmatter holds what Morrow manages (title when it differs from the file
  name, icon, cover, tags, kind, a database's definition, a row's values) next
  to any other keys, which are kept as they were and shown as properties.
- A database is a page with `kind: database`. Its rows are its subpages, each
  with its values in its own frontmatter.
- Canvases are `.canvas` files in the JSON Canvas format.
- `.morrow/` in the vault holds page order, favourites and page history.
  Deleting it never loses a page.

## The rules that keep files safe

- Only a page the user changed in Morrow is written. Opening a page never
  writes it.
- Unknown frontmatter keys, formatting and comments survive. Frontmatter is
  edited in place, key by key (`updateFrontmatter`).
- A file Morrow can't read is opened read only, never "fixed".
- Encrypted pages are only ever plain text in memory.

## Testing

`npm test` runs Vitest on `src/**/*.test.ts`. Storage tests run a real session
against `MemoryVault`, an in-memory folder that can also fake edits from other
apps. For interface changes, run the app and look: `MORROW_USER_DATA` points it
at a throwaway profile, and in development `MORROW_HIDDEN=1` keeps the window
out of sight for scripted checks over the Chrome DevTools Protocol.
