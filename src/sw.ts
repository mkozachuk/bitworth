// Placeholder service-worker source. `vite-plugin-pwa` is configured with
// `strategies: "generateSW"` so this file is not the deployed SW — Workbox
// generates `dist/sw.js` from the `workbox` block in `astro.config.mjs`. The
// file is kept so the path is reserved; a future slice that needs custom SW
// logic (e.g. background sync) can switch to `strategies: "InjectManifest"`
// and add a fetch handler here.
export {};
