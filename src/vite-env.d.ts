/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'virtual:morrow-emoji' {
  // file names of the bundled emoji images, lower case code points joined by dashes
  export const EMOJI_FILES: Set<string>;
}
