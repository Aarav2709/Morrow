// a web view too old for morrow, like the one an android 9 emulator ships with, would show a blank window.
// this check is old style javascript that any web view runs, and says what to update
(function () {
  // new Function would be simpler, but the app's content security policy blocks it and every web view
  // looked too old. these are the newest things the app leans on, checked without running new syntax
  var modern =
    typeof Object.hasOwn === 'function' &&
    typeof Array.prototype.at === 'function' &&
    typeof String.prototype.replaceAll === 'function' &&
    typeof structuredClone === 'function';
  if (modern) return;
  var lang = (navigator.language || 'en').slice(0, 2);
  var text = {
    en: 'Morrow needs a newer web view. On Android, update Android System WebView (or Chrome) from the Play Store, then open Morrow again.',
    es: 'Morrow necesita un web view más reciente. En Android, actualiza Android System WebView (o Chrome) desde Play Store y vuelve a abrir Morrow.',
    pt: 'O Morrow precisa de um web view mais recente. No Android, atualize o Android System WebView (ou o Chrome) pela Play Store e abra o Morrow de novo.',
  };
  var note = document.createElement('p');
  note.textContent = text[lang] || text.en;
  note.style.cssText = 'font: 16px/1.5 sans-serif; margin: 40px 24px; color: #555; max-width: 520px;';
  document.body.appendChild(note);
})();
