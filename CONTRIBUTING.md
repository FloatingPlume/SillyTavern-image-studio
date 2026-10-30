# Contributing

This is a small, dependency-free ES module extension for SillyTavern 1.18+.

## Development

- No build step. Edit files under `src/`, reload SillyTavern, and enable the extension.
- Run `npm run check` for syntax checks and `npm test` for the unit tests.
- Do not commit API keys, `settings.json`, generated images, personal IPs, or local absolute paths.
- Keep the UI usable on a narrow Android screen; use existing SillyTavern CSS variables instead of a separate design system.
- Provider changes should include a note about the API shape tested (real service or mock) and must not add extra automatic requests.

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- State whether you tested with a real SillyTavern/ComfyUI instance or only with mocks.
- For a new provider adapter, update README's provider table and known limitations.
