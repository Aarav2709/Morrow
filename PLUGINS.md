# Writing a Morrow plugin

A plugin is a folder in your vault at `.morrow/plugins/<id>/` with two files:

- `manifest.json`, which names the plugin
- `main.js`, a JavaScript module whose default export is a function

Morrow calls that function with its API when the plugin starts. Settings → Plugins lists every plugin in the
vault. Plugins stay off on each computer until **Turn on plugins on this computer** is switched on there,
and then each plugin is turned on by itself.

Plugins run inside Morrow with the same access to your notes Morrow has. Only add ones you trust.

## manifest.json

```json
{
  "id": "word-count",
  "name": "Word count",
  "version": "1.0.0",
  "description": "Counts the words on the open page.",
  "author": "You"
}
```

The folder's name is the plugin's id: letters, numbers, `-` and `_`.

## main.js

```js
export default function (morrow) {
  morrow.commands.add({
    id: 'count',
    name: 'Count the words on this page',
    shortcut: 'Mod+Shift+W',
    run: () => {
      const page = morrow.pages.current();
      if (!page) return morrow.notice('Open a page first.');
      const words = (morrow.pages.read(page.id) ?? '').split(/\s+/).filter(Boolean).length;
      morrow.notice(`${words} words`);
    },
  });

  morrow.slash.add({
    id: 'signature',
    title: 'Signature',
    description: 'Signs off a letter',
    markdown: 'Best wishes,\n\n**Me**',
  });

  // a function returned here runs when the plugin is turned off
  return () => {};
}
```

Everything a plugin adds goes away again when it is turned off or reloaded, so nothing needs cleaning up by
hand unless the plugin made it itself.

## The API

| Call                                                                  | What it does                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `morrow.version`, `morrow.plugin`                                     | Morrow's version and this plugin's id.                                                 |
| `commands.add({ id, name, shortcut?, run })`                          | A command in the search (Ctrl/Cmd+K), with an optional shortcut such as `Mod+Shift+W`. |
| `slash.add({ id, title, description?, keywords?, markdown? , run? })` | An item in the `/` menu. It inserts `markdown`, or calls `run`.                        |
| `pages.list()`                                                        | Every page: `{ id, title, path, tags, properties, parentId, kind }`.                   |
| `pages.get(id)`, `pages.current()`                                    | One page, or the one open, in the same shape.                                          |
| `pages.read(id)`                                                      | A page's text as Markdown.                                                             |
| `pages.write(id, markdown)`                                           | Replaces a page's text. The earlier version stays in page history.                     |
| `pages.create({ title, markdown?, parentId? })`                       | Makes a page and returns its id.                                                       |
| `pages.open(id)`                                                      | Opens a page.                                                                          |
| `editor.insert(markdown)`                                             | Inserts at the cursor in the page being edited.                                        |
| `editor.selectedText()`                                               | The text selected in the page being edited.                                            |
| `onChange(listener)`                                                  | Calls `listener` whenever a page changes. Returns a function that stops it.            |
| `notice(message)`                                                     | Shows a short message at the bottom of the window.                                     |
| `styles.add(css)`                                                     | Adds CSS to the window.                                                                |
| `storage.get()`, `storage.set(value)`                                 | The plugin's own settings, kept as `data.json` in its folder.                          |
| `register(cleanup)`                                                   | Runs `cleanup` when the plugin is turned off.                                          |

Every `add` returns a function that takes the thing away again.

## Trying changes

After editing `main.js`, press the reload button beside the plugin in Settings → Plugins. A plugin that
fails to start shows why there.
