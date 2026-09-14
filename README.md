# Piper Browser Speaker

Turns a web browser tab into a Home Assistant `media_player` speaker. Install the integration, name a speaker, then drop the companion card onto a dashboard view left open in the browser you want to use — that tab becomes a real `media_player` entity you can target with `media_player.play_media`, volume/mute, and TTS announcements.

## How it works

- The **integration** creates a `media_player` entity for each speaker you configure. Commands sent to that entity (play a URL, pause, stop, set volume, mute) are pushed live to whichever browser tab currently has the matching card open.
- The **card** ships inside the integration and registers itself with the frontend automatically — no separate Lovelace resource to add. Put it on a dashboard, open that dashboard in the browser/tablet/kiosk you want to turn into a speaker, and it connects automatically and plays audio through that browser's speakers using a plain `<audio>` element.
- If no browser has that speaker's card open, the entity shows as unavailable.

## Installation

### HACS

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=drmogie&repository=ha-piper-browser-speaker&category=integration)

Add this repository to HACS (category: Integration), install, then restart Home Assistant.

### Manual

Copy `custom_components/piper_browser_speaker` into your `config/custom_components/` folder and restart Home Assistant.

## Setup

1. Settings → Devices & services → Add integration → **Piper Browser Speaker**.
2. Give the speaker a name (e.g. "Piper's Laptop"). This creates a `media_player` entity.
3. Edit any dashboard view, add card → **Piper Browser Speaker Card**, and pick the entity you just created in the GUI editor.
4. Open that dashboard view in the browser you want to act as the speaker and leave it open. The card connects automatically.
5. Test it from Developer Tools → Actions → `media_player.play_media`, targeting the entity, with a direct audio URL as the media content ID and `music` as the media content type.

Repeat steps 1–4 for each additional browser/device you want to turn into a speaker.

## Troubleshooting

- **Card doesn't appear at all / "Custom element doesn't exist":** the card's script only gets registered once the integration has at least one speaker configured, and your browser only re-checks that list on page load. Add an integration entry first, then hard-refresh the dashboard tab (Ctrl+Shift+R).
- **Card shows but you can't pick an entity / editor won't load:** update to `2026.09.14.2` or later — earlier builds had a bug where the card errored out before the entity picker could render if no entity was selected yet.

## Current support

- `media_player.play_media` (URL playback)
- Play / pause / stop
- Volume set / mute
- Live connected/disconnected availability
- TTS / announcements (`tts.speak`, Assist pipeline responses, or `media_player.play_media` with `announce: true`) — ducks whatever's playing, plays the announcement, then resumes where it left off, always at full volume regardless of the main track's volume/mute

Not yet supported: media browsing, queueing. Planned as a possible future addition.

## License

MIT — see [LICENSE](LICENSE).
