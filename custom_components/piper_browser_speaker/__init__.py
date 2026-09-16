"""The Piper Browser Speaker integration.

Registers a media_player entity per configured speaker and serves the
companion Lovelace card so it auto-loads on every dashboard - no manual
Lovelace resource needed.
"""
from __future__ import annotations

import asyncio
import logging

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CARD_URL, CARD_VERSION, DOMAIN, PLATFORMS, STATIC_URL_ROOT
from .websocket_api import async_register_websocket_commands

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Piper Browser Speaker has no YAML configuration."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a Piper Browser Speaker config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    # A second (or third...) speaker configured on this HA instance gets its
    # own config entry, and Home Assistant sets up multiple entries for the
    # same integration concurrently at startup. Without a lock here, two
    # entries' async_setup_entry() calls can both see "_frontend_registered"
    # as still False (neither has finished awaiting the registration call
    # yet), and both try to register the same static path/route - the second
    # one throws, and that entry's whole setup fails ("setup_error", its
    # media_player entity never gets created at all). The lock makes the
    # check-then-register-then-flag sequence atomic across concurrent entries
    # instead of just checking a flag with an await in between.
    lock = domain_data.setdefault("_setup_lock", asyncio.Lock())
    async with lock:
        if not domain_data.get("_frontend_registered"):
            # Register the whole www/ folder as one static directory (not
            # just the card's own .js file) - 2026.09.16.10, so the logo
            # (piper-logo.webp) and any future static asset are servable
            # without each needing their own separate registration. The
            # card's JS is still reached at the same CARD_URL as before,
            # since that's just this directory root + the filename.
            www_dir = hass.config.path("custom_components", DOMAIN, "www")
            await hass.http.async_register_static_paths(
                [StaticPathConfig(STATIC_URL_ROOT, www_dir, True)]
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
