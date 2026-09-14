"""Media player platform for Piper Browser Speaker.

The entity's own entity_id doubles as the routing key used to talk to the
browser card - always known on both sides, so there's no separate id to
keep in sync and no chicken-and-egg problem waiting for a card to expose it.
"""
from __future__ import annotations

import logging

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
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
        """Send a URL to the browser card to play."""
        self._send_command(
            {"type": "play_media", "media_id": media_id, "media_type": media_type}
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
