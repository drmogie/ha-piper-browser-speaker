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
  // Shown as small print at the bottom of the GUI editor only (never on the
  // card itself) so Mogie can tell at a glance which build is actually
  // loaded in the browser, without opening the YAML view or DevTools. Bump
  // this alongside manifest.json/const.py's CARD_VERSION on every release -
  // there's no automated single-source-of-truth for it across the Python
  // and JS sides of this integration.
  const CARD_VERSION = "2026.09.18.01";
  const WS_SUBSCRIBE = "piper_browser_speaker/subscribe";
  const WS_REPORT_STATE = "piper_browser_speaker/report_state";
  // The card's own small speaker-grille logo. Served as a real static file
  // (piper-logo.webp, alongside this JS in the same www/ folder, both now
  // registered together as one static directory - see __init__.py) rather
  // than embedded as a data URI in this script, as of 2026.09.16.10 -
  // inlining it used to add ~32KB of base64 text to the exact file that has
  // to finish downloading and running before the custom element is defined,
  // which made this the single biggest thing slowing that down. Loading it
  // as a plain <img src> instead means the image itself loads separately,
  // in parallel, AFTER the element is already defined - it can no longer
  // make the "Configuration error"/"custom element doesn't exist" race
  // (see the card's own README/CHANGELOG) any more likely than it already
  // was. The browser also caches a real static file more effectively across
  // card updates than a data URI baked into a versioned script.
  const LOGO_URL = `/${PLATFORM}/piper-logo.webp`;

  // 2026.09.16.7 design reset: earlier releases tried to make the logo
  // scale its own size in proportion to the card (percentage width, then
  // CSS container queries, then a couple of ResizeObserver-driven "hide /
  // right-align / center" width bands) - all of that fighting-the-card's-
  // own-size approach is what produced the squish/clip/skip-a-zone bugs
  // across .16.3-.16.6. The logo now has a fixed, explicitly-configured
  // pixel size and sits pinned to the card's right edge at that size no
  // matter how big the card gets (this matches the target look the user
  // mocked up at a 12-column-wide card - "anything larger will just be the
  // same size as 12x3" is now true by construction, since the size no
  // longer depends on the card's size at all). The ONLY thing that still
  // reacts to the card's real width (still via ResizeObserver, not a CSS
  // container query - see the earlier releases' notes on why container
  // queries fight Sections' default "fit to content" auto-height sizing)
  // is whether the logo shows at all: below LOGO_HIDE_WIDTH_DEFAULT there
  // isn't room for a legible logo next to the name/status text, so it's
  // hidden and the text gets the card's full width back ("anything small
  // should just be the text").
  // 2026.09.16.9: baseline defaults updated to Mogie's own tuned settings
  // (previously 220/16 - see the CHANGELOG for the full list) now that he's
  // dialed in a layout he wants every new card to start from.
  const LOGO_HIDE_WIDTH_DEFAULT = 375;
  // Logo's fixed size and its distance from the card's right (padding) edge,
  // in pixels - all three are also exposed as `logo_width`/`logo_height`/
  // `logo_right_offset` card config options (see the editor below) so they
  // can be tuned to match a particular dashboard without a new release.
  const LOGO_WIDTH_DEFAULT = 110;
  const LOGO_HEIGHT_DEFAULT = 110;
  // A CSS position: absolute child's "right: 0" sits flush with its
  // containing block's PADDING edge (i.e. right at ha-card's border, not
  // inset by ha-card's own 16px padding the way the text content is) - so
  // this defaults to a value close to that inset rather than sitting flush
  // against the card's edge.
  const LOGO_RIGHT_OFFSET_DEFAULT = 50;

  // Labels for the playback state shown alongside the connection status
  // (e.g. "Connected (Playing)") - "announcing" is local display state only
  // (this._isAnnouncing), separate from the `is_announcing` extra attribute
  // now also reported to the backend (see the announce-channel listeners
  // below) - the label here is purely about what this card shows, not
  // about what's sent to HA.
  const PLAYBACK_LABELS = { idle: "Idle", playing: "Playing", paused: "Paused", announcing: "Announcing" };

  // Anchor corners available for the "device name row" and "status text"
  // segments' optional custom positioning. Three-way meaning, since 2026.09.16.9:
  //  - "" (field left on "Use default") -> falls back to that segment's own
  //    *_ANCHOR_DEFAULT constant below (now a real corner, per Mogie's
  //    tuned defaults - previously "" meant "no position" too, but now that
  //    the baked-in default IS a position, "unset" and "explicitly off" are
  //    no longer the same thing and need distinct values).
  //  - "none" -> explicitly opts back OUT of custom positioning, back to
  //    the card's plain top-to-bottom layout, regardless of the default.
  //  - any corner value -> pins that segment via position: absolute at a
  //    fixed pixel offset from that corner, same idea as the logo's own
  //    fixed right-edge pinning above.
  const SEGMENT_ANCHOR_OPTIONS = [
    { value: "", label: "Use default" },
    { value: "none", label: "Normal layout (no custom position)" },
    { value: "top-left", label: "Top-left corner" },
    { value: "top-right", label: "Top-right corner" },
    { value: "bottom-left", label: "Bottom-left corner" },
    { value: "bottom-right", label: "Bottom-right corner" },
  ];
  const ROW_ANCHOR_DEFAULT = "top-left";
  const ROW_OFFSET_X_DEFAULT = 15;
  const ROW_OFFSET_Y_DEFAULT = 5;
  const STATUS_ANCHOR_DEFAULT = "bottom-left";
  const STATUS_OFFSET_X_DEFAULT = 15;
  const STATUS_OFFSET_Y_DEFAULT = 5;
  // Below this card width the status text hides entirely, same idea as
  // LOGO_HIDE_WIDTH_DEFAULT - 0 means "never hide" (off by default; unlike
  // the position defaults above, Mogie didn't ask for a specific threshold
  // here, so this stays opt-in rather than guessing a number for him).
  const STATUS_HIDE_WIDTH_DEFAULT = 0;

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
      return 3;
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
      // Guard on the same synchronous marker _updateFromConfig() uses
      // (_subscribedEntity, set at the very start of _subscribe()) rather
      // than on _unsub, which isn't set until the subscribeMessage promise
      // resolves. Dashboards that reparent elements (e.g. Lovelace
      // Sections) can call connectedCallback again while an earlier
      // _subscribe() call is still in flight; guarding on _unsub let a
      // second, independent subscription slip through, so every command
      // from the backend arrived twice.
      const entityId = this._config && this._config.entity;
      if (this._hass && entityId && entityId !== this._subscribedEntity) {
        this._subscribe();
      }
    }

    disconnectedCallback() {
      this._teardown();
    }

    _teardown() {
      // Bump the generation so an in-flight _subscribe() call that resolves
      // later (its subscribeMessage promise) recognizes it's stale and
      // closes itself instead of becoming a second live subscription.
      this._subscribeGeneration = (this._subscribeGeneration || 0) + 1;
      if (this._unsub) {
        this._unsub();
        this._unsub = null;
      }
      this._subscribedEntity = null;
    }

    _updateFromConfig() {
      // Re-read the (possibly just-changed, via the editor) logo config and
      // immediately re-apply it - the size/offset take effect right away,
      // and the hide-below-this-width threshold is re-applied against the
      // card's current real size rather than waiting for the next actual
      // resize (the ResizeObserver only fires on a genuine resize, so
      // without this a threshold tweak in the editor wouldn't visibly do
      // anything until the card next happened to change size).
      const hideWidth = Number(this._config.logo_hide_width);
      const logoWidth = Number(this._config.logo_width);
      const logoHeight = Number(this._config.logo_height);
      const logoRightOffset = Number(this._config.logo_right_offset);
      this._logoHideWidth = Number.isFinite(hideWidth) && hideWidth > 0 ? hideWidth : LOGO_HIDE_WIDTH_DEFAULT;
      this._logoWidth = Number.isFinite(logoWidth) && logoWidth > 0 ? logoWidth : LOGO_WIDTH_DEFAULT;
      this._logoHeight = Number.isFinite(logoHeight) && logoHeight > 0 ? logoHeight : LOGO_HEIGHT_DEFAULT;
      this._logoRightOffset = Number.isFinite(logoRightOffset) && logoRightOffset >= 0 ? logoRightOffset : LOGO_RIGHT_OFFSET_DEFAULT;
      // Status text hide-below-width threshold - same idea/shape as the
      // logo's own logo_hide_width above.
      const statusHideWidth = Number(this._config.status_hide_width);
      this._statusHideWidth =
        Number.isFinite(statusHideWidth) && statusHideWidth > 0 ? statusHideWidth : STATUS_HIDE_WIDTH_DEFAULT;

      this._applyLogoLayout();
      if (this._card) {
        const cardWidth = this._card.getBoundingClientRect().width;
        this._applyLogoVisibility(cardWidth);
        this._applyStatusVisibility(cardWidth);
      }

      // Optional custom positioning for the device-name row and the status
      // text, same fixed-pixel-anchor idea as the logo above. Left on "Use
      // default" (an unset/empty config value), each falls back to its own
      // *_ANCHOR_DEFAULT constant; picking "Normal layout" explicitly opts
      // back out to the card's plain top-to-bottom flow instead.
      const rowAnchorRaw = this._config.row_anchor;
      const rowAnchor = rowAnchorRaw != null && rowAnchorRaw !== "" ? rowAnchorRaw : ROW_ANCHOR_DEFAULT;
      const rowOffsetX = Number(this._config.row_offset_x);
      const rowOffsetY = Number(this._config.row_offset_y);
      this._applySegmentPosition(
        this._row,
        rowAnchor,
        Number.isFinite(rowOffsetX) ? rowOffsetX : ROW_OFFSET_X_DEFAULT,
        Number.isFinite(rowOffsetY) ? rowOffsetY : ROW_OFFSET_Y_DEFAULT
      );

      const statusAnchorRaw = this._config.status_anchor;
      const statusAnchor = statusAnchorRaw != null && statusAnchorRaw !== "" ? statusAnchorRaw : STATUS_ANCHOR_DEFAULT;
      const statusOffsetX = Number(this._config.status_offset_x);
      const statusOffsetY = Number(this._config.status_offset_y);
      this._applySegmentPosition(
        this._statusEl,
        statusAnchor,
        Number.isFinite(statusOffsetX) ? statusOffsetX : STATUS_OFFSET_X_DEFAULT,
        Number.isFinite(statusOffsetY) ? statusOffsetY : STATUS_OFFSET_Y_DEFAULT
      );

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
      this._subscribeGeneration = (this._subscribeGeneration || 0) + 1;
      const generation = this._subscribeGeneration;
      try {
        const unsub = await this._hass.connection.subscribeMessage(
          (msg) => this._handleCommand(msg),
          { type: WS_SUBSCRIBE, entity_id: entityId }
        );
        if (generation !== this._subscribeGeneration) {
          // A newer _subscribe()/_teardown() ran while this call was
          // awaiting subscribeMessage - this subscription is stale (its
          // entity may have changed, or the card was torn down and
          // reconnected). Close it immediately rather than let it become a
          // second live subscription delivering every command twice.
          unsub();
          return;
        }
        this._unsub = unsub;
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
          this._attemptPlay(this._audio);
          break;
        case "play":
          this._attemptPlay(this._audio);
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
          this._announceAudio.onended = () => {
            if (wasPlaying) this._attemptPlay(this._audio);
          };
          this._attemptPlay(this._announceAudio);
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
      // Track the playback state locally (independent of whether reporting
      // it to the backend succeeds/is even possible yet) so the status line
      // can show it - e.g. "Connected (Playing)" - alongside the plain
      // connection status.
      if (partial && typeof partial.state === "string") {
        this._playbackState = partial.state;
        this._renderStatus();
      }
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
          /* height: 100% here too, chaining the percentage all the way from
             the Sections grid cell down through this custom element to
             ha-card below - without it, ha-card's own height: 100% only had
             :host's *auto* height to resolve against even when the grid
             cell itself had a real fixed height, which is the likely cause
             of a fixed-size card not actually filling the full area it was
             given. Still degrades gracefully to a no-op on the default
             auto-sized card, same as every other percentage-height rule
             here. */
          :host { display: block; height: 100%; }
          ha-card {
            padding: 16px;
            box-sizing: border-box;
            height: 100%;
            min-height: 48px;
            /* Positioning context for the logo, which is now pinned to the
               card's right edge via position: absolute rather than living
               in the normal text-content flow (see .logo-wrap below). */
            position: relative;
            overflow: hidden;
          }
          /* Everything except the logo - the dot/name row, status, audio
             lock banner, now-playing line - lives in this flex column so it
             can still fill the card's real height and let .status sink to
             the bottom exactly like before, but independently of the logo
             (which no longer participates in this flow at all). */
          .content {
            height: 100%;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
          }
          .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex: 0 0 auto; }
          /* Applied by _applySegmentPosition() when the editor's row/status
             "position" is set to something other than "Default" - top/
             right/bottom/left are then set inline per-instance to whichever
             corner + pixel offset was chosen, same fixed-pixel-pin idea as
             .logo-wrap. Being position: absolute takes it out of .content's
             flex flow automatically (no other CSS change needed), which
             also means a positioned segment stops contributing to the
             card's natural/auto height - expected trade-off, only applies
             once a segment is actually moved out of the default layout. */
          .row.positioned, .status.positioned {
            position: absolute;
            margin: 0;
            white-space: nowrap;
          }
          /* Toggled by _applyStatusVisibility() below status_hide_width -
             works the same whether or not .status is also .positioned. */
          .status.hide-status {
            display: none;
          }
          .dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: var(--disabled-text-color, #bdbdbd); flex-shrink: 0;
          }
          .dot.connected { background: var(--success-color, #43a047); }
          .dot.error { background: var(--error-color, #db4437); }
          .status {
            color: var(--secondary-text-color);
            font-size: 0.9em;
            flex: 0 0 auto;
            /* margin-top: auto pushes this element (and the audio-lock/
               now-playing elements after it) as far down the flex-column
               card as there's genuinely leftover space for - like the
               height: 100% rule on ha-card above, this only has any visible
               effect once the card has real extra height beyond its content
               (a fixed row count bigger than needed); on the default
               fit-to-content sizing there's no leftover space to push into,
               so it's a no-op there and the layout looks the same as
               before. */
            margin-top: auto;
          }
          .title { font-weight: 500; }
          .now-playing { color: var(--secondary-text-color); font-size: 0.9em; margin-bottom: 8px; min-height: 1.2em; flex: 0 0 auto; }
          .logo-wrap {
            /* Pinned to the card's right edge at a fixed size, vertically
               centered - width/height/right are all set inline per-instance
               by _applyLogoLayout() (called immediately after this markup
               is built) from the logo_width/logo_height/logo_right_offset
               config, falling back to the *_DEFAULT constants above - the
               plain values below are just a placeholder before that first
               call. This size no longer has anything to do with the card's
               own size at all. */
            position: absolute;
            top: 50%;
            right: 16px;
            transform: translateY(-50%);
            width: 110px;
            height: 110px;
            /* Decorative - never intercept a tap/click meant for the card
               itself (e.g. a tap_action on the card wrapper). */
            pointer-events: none;
          }
          .logo-wrap.hide-logo {
            display: none;
          }
          .logo {
            /* The wrap above already has the real fixed pixel size, so the
               image just fills it - object-fit: contain keeps it from
               distorting if width/height are ever set to different values. */
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            /* transform (not width/height) is what's animated, so the bounce
               stays smooth (GPU-composited) instead of re-laying-out the card. */
            transition: transform 0.15s ease-out;
          }
          .logo.playing { animation: pbs-bounce 0.7s ease-in-out infinite; }
          @keyframes pbs-bounce {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-5px) scale(1.05); }
          }
          /* The audio element is playback-only here - no scrubber/controls bar.
             Hiding it doesn't affect playback; HTMLMediaElement works the same
             whether or not it's rendered. */
          audio { display: none; }
          .audio-lock {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            background: var(--warning-color, #ffa600); color: #000;
            border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; font-size: 0.9em;
            flex: 0 0 auto;
          }
          .audio-lock[hidden] { display: none; }
          .audio-lock button {
            border: none; border-radius: 6px; padding: 6px 12px; font-weight: 600;
            background: #000; color: #fff; cursor: pointer; flex-shrink: 0;
          }
        </style>
        <ha-card>
          <div class="content">
            <div class="row">
              <span class="dot" id="dot"></span>
              <span class="title" id="title"></span>
            </div>
            <div class="status" id="status">Select an entity in the card editor</div>
            <div class="audio-lock" id="audio-lock" hidden>
              <span>🔇 Browser blocked audio - tap to enable</span>
              <button id="unlock-btn">Enable</button>
            </div>
            <div class="now-playing" id="now-playing"></div>
            <audio id="audio"></audio>
          </div>
          <div class="logo-wrap">
            <img class="logo" id="logo" src="${LOGO_URL}" alt="" />
          </div>
        </ha-card>
      `;
      this._audio = shadow.getElementById("audio");
      this._logo = shadow.getElementById("logo");
      this._card = shadow.querySelector("ha-card");
      this._content = shadow.querySelector(".content");
      this._logoWrap = shadow.querySelector(".logo-wrap");
      this._row = shadow.querySelector(".row");
      this._statusEl = shadow.getElementById("status");
      this._setupLogoSizeObserver();
      // Announcements play on their own audio channel (not in the DOM - a
      // plain Audio() object plays fine detached) so they never touch the
      // main track's src/position, and they're always audible regardless
      // of the main track's own volume/mute.
      this._announceAudio = new Audio();
      this._audio.addEventListener("play", () => {
        this._reportState({ state: "playing" });
        this._setPlayingVisual(true);
      });
      this._audio.addEventListener("pause", () => {
        if (!this._audio.ended) this._reportState({ state: "paused" });
        this._setPlayingVisual(false);
      });
      this._audio.addEventListener("ended", () => {
        this._reportState({ state: "idle" });
        this._setPlayingVisual(false);
      });
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
      // The announcement channel deliberately never touches the entity's
      // main reported `state` (announcements are a brief duck-and-resume,
      // not the entity's own playback state - see async_play_media's
      // comment on the backend side) - that's still true. But a consumer
      // that specifically needs to know "is a TTS/announcement actually
      // playing right now" (e.g. a card timing chunked TTS playback one
      // message at a time) had no real signal to read at all: the main
      // `state` never reflects an announcement, so polling it is blind to
      // whether one is even happening. `is_announcing` is a separate,
      // additive field sent alongside (never replacing) `state`, exposed
      // by the entity as its own extra_state_attribute - it doesn't change
      // what `state` means for anything else watching this entity.
      this._announceAudio.addEventListener("play", () => {
        this._isAnnouncing = true;
        this._setPlayingVisual(true);
        this._renderStatus();
        this._reportState({ is_announcing: true });
      });
      this._announceAudio.addEventListener("pause", () => {
        this._isAnnouncing = false;
        this._setPlayingVisual(false);
        this._renderStatus();
        this._reportState({ is_announcing: false });
      });
      this._announceAudio.addEventListener("ended", () => {
        this._isAnnouncing = false;
        this._setPlayingVisual(false);
        this._renderStatus();
        this._reportState({ is_announcing: false });
      });
      shadow.getElementById("unlock-btn").addEventListener("click", () => this._unlockAudio());
    }

    // Watches the card's real rendered width (not a CSS container query -
    // see the design-reset comment near LOGO_HIDE_WIDTH_DEFAULT at the top
    // of the file for why) and hides the logo entirely below that width.
    // Set up once, right after the shadow DOM is built - the same <ha-card>
    // element persists across Sections reparenting the card
    // (connectedCallback/disconnectedCallback fire again, but the element
    // itself isn't recreated), so the observer doesn't need to be
    // re-attached each time the card reconnects.
    _setupLogoSizeObserver() {
      if (typeof ResizeObserver === "undefined" || !this._card) return;
      this._logoSizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          this._applyLogoVisibility(entry.contentRect.width);
          this._applyStatusVisibility(entry.contentRect.width);
        }
      });
      this._logoSizeObserver.observe(this._card);
    }

    // Sets the logo's fixed pixel size/offset from config - independent of
    // the card's own size, unlike every earlier percentage/container-query/
    // multi-band attempt at this (see the top-of-file comment).
    _applyLogoLayout() {
      if (!this._logoWrap) return;
      this._logoWrap.style.width = `${this._logoWidth}px`;
      this._logoWrap.style.height = `${this._logoHeight}px`;
      this._logoWrap.style.right = `${this._logoRightOffset}px`;
    }

    _applyLogoVisibility(width) {
      if (!this._logoWrap || !this._content) return;
      const hideWidth = this._logoHideWidth || LOGO_HIDE_WIDTH_DEFAULT;
      const hideLogo = width < hideWidth;
      this._logoWrap.classList.toggle("hide-logo", hideLogo);
      // Reserve room on the content side for the logo only while it's
      // actually shown, so the name/status text never runs underneath it -
      // and give the text the card's full width back once the logo is
      // hidden ("anything small should just be the text").
      const logoWidth = this._logoWidth || LOGO_WIDTH_DEFAULT;
      const logoRightOffset = this._logoRightOffset || LOGO_RIGHT_OFFSET_DEFAULT;
      this._content.style.paddingRight = hideLogo ? "0px" : `${logoWidth + logoRightOffset + 12}px`;
    }

    // Hides the status text entirely below a configurable card width -
    // status_hide_width, off (0/unset) by default. Same shape as
    // _applyLogoVisibility above, just simpler (no reserved-space/padding
    // side effect to also manage, since hiding the status text doesn't
    // need to give its space back to anything else the way the logo does).
    _applyStatusVisibility(width) {
      if (!this._statusEl) return;
      const hideWidth = this._statusHideWidth || STATUS_HIDE_WIDTH_DEFAULT;
      const hide = hideWidth > 0 && width < hideWidth;
      this._statusEl.classList.toggle("hide-status", hide);
    }

    // Pins a segment (the device-name row, or the status text) to a fixed
    // corner + pixel offset, or clears that and lets it sit back in the
    // card's normal top-to-bottom flow when anchor is empty/falsy. Same
    // pattern as _applyLogoLayout, generalized to any element.
    _applySegmentPosition(el, anchor, offsetX, offsetY) {
      if (!el) return;
      const positioned = !!anchor && anchor !== "none";
      el.classList.toggle("positioned", positioned);
      el.style.top = "";
      el.style.right = "";
      el.style.bottom = "";
      el.style.left = "";
      if (!positioned) return;
      const [vSide, hSide] = anchor.split("-");
      el.style[vSide] = `${offsetY}px`;
      el.style[hSide] = `${offsetX}px`;
    }

    // Bounces the logo while either audio channel is actually playing. Checked
    // against both elements (rather than trusting only the event that just
    // fired) so a pause on one channel doesn't stop the bounce while the
    // other is still genuinely playing - e.g. the instant an announcement
    // starts, right as it pauses the main track for duck-and-resume.
    _setPlayingVisual(isPlaying) {
      if (!this._logo) return;
      const stillPlaying =
        isPlaying ||
        (this._audio && !this._audio.paused && !this._audio.ended) ||
        (this._announceAudio && !this._announceAudio.paused && !this._announceAudio.ended);
      this._logo.classList.toggle("playing", !!stillPlaying);
    }

    // Browsers block a script-triggered play() (no click/tap behind it -
    // exactly what every command arriving over the websocket is) until the
    // user has directly interacted with the page at least once. A kiosk/
    // wall-mounted dashboard that nobody has tapped since it loaded hits
    // this on the very first command. Attempt playback normally; if the
    // browser refuses it specifically for that reason, surface a one-time
    // "tap to enable" prompt and remember how to retry the exact same
    // playback once the user taps it, rather than just failing silently.
    _attemptPlay(audioEl) {
      return audioEl.play().catch((err) => {
        if (err && err.name === "NotAllowedError") {
          this._pendingRetry = () => this._attemptPlay(audioEl);
          this._setAudioLocked(true);
        } else {
          // eslint-disable-next-line no-console
          console.error("Piper Browser Speaker: playback failed", err);
        }
      });
    }

    _setAudioLocked(locked) {
      if (!this.shadowRoot) return;
      this.shadowRoot.getElementById("audio-lock").hidden = !locked;
    }

    _unlockAudio() {
      // This runs inside a real click handler, so play()-then-immediately-
      // pause() on both audio elements here counts as the user gesture
      // browsers require - Chrome remembers it for the rest of this page's
      // lifetime (any element, any future command); Safari/WebKit only
      // unlocks the specific element played, which is exactly why both are
      // primed here rather than just one.
      [this._audio, this._announceAudio].forEach((el) => {
        el.play()
          .then(() => el.pause())
          .catch(() => {});
      });
      this._setAudioLocked(false);
      if (this._pendingRetry) {
        const retry = this._pendingRetry;
        this._pendingRetry = null;
        retry();
      }
    }

    _setStatus(kind) {
      if (!this.shadowRoot) return;
      const dot = this.shadowRoot.getElementById("dot");
      dot.classList.toggle("connected", kind === "connected");
      dot.classList.toggle("error", kind === "error");
      this._connectionKind = kind;
      this._renderStatus();
    }

    // Rebuilds the status line's text from the two independent bits of
    // state that feed it: the connection kind (set by _setStatus, e.g.
    // "connected"/"error") and, while connected, the last-known playback
    // state (set by _reportState, e.g. "idle"/"playing"/"paused") - so the
    // status reads "Connected (Playing)" instead of a bare "Connected" that
    // doesn't say whether anything is actually happening.
    _renderStatus() {
      if (!this.shadowRoot) return;
      const status = this.shadowRoot.getElementById("status");
      if (!status) return;
      const kind = this._connectionKind || "disconnected";
      if (kind === "connected") {
        // An in-progress announcement takes priority over the main track's
        // last-known state - the main track is likely paused for the
        // duck-and-resume right now, so showing "Announcing" is more
        // accurate than "Paused" until the announcement finishes.
        const playbackLabel = this._isAnnouncing
          ? PLAYBACK_LABELS.announcing
          : PLAYBACK_LABELS[this._playbackState] || PLAYBACK_LABELS.idle;
        status.textContent = `Connected (${playbackLabel})`;
        return;
      }
      const labels = {
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

      // Builds the three collapsible "Logo" / "Device name row" / "Status
      // text" position sections the first time only - see _makeSection,
      // _makeNumberField, _makeSelectField below. Every field created here
      // is pushed onto this._fields so _syncFieldValues() (called
      // unconditionally below, EVERY render, not just this first one) can
      // re-stamp each field's displayed value from the actual saved config.
      //
      // That unconditional re-sync is the fix for "the editor boxes don't
      // keep user inputted data": these fields used to only have their
      // `.value = ...` line set once, right here inside this creation
      // guard, so re-opening the editor (a fresh _render() call on the same
      // element, config already populated) never updated what the inputs
      // displayed - they kept showing empty/placeholder even though the
      // YAML view proved the real values were saved correctly all along.
      // The entity picker above never had this bug because its own
      // `this._picker.value = ...` line already sits outside any such
      // guard; every field below now follows that same pattern.
      if (!this._sectionsWrap) {
        this._fields = [];
        this._sectionsWrap = document.createElement("div");
        this.shadowRoot.querySelector(".wrap").appendChild(this._sectionsWrap);

        const logoFieldsWrap = document.createElement("div");
        logoFieldsWrap.style.cssText = "display:flex; gap:12px; flex-wrap:wrap;";
        logoFieldsWrap.appendChild(
          this._makeNumberField("Hide logo below card width (px)", "logo_hide_width", LOGO_HIDE_WIDTH_DEFAULT).label
        );
        logoFieldsWrap.appendChild(
          this._makeNumberField("Logo width (px)", "logo_width", LOGO_WIDTH_DEFAULT).label
        );
        logoFieldsWrap.appendChild(
          this._makeNumberField("Logo height (px)", "logo_height", LOGO_HEIGHT_DEFAULT).label
        );
        logoFieldsWrap.appendChild(
          this._makeNumberField("Logo distance from right edge (px)", "logo_right_offset", LOGO_RIGHT_OFFSET_DEFAULT)
            .label
        );
        this._sectionsWrap.appendChild(this._makeSection("Logo position & size", logoFieldsWrap));

        this._sectionsWrap.appendChild(
          this._makeSection(
            "Device name row position",
            this._makeSegmentPositionFields("row", ROW_OFFSET_X_DEFAULT, ROW_OFFSET_Y_DEFAULT)
          )
        );
        this._sectionsWrap.appendChild(
          this._makeSection(
            "Status text position",
            this._makeSegmentPositionFields(
              "status",
              STATUS_OFFSET_X_DEFAULT,
              STATUS_OFFSET_Y_DEFAULT,
              STATUS_HIDE_WIDTH_DEFAULT
            )
          )
        );
      }

      // Small-print version footer, bottom center of the editor GUI only
      // (never shown on the card itself) - static text, created once like
      // _sectionsWrap above, not part of _syncFieldValues() since it isn't a
      // config-backed field.
      if (!this._versionFooter) {
        this._versionFooter = document.createElement("div");
        this._versionFooter.style.cssText =
          "text-align:center; font-size:0.7em; color: var(--secondary-text-color); opacity:0.6; margin-top:12px;";
        this._versionFooter.textContent = `v${CARD_VERSION}`;
        this.shadowRoot.querySelector(".wrap").appendChild(this._versionFooter);
      }

      this._syncFieldValues();
    }

    // A labeled plain <input type="number"> (not a custom ha-* component -
    // avoids any lazy-custom-element-upgrade timing gotchas). Tracked in
    // this._fields so _syncFieldValues() can re-stamp its value every
    // render, not just at creation.
    _makeNumberField(labelText, key, defaultValue) {
      const label = document.createElement("label");
      label.style.cssText =
        "display:flex; flex-direction:column; gap:4px; font-size:0.85em; flex:1; min-width:170px; color: var(--secondary-text-color);";
      const span = document.createElement("span");
      span.textContent = labelText;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.placeholder = String(defaultValue);
      input.style.cssText =
        "padding:8px; border-radius:4px; border:1px solid var(--divider-color, #ccc); background: var(--card-background-color, transparent); color: inherit; font: inherit;";
      input.addEventListener("change", () => {
        const raw = input.value.trim();
        const next = { ...this._config };
        if (raw === "") {
          delete next[key];
        } else {
          next[key] = Number(raw);
        }
        this._config = next;
        this._fireChanged();
      });
      label.appendChild(span);
      label.appendChild(input);
      this._fields.push({ el: input, key, kind: "number" });
      return { label, input };
    }

    // A labeled <select> - same re-sync tracking as _makeNumberField.
    _makeSelectField(labelText, key, options) {
      const label = document.createElement("label");
      label.style.cssText =
        "display:flex; flex-direction:column; gap:4px; font-size:0.85em; flex:1; min-width:170px; color: var(--secondary-text-color);";
      const span = document.createElement("span");
      span.textContent = labelText;
      const select = document.createElement("select");
      select.style.cssText =
        "padding:8px; border-radius:4px; border:1px solid var(--divider-color, #ccc); background: var(--card-background-color, transparent); color: inherit; font: inherit;";
      options.forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        select.appendChild(optionEl);
      });
      select.addEventListener("change", () => {
        const next = { ...this._config };
        if (select.value === "") {
          delete next[key];
        } else {
          next[key] = select.value;
        }
        this._config = next;
        this._fireChanged();
      });
      label.appendChild(span);
      label.appendChild(select);
      this._fields.push({ el: select, key, kind: "select" });
      return { label, select };
    }

    // The anchor dropdown + x/y offset fields shared by the row and status
    // segments - `prefix` is "row" or "status", matching the card's own
    // row_anchor/row_offset_x/row_offset_y (and status_* equivalents) config
    // keys read in _updateFromConfig(). `hideWidthDefault`, when given,
    // additionally adds a "hide below this card width" field (currently
    // only used for the status segment) - key `${prefix}_hide_width`.
    _makeSegmentPositionFields(prefix, offsetXDefault, offsetYDefault, hideWidthDefault) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex; gap:12px; flex-wrap:wrap;";
      wrap.appendChild(
        this._makeSelectField("Position", `${prefix}_anchor`, SEGMENT_ANCHOR_OPTIONS).label
      );
      wrap.appendChild(
        this._makeNumberField("Offset from edge, horizontal (px)", `${prefix}_offset_x`, offsetXDefault).label
      );
      wrap.appendChild(
        this._makeNumberField("Offset from edge, vertical (px)", `${prefix}_offset_y`, offsetYDefault).label
      );
      if (hideWidthDefault != null) {
        wrap.appendChild(
          this._makeNumberField(
            "Hide below card width (px, 0 = never hide)",
            `${prefix}_hide_width`,
            hideWidthDefault
          ).label
        );
      }
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:0.8em; color: var(--secondary-text-color); margin-top:4px; width:100%;";
      hint.textContent =
        'Leave "Use default" to use the card\'s built-in default position, or pick "Normal layout" to go back to the plain top-to-bottom card layout.';
      wrap.appendChild(hint);
      return wrap;
    }

    // A collapsible group - collapsed by default so the editor doesn't open
    // with every position/size field already expanded. The uid/collapsed
    // state lives only on this editor element instance (this._expandedSections,
    // a Set of section titles) and is never written to the card config -
    // toggling it just flips this one section's own display and chevron,
    // it never calls _fireChanged().
    _makeSection(titleText, contentEl) {
      this._expandedSections = this._expandedSections || new Set();
      const section = document.createElement("div");
      section.style.cssText =
        "border:1px solid var(--divider-color, #ccc); border-radius:8px; margin-top:12px; overflow:hidden;";
      const header = document.createElement("button");
      header.type = "button";
      const expanded = this._expandedSections.has(titleText);
      header.textContent = `${expanded ? "▾" : "▸"} ${titleText}`;
      header.style.cssText =
        "display:block; width:100%; text-align:left; padding:10px 12px; border:none; background: var(--card-background-color, transparent); color: inherit; font: inherit; font-weight:500; cursor:pointer;";
      contentEl.style.padding = "0 12px 12px 12px";
      contentEl.style.display = expanded ? "block" : "none";
      header.addEventListener("click", () => {
        const nowExpanded = contentEl.style.display !== "none";
        contentEl.style.display = nowExpanded ? "none" : "block";
        header.textContent = `${nowExpanded ? "▸" : "▾"} ${titleText}`;
        if (nowExpanded) {
          this._expandedSections.delete(titleText);
        } else {
          this._expandedSections.add(titleText);
        }
      });
      section.appendChild(header);
      section.appendChild(contentEl);
      return section;
    }

    // Re-stamps every tracked field's displayed value from this._config -
    // called on every _render(), so reopening the editor (or any
    // config-changed round-trip re-rendering this same element) always
    // shows what's actually saved, not stale placeholders (the .16.8 fix).
    //
    // 2026.09.16.11: `hass` gets reassigned on this editor on EVERY entity
    // state change anywhere in the system (not just ones relevant to this
    // card), and the `hass` setter below calls `_render()` every time - so
    // on a live HA instance this can fire many times a second. Overwriting
    // every field's `.value` unconditionally each time meant a field you
    // were actively typing into got reset back to its last COMMITTED value
    // (the `change` event, which actually updates `this._config`, only
    // fires on blur/Enter - not per keystroke) before you could finish
    // typing, which is what made a number field seem to randomly reset or
    // "eat" digits mid-edit. Skip re-stamping whichever field currently has
    // focus in this editor's own shadow root - every other field still
    // stays in sync, and the focused one catches up the moment it's
    // committed and this method next runs.
    _syncFieldValues() {
      if (!this._fields) return;
      const focused = this.shadowRoot && this.shadowRoot.activeElement;
      this._fields.forEach(({ el, key }) => {
        if (el === focused) return;
        el.value = this._config[key] != null ? this._config[key] : "";
      });
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
