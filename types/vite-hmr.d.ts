import 'vite';

declare module 'vite' {
  interface HmrOptions {
    port?: number | string;
  }
}