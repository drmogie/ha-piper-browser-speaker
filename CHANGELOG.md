# Changelog

## 2026.09.14.3
- Fixed the card editor throwing "Cannot read properties of undefined (reading 'entity')" and greying out "Show visual editor". Home Assistant doesn't guarantee it calls the editor's `setConfig()` before assigning `.hass` - when `.hass` came first, `_config` was still undefined and the editor's render crashed. It now defaults `_config` to `{}` regardless of which comes first. (The card and integration were already working correctly through this - only the visual editor toggle was affected.)

## 2026.09.14.2
- Renamed the project from "Pipper" to "Piper" throughout (repo, domain `piper_browser_speaker`, card tag `ha-piper-browser-speaker-card`, class names, display names).
- Fixed: the card's `setConfig` threw an error whenever no entity was selected yet, which is exactly the state right after picking the card from "Add Card" — this broke the editor dialog itself, so the entity picker never rendered and the dialog just spun. `setConfig` no longer throws; an unconfigured card now shows a plain "Select an entity" message instead.
- Fixed a design flaw that could permanently prevent a freshly-added speaker from ever connecting: the card used to look up a `speaker_id` from the entity's attributes, but Home Assistant clears an entity's attributes while it's unavailable — and it starts unavailable until a card connects, a chicken-and-egg deadlock. The routing key is now simply the entity's own `entity_id`, which is always known to both sides.
- Bumped the card's cache-busting version so browsers pick up this fix on next load (still needs a hard refresh - see README Troubleshooting).

## 2026.09.14.1
- Initial release (as "Pipper Browser Speaker").
- Integration creates one `media_player` entity per configured browser speaker (Settings → Devices & services → Add integration → name it).
- Companion Lovelace card auto-registers with the frontend — no manual resource needed.
- MVP feature set: `media_player.play_media` (plays a URL), play, pause, stop, set volume, mute.
- TTS / `announce` support is planned for a follow-up release.
