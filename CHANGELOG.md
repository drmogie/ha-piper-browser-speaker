# Changelog

## 2026.09.16.1
- The card now shows the Piper Browser Speaker logo (a small, resized copy embedded directly in the card - no extra file to load) instead of just a status dot and title.
- Removed the native audio scrubber/play-bar - playback is still handled by the same `<audio>` element, it's just no longer shown, since the entity's own controls (Developer Tools, a media control card, voice commands, etc.) are what actually start/stop it.
- The logo now gently bounces while anything is actually playing through the speaker - the main track or a TTS/announcement - and stops as soon as playback pauses or ends.
- No config changes needed - existing speakers pick this up automatically after updating.

## 2026.09.15.1
- Fixed TTS/announcements (and any media-source playback) failing to load at all when the dashboard is viewed over HTTPS through a reverse proxy or remote-access tunnel, with Home Assistant's *internal* URL set to a plain-HTTP local address. `async_play_media` used to always turn the audio path into a full URL using Home Assistant's own internal/external URL setting - on a setup like that, it built an `http://` link on a page loaded over `https://`, which browsers block outright as mixed content (silently - no error dialog, nothing plays, and the console shows `Mixed Content` / `NotSupportedError`). The URL sent to the card is now kept relative whenever possible, so it resolves against whatever origin the dashboard tab is already using - the tab that has to actually fetch and play it. A plain external URL passed directly to `play_media` is unaffected either way.
- No config changes needed - existing speakers pick this up automatically after updating.

## 2026.09.14.9
- Fixed announcements (and any playback) silently failing with a `NotAllowedError` in the browser console when the dashboard tab hadn't had a direct tap/click yet - browsers refuse script-triggered audio until the page has real user interaction, which every command from Home Assistant is (there's no click behind it). The card now shows a "Browser blocked audio - tap to enable" banner when this happens and automatically retries the exact playback that got blocked as soon as it's tapped - a one-time thing per page load, most relevant to a kiosk/wall-mounted display nobody has touched since it loaded.

## 2026.09.14.8
- Fixed the integration icon being unreadable in the integrations list. The full speaker-grille logo is great at full size but reads as a plain dark circle at the 40px icon size Home Assistant actually uses - `icon.png`/`icon@2x.png` are now a tighter crop of just the blue Home Assistant badge mark, which stays recognizable at small sizes. `logo.png`/`logo@2x.png` are unchanged (the full grille image, used in larger contexts like the integration's detail page).

## 2026.09.14.7
- Added the integration's logo/icon (`custom_components/piper_browser_speaker/brand/`), served locally via Home Assistant 2026.3's custom-integration `brand/` folder support - shows up automatically on the integration entry, no submission to the home-assistant/brands repo needed.

## 2026.09.14.6
- Fixed TTS/Assist announcements never being heard. `tts.speak` (and Assist pipeline responses, and browsed media) hand `async_play_media` a virtual `media-source://...` reference, not a real audio URL - sending that straight to the browser card produced a hard "Format error" on the announcement's audio element, since browsers don't understand the `media-source:` scheme. `async_play_media` now resolves any `media_source` id to its real, playable URL (and makes a relative one absolute) before sending it to the card, the same way Home Assistant's own Cast integration does it. Plain direct-URL playback (e.g. calling `media_player.play_media` with a plain `https://...` link, as used for earlier testing) is unaffected - it already worked and still does.
- No config changes needed - existing speakers pick this up automatically after updating.

## 2026.09.14.5
- Fixed announcements never resuming the main track afterward. The card's `connectedCallback()` used a different (and async-unsafe) guard than the rest of the subscribe logic, so a dashboard reflow (e.g. Lovelace Sections reparenting the card) could open a second, independent subscription to the same entity while the first was still connecting. Every command from the backend then arrived twice - the second, spurious delivery of an `announce` command always computed "nothing was playing," overwriting the real resume handler with a no-op. `connectedCallback()` now uses the same synchronous guard as the rest of the card, and a stale in-flight subscription (from a reconnect that happens before the previous one finishes) now closes itself instead of staying live.
- No config changes needed - existing speakers pick this up automatically after updating.

## 2026.09.14.4
- Added TTS / announcement support. The entity now declares `MediaPlayerEntityFeature.MEDIA_ANNOUNCE`, so `tts.speak` and Assist pipeline responses (or a plain `media_player.play_media` call with `announce: true`) work against this speaker.
- Announcements play on their own audio channel in the card - the main track (if playing) is paused, the announcement plays, and the main track automatically resumes where it left off afterward. Announcements always play at full volume regardless of the main track's volume/mute, so they stay audible.
- No config changes needed - existing speakers pick this up automatically after updating.

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
