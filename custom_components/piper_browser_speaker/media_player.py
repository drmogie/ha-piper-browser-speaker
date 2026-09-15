"""Media player platform for Piper Browser Speaker.

The entity's own entity_id doubles as the routing key used to talk to the
browser card - always known on both sides, so there's no separate id to
keep in sync and no chicken-and-egg problem waiting for a card to expose it.
"""
from __future__ import annotations

import logging

from homeassistant.components import media_source
from homeassistant.components.media_player import (
    ATTR_MEDIA_ANNOUNCE,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
    async_process_play_media_url,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_COMMAND, SIGNAL_CONNECTION, SIGNAL_STATE

_LOGGER = logging.getLogger(__name__)

_STATE_MAP = {
    "playing": MediaPlayerState.PLAYING,
    "paused": MediaPlayerState.PAUSED,
    "idle": MediaPlayerState.IDLE,
}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the single media_player entity for this config entry."""
    async_add_entities([PiperBrowserSpeaker(entry)])


class PiperBrowserSpeaker(MediaPlayerEntity):
    """A media_player entity backed by a browser tab running the companion card."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_should_poll = False
    _attr_supported_features = (
        MediaPlayerEntityFeature.PLAY_MEDIA
        | MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.PAUSE
        | MediaPlayerEntityFeature.STOP
        | MediaPlayerEntityFeature.VOLUME_SET
        | MediaPlayerEntityFeature.VOLUME_MUTE
        | MediaPlayerEntityFeature.MEDIA_ANNOUNCE
    )

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = entry.entry_id
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.title,
            "manufacturer": "Piper Browser Speaker",
            "model": "Browser Speaker",
        }
        # Unavailable until a browser card actually subscribes to this entity.
        self._attr_available = False
        self._attr_state = MediaPlayerState.IDLE
        self._attr_volume_level = 1.0
        self._attr_is_volume_muted = False
        self._attr_media_title = None

    async def async_added_to_hass(self) -> None:
        """Wire up dispatcher listeners for state + connection updates."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, SIGNAL_STATE.format(self.entity_id), self._handle_state
            )
        )
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                SIGNAL_CONNECTION.format(self.entity_id),
                self._handle_connection,
            )
        )

    @callback
    def _handle_state(self, state: dict) -> None:
        if "state" in state:
            self._attr_state = _STATE_MAP.get(state["state"], MediaPlayerState.IDLE)
        if "volume_level" in state:
            self._attr_volume_level = state["volume_level"]
        if "is_volume_muted" in state:
            self._attr_is_volume_muted = state["is_volume_muted"]
        if "media_title" in state:
            self._attr_media_title = state["media_title"]
        self._attr_available = True
        self.async_write_ha_state()

    @callback
    def _handle_connection(self, connected: bool) -> None:
        self._attr_available = connected
        if not connected:
            self._attr_state = MediaPlayerState.IDLE
        self.async_write_ha_state()

    def _send_command(self, command: dict) -> None:
        async_dispatcher_send(self.hass, SIGNAL_COMMAND.format(self.entity_id), command)

    async def async_play_media(self, media_type: str, media_id: str, **kwargs) -> None:
        """Send a URL to the browser card to play.

        Used both for plain playback and for TTS/announcements - a TTS
        engine's tts.speak action (or an Assist pipeline response) ends up
        calling this same method with the generated audio URL. When called
        with announce=True, tell the card to duck-and-resume instead of
        replacing whatever is currently playing.

        TTS/Assist and media browsing hand us a virtual media-source://
        reference rather than a real URL - the browser has no idea what to
        do with that, so it has to be resolved to an actual playable URL
        first (and, if that URL is relative to this HA instance, made
        absolute) before it's sent to the card.
        """
        if media_source.is_media_source_id(media_id):
            sourced_media = await media_source.async_resolve_media(
                self.hass, media_id, self.entity_id
            )
            media_type = sourced_media.mime_type
            media_id = sourced_media.url

        # Keep the URL relative when possible (allow_relative_url=True) instead of
        # letting Home Assistant absolutize it against its configured internal/
        # external URL. This card's "device" is whatever browser tab the dashboard
        # is already open in - that tab has to fetch the audio itself, so the URL
        # needs to resolve against the origin that tab is already loaded from, not
        # HA's guess at internal vs. external. A relative URL does that for free
        # (browsers resolve a bare path against the current page's own origin), and
        # sidesteps the case where HA's internal URL is a plain-HTTP LAN address but
        # the dashboard is being viewed over HTTPS through a reverse proxy/tunnel -
        # mixing those (an https:// page loading an http:// audio file) gets the
        # request blocked outright as mixed content. An already-absolute media_id
        # (e.g. a plain external URL used directly) is untouched either way.
        media_id = async_process_play_media_url(
            self.hass, media_id, allow_relative_url=True
        )

        command_type = "announce" if kwargs.get(ATTR_MEDIA_ANNOUNCE) else "play_media"
        self._send_command(
            {"type": command_type, "media_id": media_id, "media_type": media_type}
        )

    async def async_media_play(self) -> None:
        self._send_command({"type": "play"})

    async def async_media_pause(self) -> None:
        self._send_command({"type": "pause"})

    async def async_media_stop(self) -> None:
        self._send_command({"type": "stop"})

    async def async_set_volume_level(self, volume: float) -> None:
        self._send_command({"type": "set_volume", "volume": volume})

    async def async_mute_volume(self, mute: bool) -> None:
        self._send_command({"type": "set_mute", "muted": mute})
