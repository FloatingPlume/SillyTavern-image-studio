# Security

## Reporting

Please do not open a public issue for suspected security problems. Use GitHub's private vulnerability reporting (Security → Report a vulnerability) on this repository. If that is unavailable, open an issue that only asks for a private contact channel and contains no details or secrets.

## What this extension stores

- API keys and profile settings are stored in SillyTavern's `settings.json` through `extension_settings.imageStudio`. They are not encrypted by this extension.
- Never post `settings.json`, screenshots containing keys, or browser console dumps with Authorization headers.
- Generated images are stored in the SillyTavern user directory under `user/images/image-studio/`.

## Network behavior

- HTTP requests go through SillyTavern's `/proxy/` when **Use server proxy** is enabled. This requires the CORS proxy to be enabled in SillyTavern / SillyDroid.
- ComfyUI progress uses a direct WebSocket to the configured ComfyUI address.
- No telemetry, analytics, or third-party upload is implemented by this extension.
- Only configure endpoints you trust. A malicious custom endpoint can return arbitrary content, and the extension will display/save returned images.

## Scope

This is a personal-use beta extension. Reports about upstream provider differences, expired keys, CORS configuration, and local network/firewall setup are not security vulnerabilities; use the bug report template instead.
