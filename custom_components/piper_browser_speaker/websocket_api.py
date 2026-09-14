"""WebSocket API used by the companion browser card.

Routing key is simply the target media_player's entity_id - always known to
both sides (the card is configured with an entity_id, the entity always
knows its own entity_id), so there's no separate id to keep in sync.

Two commands:
  - subscribe: a browser card opens a long-lived subscription for one
    entity_id and receives every command sent to that entity as a
    websocket event, for as long as the subscription (i.e. the dashboard
    tab) stays open.
  - report_state: the browser card pushes its current playback state back
    (state/volume/mute/title) whenever it changes, which is forwarded to
    the matching media_player entity so its state in HA stays accurate.
"""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)

from .const import (
    SIGNAL_COMMAND,
    SIGNAL_CONNECTION,
    SIGNAL_STATE,
    WS_TYPE_REPORT_STATE,
    WS_TYPE_SUBSCRIBE,
)

_LOGGER = logging.getLogger(__name__)


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register this integration's websocket commands. Call exactly once."""
    websocket_api.async_register_command(hass, websocket_subscribe)
    websocket_api.async_register_command(hass, websocket_report_state)


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SUBSCRIBE,
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    }
)
@callback
def websocket_subscribe(hass, connection, msg):
    """Subscribe the calling browser card to commands for one entity_id."""
    entity_id = msg[ATTR_ENTITY_ID]

    @callback
    def forward_command(command: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], command))

    unsub_command = async_dispatcher_connect(
        hass, SIGNAL_COMMAND.format(entity_id), forward_command
    )

    @callback
    def unsubscribe() -> None:
        unsub_command()
        async_dispatcher_send(hass, SIGNAL_CONNECTION.format(entity_id), False)

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])

    # A card just connected for this entity - tell it it's live.
    async_dispatcher_send(hass, SIGNAL_CONNECTION.format(entity_id), True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_REPORT_STATE,
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required("state"): dict,
    }
)
@callback
def websocket_report_state(hass, connection, msg):
    """Receive a state update pushed from a browser card."""
    entity_id = msg[ATTR_ENTITY_ID]
    async_dispatcher_send(hass, SIGNAL_STATE.format(entity_id), msg["state"])
    connection.send_result(msg["id"])
