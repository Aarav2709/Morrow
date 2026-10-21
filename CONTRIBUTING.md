# Contributing to Morrow

Thank you for helping. Morrow is a small project and every bug report and
pull request makes a real difference.

## Ways to help

- **Report a bug.** Open an issue with the bug template. Say what you did, what
  you expected and what happened, plus your system and Morrow version (Settings,
  About). A screenshot helps a lot.
- **Suggest something.** Use the feature template, and start with the problem it
  solves for you rather than the solution.
- **Write code.** Look for issues labelled `good first issue`, or comment on an
  issue to say you would like to take it, so two people don't do the same work.

Before starting on something big, open an issue first. Morrow aims to be calm and
focused, so a feature may be a great idea and still not fit. Talking first saves
you time.

## Setting up

You need [Node.js](https://nodejs.org) 20.19 or newer.

```sh
git clone https://github.com/Aarav2709/Morrow.git
cd Morrow
npm install
npm run dev        # the desktop app with live reload
```

`npm run dev` opens Morrow with your normal settings and vault. To try things
on a throwaway vault, run it with a separate profile:

```sh
MORROW_USER_DATA=/tmp/morrow-test npm run dev
```

## Before a pull request

```sh
npm run check      # type check, lint, tests and build
npm run format     # prettier, if the check complains about formatting
```

`npm run check` is what CI runs on every pull request, on Windows, macOS and
Linux.

For anything you can see, try it in the running app as well, in both light and
dark themes, and in a narrow split pane if it is part of a page. Screenshots in
the pull request make review much quicker.

## How the code is written

- **Read [ARCHITECTURE.md](ARCHITECTURE.md) first.** It shows where things live
  and how a change reaches the files on disk.
- **`src/core` stays pure.** No React, no storage, no Electron, so it can be
  tested on its own. Lint enforces this.
- **Every change to pages is a command** in `src/core/commands.ts`. Components
  never change state directly.
- **Files are the user's.** Morrow only rewrites a file the user changed in
  Morrow, and keeps everything it does not understand, such as unknown
  frontmatter, exactly as it was. Please keep it that way, and add a test when
  you touch how files are read or written.
- **Text people see is translated**, see [Translating](#translating).
- **Comments explain why, not what**, in lower case without a full stop at the
  end, like the rest of the code. Match the naming and style of the file you
  are in.
- **No new runtime dependencies** without talking about it first. Morrow ships
  almost everything bundled and wants to stay small.
- **Privacy is not optional.** Nothing may contact the network unless the user
  asked for it in that moment, like loading a web image, the assistant or sync.

## Translating

Morrow's interface text lives in [`src/app/i18n/locales`](src/app/i18n/locales):
`en.ts` is the source, and `es.ts` and `pt.ts` have the same keys in Spanish and
Portuguese. The type checker fails if a language is missing a key or has one too
many, so `npm run check` tells you when a translation is out of step.

- **Text people see goes through `t()`**, never plain English in a component:
  `t('trash.restore')`, or `t('repeat.madeOne', { title })` with values in braces.
- **Counts use `tp()`**, with the singular form under the same key plus `One`:
  `tp('history.words', count)` reads `history.wordsOne` when there is exactly one.
- **A sentence with a link or code inside** uses `tr()` from `i18n/rich`, so it is
  translated whole: `tr('searchView.tips', { tag: <code>#tag</code> })`.
- **Dates** use `dateLocale()`, so they follow the chosen language.

To add a language, copy `es.ts`, translate every value keeping anything in
braces, and add it to `SupportedLocale` and `SUPPORTED_LOCALES` in `src/app/i18n/types.ts`, to the
list in `src/app/i18n/index.ts`, and to `electronLanguages` in `package.json`.

## Licence

By contributing you agree that your work is released under the
[Apache License 2.0](LICENSE), like the rest of Morrow.
