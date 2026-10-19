# Morrow

Morrow is a free, open source, local first workspace for your notes, databases
and ideas. Every page is a plain Markdown file in a folder you choose. No
account, no subscription and no cloud, and no AI unless you bring your own. Just
a calm place to write and think, on your own computer.

https://github.com/user-attachments/assets/a279710f-1a50-4f1a-82ff-17714cfe7641

## Why Morrow

- **Yours.** Your notes are a folder of Markdown files. Open them in any app,
  sync them with Syncthing, iCloud, Dropbox or git, and keep them forever. Edits
  made elsewhere show up in Morrow straight away. Nothing is sent anywhere: no
  accounts, no telemetry, no ads. It works with the network cable unplugged.
- **Calm.** A focused writing surface with careful typography, and only the
  features that earn their place.
- **Trustworthy.** Morrow only rewrites a file you changed in Morrow. Every
  change is saved as you type, failed writes are retried, earlier versions of
  every page are kept, a file changed elsewhere while you were editing is kept
  in page history, and deleted pages go to the system trash.
- **Compatible.** Wiki links, callouts, tags, properties, maths and canvases use
  the same formats as Obsidian, so an existing vault opens as it is. Notion
  exports, databases included, import in one step.
- **Everything built in.** Databases, canvases, graph, sync, encryption and
  flashcards come with Morrow, with nothing to install or configure.
- **AI free unless you want it.** Morrow has no AI of its own and sends nothing
  anywhere. An optional assistant can be turned on in Settings with your own API
  key; it is off until you do.

## Features

- **Pages** in a sidebar tree with icons, drag and drop, favourites and a trash
- **A rich editor**: headings, lists, checklists, quotes, callouts with titles
  and folding, toggles, tables, columns, a table of contents, highlights, maths,
  syntax highlighted code, Mermaid diagrams, images, and audio, video and PDF
  files that play right on the page
- **Date mentions**: type `@` for `@today`, `@friday` or any day, linked to that
  day's note
- **Links**: `[[` to link pages, with aliases and headings, live titles,
  backlinks, links to pages that do not exist yet, and links that follow renames
- **Databases**: table, board, calendar, list and gallery views of pages, with
  text, number, select, multi-select, date, checkbox, link, relation and
  formula properties, filters, sorts and grouping, checklist progress on cards,
  and inline databases shown inside any page. Row values are readable
  frontmatter, relations are `[[links]]`. Turn a folder of notes into a
  database in one step, with their frontmatter as columns
- **Properties**: a page's frontmatter, like the properties of an Obsidian note,
  shown and edited at the top of the page. Moving a page into a database turns
  its properties into columns, matched whatever their case, and moving it out
  turns them back
- **Canvases**: an infinite whiteboard of cards, pages, images and groups joined
  by arrows, with a pen, highlighter and eraser for freehand drawing, saved as
  open JSON Canvas files. Show one inside any page with `![[Canvas]]` or
  `/Inline canvas`, and drag its corner to size it
- **Graph**: every page and link as a network, or the neighbourhood of one page
- **Tags** from properties or `#tags` in text, with nested tags and a tag index
- **Templates** with `{{date}}`, `{{time}}` and `{{title}}`, and a daily note
  template
- **Daily notes** first: Morrow opens on today's note (or home, or where you
  left off), with the notes either side, a calendar of every day, and the pages
  you made that day listed under it. A Tasks view gathers every checklist item
- **Search** across every page from the command palette, or in a full view with
  every match: `"exact phrases"`, `-word` to leave pages out and `#tag` filters
- **Vaults**: open any folder, switch between folders, keep work and home apart
- **Sync between your computers** on the same network: pair once with a code,
  no server, no account, every transfer encrypted, both versions kept when a
  page changed on both
- **Or sync through a cloud folder**: Settings finds your Dropbox, iCloud Drive,
  Google Drive, OneDrive, Syncthing or Nextcloud folder and moves the vault
  into it. Their own apps do the syncing, and the conflicted copies they make
  are marked so you can compare them side by side
- **Encrypted pages**: lock any page with a password, AES-256 on disk, never a
  plain copy in history or backups
- **Flashcards**: write `question :: answer` anywhere and review with spaced
  repetition
- **Embedded pages** with `![[Page]]`, kept live as the other page changes
- **Quick capture** from any app with Ctrl/Cmd + Alt + M, straight into today's
  note
- **Colour**: eight accent themes, coloured text and highlights, page covers,
  coloured tags and icons, and a home page with your writing streak, "On this
  day" and a page to rediscover
