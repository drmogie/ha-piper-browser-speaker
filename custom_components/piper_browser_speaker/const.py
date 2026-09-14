"""Constants for the Piper Browser Speaker integration."""

from homeassistant.const import Platform

DOMAIN = "piper_browser_speaker"
PLATFORMS = [Platform.MEDIA_PLAYER]

CARD_FILENAME = "ha-piper-browser-speaker-card.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILENAME}"
CARD_VERSION = "2026.09.14.4"

SIGNAL_COMMAND = f"{DOMAIN}_command_{{}}"
SIGNAL_STATE = f"{DOMAIN}_state_{{}}"
SIGNAL_CONNECTION = f"{DOMAIN}_connection_{{}}"

WS_TYPE_SUBSCRIBE = f"{DOMAIN}/subscribe"
WS_TYPE_REPORT_STATE = f"{DOMAIN}/report_state"
