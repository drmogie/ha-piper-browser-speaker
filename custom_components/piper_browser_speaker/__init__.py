"""The Piper Browser Speaker integration.

Registers a media_player entity per configured speaker and serves the
companion Lovelace card so it auto-loads on every dashboard - no manual
Lovelace resource needed.
"""
from __future__ import annotations

import logging

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CARD_URL, CARD_VERSION, DOMAIN, PLATFORMS
from .websocket_api import async_register_websocket_commands

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Piper Browser Speaker has no YAML configuration."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a Piper Browser Speaker config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    if not domain_data.get("_frontend_registered"):
        www_path = hass.config.path(
            "custom_components", DOMAIN, "www", CARD_URL.rsplit("/", 1)[-1]
        )
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL, www_path, True)]
        )
        add_extra_js_url(hass, f"{CARD_URL}?v={CARD_VERSION}")
        domain_data["_frontend_registered"] = True

    if not domain_data.get("_ws_registered"):
        async_register_websocket_commands(hass)
        domain_data["_ws_registered"] = True

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
