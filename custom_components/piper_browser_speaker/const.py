"""Constants for the Piper Browser Speaker integration."""

from homeassistant.const import Platform

DOMAIN = "piper_browser_speaker"
PLATFORMS = [Platform.MEDIA_PLAYER]

CARD_FILENAME = "ha-piper-browser-speaker-card.js"
# The whole www/ folder is registered as one static directory at this root
# (see __init__.py) - not just the card's own JS file - so other static
# assets served alongside it (currently just the logo) don't each need their
# own separate static-path registration.
STATIC_URL_ROOT = f"/{DOMAIN}"
CARD_URL = f"{STATIC_URL_ROOT}/{CARD_FILENAME}"
CARD_VERSION = "2026.09.16.10"

SIGNAL_COMMAND = f"{DOMAIN}_command_{{}}"
SIGNAL_STATE = f"{DOMAIN}_state_{{}}"
SIGNAL_CONNECTION = f"{DOMAIN}_connection_{{}}"

WS_TYPE_SUBSCRIBE = f"{DOMAIN}/subscribe"
WS_TYPE_REPORT_STATE = f"{DOMAIN}/report_state"