- **Publish** a page or the whole vault as a static website, free
- Page history with a view of what changed since each version
- **Tabs and split panes**: back and forward in every tab (Alt + ← and →, or
  Cmd + [ and ] on a Mac, or the mouse's side buttons), Ctrl/Cmd + click to open
  a page in a new tab, Alt + click to open it beside the page you are on,
  Ctrl/Cmd + Shift + T to reopen a closed tab and Ctrl/Cmd + 1 to 9 to jump
- **Drag a page** from the sidebar into another page to link it
- **An optional assistant** that searches, reads and edits your pages in Morrow's
  own Markdown, with Claude, ChatGPT, Gemini, OpenRouter or a local model through
  Ollama or LM Studio. You bring the key, every change is shown for approval,
  kept in page history and can be undone, and locked pages are never sent
- **Export as PDF**, and **edit as Markdown** to work on a page's source directly
- **Custom CSS** kept in the vault as `.morrow/style.css`
- A full emoji picker for page icons, drawn the same on every system
- Find and replace, Markdown shortcuts, Markdown paste, an outline of each page, focus mode
- Import from Notion (pages and databases) or any folder of Markdown files,
  export to Markdown, full backups
- Light and dark themes, a choice of sans, serif or mono writing fonts
- A detailed guide on first run that shows every feature working
- Keyboard first: press Ctrl/Cmd + / to see every shortcut

## Status

Version **1.1.0**. Pages are files in a folder you choose. Earlier builds kept
them inside the app; the first time this version opens it offers to copy those
pages into the folder and leaves the original copy untouched. Releases are built
for Windows (x64 and ARM64), macOS (Apple silicon and Intel) and Linux (x64). The
macOS and ARM64 builds are produced by the release workflow but have not yet been
tried on real machines, and builds are not code signed yet.

## Coming from Obsidian

Choose **Open a folder** and pick your vault. Morrow reads it as it is: folders,
wiki links, embeds, callouts, tags, properties, aliases, maths and canvases.
Nothing in `.obsidian` is touched, and files you do not edit in Morrow are never
rewritten.

Your properties show at the top of each page and can be edited there. To get
Notion style databases from a folder of notes, open the folder's menu and choose
**Turn subpages into a database**: each note becomes a row and its properties
become columns, with types worked out from their values. A property such as
`date` fills a database's `Date` column, and keeps its own spelling in the file.

## Coming from Notion

In Notion, open Settings, Export, choose **Markdown & CSV** and include
subpages. In Morrow, choose **Import** in the sidebar and pick the zip file.
Pages keep their nesting, links between pages and images, databases become
Morrow databases with their properties, and Notion's callouts become Morrow
callouts.

## Build and run

You need [Node.js](https://nodejs.org) 20.19 or newer.

```sh
git clone https://github.com/Aarav2709/Morrow.git
cd Morrow
npm install
npm run dev        # opens the desktop app with live reload
```

| Command         | What it does                                        |
| --------------- | --------------------------------------------------- |
| `npm run dev`   | Desktop app with live reload                        |
| `npm run build` | Builds the interface and the desktop shell          |
| `npm start`     | Runs the built desktop app                          |
| `npm run dist`  | Builds installers for your platform into `release/` |
| `npm test`      | Runs the unit and storage tests                     |
| `npm run check` | Type check, lint, tests and build together          |

On Windows `npm run dist` produces `Morrow-Setup-<version>-x64.exe` and a portable
`.exe`; add `-- --arm64` for ARM64. On macOS it builds for both Apple silicon and
Intel. Morrow never checks for updates on
its own; new versions are downloaded from the releases page. Builds are signed automatically once the
signing secrets (`CSC_LINK` and `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for macOS) are added to the
repository. Until then Windows SmartScreen and macOS Gatekeeper warn the first
time Morrow is opened.

## Where your data lives

In the folder you chose, as Markdown files: one file per page, subpages in a
folder named after their page, canvases as `.canvas` files, images and files in
`attachments/`, trashed pages in `.trash/`. Metadata lives in frontmatter, and
database rows keep their values as readable properties. Morrow's own small
`.morrow` folder in the vault remembers page order, favourites and page history;
deleting it never touches a page. Morrow's settings and automatic backups live
in `%APPDATA%\Morrow` on Windows, `~/Library/Application Support/Morrow` on
macOS and `~/.config/Morrow` on Linux. If you turn on the assistant, its API key
is kept there too, encrypted by your system's keychain (or only until Morrow
closes when the system has none).

## How Morrow was made

Morrow is built with the **help** of AI coding tools. I laid the foundation and
did most of the frontend, while AI helped research features, wrote most of the
backend and the code connecting it to the interface, built larger features such
as databases, canvas drawing and the welcome guide, and handled most debugging
and optimisation. I decide what goes into Morrow and test every change myself.
Morrow itself has no AI and sends nothing anywhere. The optional assistant only
runs when you turn it on and add your own key.

## Licence

Morrow is licensed under the [Apache License 2.0](LICENSE). The licences of the
open source packages it bundles are written to `THIRD_PARTY_LICENSES.txt` in
every build.
