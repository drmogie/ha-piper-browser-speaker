/**
 * Piper Browser Speaker Card
 *
 * Place this card on a dashboard view and leave that view open in the
 * browser/tablet you want to turn into a media_player speaker. It connects
 * to Home Assistant over the existing frontend connection, plays whatever
 * the matching media_player entity is told to play (via a plain <audio>
 * element), and reports state back so the entity stays in sync.
 *
 * The entity's own entity_id is the routing key - no separate id to look up
 * or wait on, so the card can subscribe the instant an entity is picked,
 * even before that entity has ever reported a state.
 *
 * No build step, no external dependencies - plain custom elements.
 */
(() => {
  const CARD_TAG = "ha-piper-browser-speaker-card";
  const EDITOR_TAG = "ha-piper-browser-speaker-card-editor";
  const PLATFORM = "piper_browser_speaker";
  const WS_SUBSCRIBE = "piper_browser_speaker/subscribe";
  const WS_REPORT_STATE = "piper_browser_speaker/report_state";

  class HaPiperBrowserSpeakerCard extends HTMLElement {
    setConfig(config) {
      // Never throw here: this runs the moment the card is picked from the
      // "Add Card" list, before the user has chosen an entity in the editor.
      // Throwing breaks the editor dialog itself, not just the preview.
      this._config = config || {};
      this._ensureRendered();
      this._updateFromConfig();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      this._ensureRendered();
      this._updateFromConfig();
    }

    getCardSize() {
      return 2;
    }

    static getConfigElement() {
      return document.createElement(EDITOR_TAG);
    }

    static getStubConfig(hass) {
      const entities = hass && hass.entities ? hass.entities : {};
      const match = Object.keys(entities).find(
        (id) => entities[id].platform === PLATFORM
      );
      return { entity: match || "" };
    }

    connectedCallback() {
      if (this._hass && this._config && this._config.entity && !this._unsub) {
        this._subscribe();
      }
    }

    disconnectedCallback() {
      this._teardown();
    }

    _teardown() {
      if (this._unsub) {
        this._unsub();
        this._unsub = null;
      }
      this._subscribedEntity = null;
    }

    _updateFromConfig() {
      const entityId = this._config.entity;
      const stateObj = this._hass ? this._hass.states[entityId] : undefined;
      this._updateHeader(stateObj, entityId);

      if (!entityId) {
        this._teardown();
        this._setStatus("unconfigured");
        return;
      }

      if (this._hass && entityId !== this._subscribedEntity) {
        this._subscribe();
      }
    }

    async _subscribe() {
      this._teardown();
      const entityId = this._config.entity;
      if (!this._hass || !entityId) return;

      this._subscribedEntity = entityId;
      try {
        this._unsub = await this._hass.connection.subscribeMessage(
          (msg) => this._handleCommand(msg),
          { type: WS_SUBSCRIBE, entity_id: entityId }
        );
        this._setStatus("connected");
        // Announce our starting state so the entity leaves "unavailable".
        this._reportState({
          state: "idle",
          volume_level: this._audio ? this._audio.volume : 1,
          is_volume_muted: this._audio ? this._audio.muted : false,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Piper Browser Speaker: subscribe failed", err);
        this._setStatus("error");
      }
    }

    _handleCommand(msg) {
      if (!this._audio) return;
      switch (msg.type) {
        case "play_media":
          this._mediaTitle = this._deriveTitle(msg.media_id);
          this._audio.src = msg.media_id;
          this._audio
            .play()
            .catch((err) => console.error("Piper Browser Speaker: play failed", err));
          break;
        case "play":
          this._audio.play().catch(() => {});
          break;
        case "pause":
          this._audio.pause();
          break;
        case "stop":
          this._audio.pause();
          this._audio.currentTime = 0;
          this._reportState({ state: "idle" });
          break;
        case "set_volume":
          this._audio.volume = msg.volume;
          break;
        case "set_mute":
          this._audio.muted = msg.muted;
          break;
        case "announce": {
          // Duck-and-resume: pause whatever's playing, play the
          // announcement on a separate audio channel, then resume where
          // the main track left off. The main <audio>'s own play/pause
          // events already report state, so no extra reporting needed here.
          const wasPlaying = !this._audio.paused && !this._audio.ended;
          if (wasPlaying) this._audio.pause();
          this._announceAudio.src = msg.media_id;
          this._announceAudio
            .play()
            .catch((err) => console.error("Piper Browser Speaker: announce failed", err));
          this._announceAudio.onended = () => {
            if (wasPlaying) this._audio.play().catch(() => {});
          };
          break;
        }
        default:
          break;
      }
    }

    _deriveTitle(url) {
      try {
        const path = new URL(url, window.location.href).pathname;
        return decodeURIComponent(path.split("/").pop() || url);
      } catch (err) {
        return url;
      }
    }

    _reportState(partial) {
      if (!this._hass || !this._config.entity) return;
      this._hass.callWS({
        type: WS_REPORT_STATE,
        entity_id: this._config.entity,
        state: partial,
      });
    }

    _ensureRendered() {
      if (this.shadowRoot) return;
      const shadow = this.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          ha-card { padding: 16px; }
          .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
          .dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: var(--disabled-text-color, #bdbdbd); flex-shrink: 0;
          }
          .dot.connected { background: var(--success-color, #43a047); }
          .dot.error { background: var(--error-color, #db4437); }
          .status { color: var(--secondary-text-color); font-size: 0.9em; }
          .title { font-weight: 500; }
          .now-playing { color: var(--secondary-text-color); font-size: 0.9em; margin-bottom: 8px; min-height: 1.2em; }
          audio { width: 100%; }
        </style>
        <ha-card>
          <div class="row">
            <span class="dot" id="dot"></span>
            <span class="title" id="title"></span>
          </div>
          <div class="status" id="status">Select an entity in the card editor</div>
          <div class="now-playing" id="now-playing"></div>
          <audio id="audio" controls></audio>
        </ha-card>
      `;
      this._audio = shadow.getElementById("audio");
      // Announcements play on their own audio channel (not in the DOM - a
      // plain Audio() object plays fine detached) so they never touch the
      // main track's src/position, and they're always audible regardless
      // of the main track's own volume/mute.
      this._announceAudio = new Audio();
      this._audio.addEventListener("play", () => this._reportState({ state: "playing" }));
      this._audio.addEventListener("pause", () => {
        if (!this._audio.ended) this._reportState({ state: "paused" });
      });
      this._audio.addEventListener("ended", () => this._reportState({ state: "idle" }));
      this._audio.addEventListener("volumechange", () =>
        this._reportState({
          volume_level: this._audio.volume,
          is_volume_muted: this._audio.muted,
        })
      );
      this._audio.addEventListener("loadedmetadata", () => {
        shadow.getElementById("now-playing").textContent = this._mediaTitle
          ? `Now playing: ${this._mediaTitle}`
          : "";
        this._reportState({ media_title: this._mediaTitle || "" });
      });
    }

    _setStatus(kind) {
      if (!this.shadowRoot) return;
      const dot = this.shadowRoot.getElementById("dot");
      const status = this.shadowRoot.getElementById("status");
      dot.classList.toggle("connected", kind === "connected");
      dot.classList.toggle("error", kind === "error");
      const labels = {
        connected: "Connected",
        error: "Couldn't connect - check the browser console",
        unconfigured: "Select an entity in the card editor",
        disconnected: "Not connected",
      };
      status.textContent = labels[kind] || labels.disconnected;
    }

    _updateHeader(stateObj, entityId) {
      if (!this.shadowRoot) return;
      const title = this.shadowRoot.getElementById("title");
      title.textContent =
        (this._config && this._config.title) ||
        (stateObj && stateObj.attributes.friendly_name) ||
        entityId ||
        "Piper Browser Speaker";
    }
  }

  class HaPiperBrowserSpeakerCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    _render() {
      // Home Assistant doesn't guarantee setConfig() runs before hass is
      // first assigned - default _config here too, not just in setConfig.
      this._config = this._config || {};
      if (!this._hass) return;

      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<div class="wrap" style="padding: 12px 0;"></div>`;
      }

      if (!this._picker) {
        this._picker = document.createElement("ha-entity-picker");
        this._picker.label = "Speaker entity";
        this._picker.includeDomains = ["media_player"];
        this._picker.entityFilter = (stateObj) => {
          const reg = this._hass.entities && this._hass.entities[stateObj.entity_id];
          return reg ? reg.platform === PLATFORM : true;
        };
        this._picker.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          this._config = { ...this._config, entity: ev.detail.value };
          this._fireChanged();
        });
        this.shadowRoot.querySelector(".wrap").appendChild(this._picker);
      }

      this._picker.hass = this._hass;
      this._picker.value = this._config.entity || "";
    }

    _fireChanged() {
      const event = new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    }
  }

  if (!customElements.get(EDITOR_TAG)) {
    customElements.define(EDITOR_TAG, HaPiperBrowserSpeakerCardEditor);
  }
  if (!customElements.get(CARD_TAG)) {
    customElements.define(CARD_TAG, HaPiperBrowserSpeakerCard);
  }

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TAG,
    name: "Piper Browser Speaker Card",
    description: "Turns this browser into a Home Assistant media_player speaker.",
  });
})();
