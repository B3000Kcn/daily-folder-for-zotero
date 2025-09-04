"use strict";

/**
 * Daily Folder - Zotero bootstrap extension entry
 * - Injects a top toolbar button
 * - Displays a lightweight calendar popup
 * - Stubs for collection operations (to be implemented next)
 */

/* globals ChromeUtils, Components, Zotero */

var Zotero;

var { Services } = ChromeUtils.import(
  "resource://gre/modules/Services.jsm"
);

// Declare a global-like variable. It will be initialized in startup().
var DailyFolder;


function log(msg, win) {
  try {
    if (win && win.Zotero && typeof win.Zotero.debug === "function") {
      win.Zotero.debug("[DailyFolder] " + msg);
      return;
    }
  } catch (_) {}
  try {
    Services.console.logStringMessage("[DailyFolder] " + msg);
  } catch (_) {}
}

function getPrefString(key, fallback) {
  try {
    return Services.prefs.getCharPref(DailyFolder.PREF_BRANCH + key);
  } catch (e) {
    return fallback;
  }
}

function setPrefString(key, value) {
  try {
    Services.prefs.setCharPref(DailyFolder.PREF_BRANCH + key, value);
  } catch (e) {
    log("Failed to set pref " + key + ": " + e);
  }
}

function formatDateYYYYMMDD(d) {
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// --- Bootstrap lifecycle ---

function install(data, reason) {
  // nothing special
}

function uninstall(data, reason) {
  // nothing special
}

function startup(data, reason) {
  // Initialize our global-like object. This ensures all functions,
  // even those in other scopes, can access it reliably.
  DailyFolder = {
    BUTTON_ID: "daily-folder-button",
    POPUP_ID: "daily-folder-popup",
    PREF_BRANCH: "extensions.daily-folder.",
    DEFAULT_ROOT_COLLECTION_NAME: "Daily Folder",
    XUL_NS: "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    
    gWinState: new WeakMap(),
    gAddon: {
      id: data.id,
      version: data.version,
      rootURI: data.rootURI
    },
    WindowListener: null
  };
  
  DailyFolder.WindowListener = {
    onOpenWindow: function (aXULWindow) {
      let aDOMWindow = aXULWindow.docShell.domWindow;
      aDOMWindow.addEventListener( "load", function () {
          if (aDOMWindow.document.documentElement.getAttribute("windowtype") == "zotero:mainWindow") {
            onMainWindowLoad(aDOMWindow);
          }
        }, { once: true }
      );
    },
    onCloseWindow: function (_aXULWindow) {},
    onWindowTitleChange: function (_aXULWindow, _aNewTitle) {},
  };

  // Attach to existing Zotero windows
  const enumerator = Services.wm.getEnumerator(null);
  while (enumerator.hasMoreElements()) {
    const win = enumerator.getNext();
    tryAttachToWindowWhenReady(win);
  }

  // Listen for future window openings
  Services.wm.addListener(DailyFolder.WindowListener);
}

function shutdown(data, reason) {
  // If startup failed, DailyFolder might not exist
  if (!DailyFolder) {
    return;
  }
  // Remove window listener
  try {
    Services.wm.removeListener(DailyFolder.WindowListener);
  } catch (_) {}

  // Attempt to unregister preference pane
  try {
    const most = Services.wm.getMostRecentWindow(null);
    if (most && most.Zotero && most.Zotero.PreferencePanes && typeof most.Zotero.PreferencePanes.unregister === "function") {
      most.Zotero.PreferencePanes.unregister("daily-folder-pref");
    }
  } catch (_) {}

  // Cleanup from all windows
  const enumerator = Services.wm.getEnumerator(null);
  while (enumerator.hasMoreElements()) {
    const win = enumerator.getNext();
    try {
      onMainWindowUnload(win);
    } catch (_) {}
  }

  DailyFolder = null;
}

// --- Window Listener ---

function onMainWindowLoad(aDOMWindow) {
  DailyFolder.gWinState.set(aDOMWindow, {
    cleanupFns: [],       // For window unload
    popupCleanupFns: [],  // For popup close
    buttonEl: null,
    popupEl: null,
  });
  insertToolbarButton(aDOMWindow);
  registerPreferencePane(aDOMWindow);
}

function tryAttachToWindowWhenReady(win) {
  try {
    if (!win || !win.document) return;
    // Heuristic: Zotero main window exposes global Zotero object
    if (win.Zotero) {
      // If document is still loading, wait for it to be interactive/complete
      if (win.document.readyState === "complete" || win.document.readyState === "interactive") {
        onMainWindowLoad(win);
      } else {
        const onReady = () => {
          win.document.removeEventListener("readystatechange", onReady);
          onMainWindowLoad(win);
        };
        win.document.addEventListener("readystatechange", onReady);
      }
    }
  } catch (e) {
    log("tryAttachToWindowWhenReady error: " + e);
  }
}

// --- Main Window Integration ---


function onMainWindowUnload(win) {
  try {
    const state = DailyFolder.gWinState.get(win);
    if (state) {
      // Run cleanup fns
      (state.cleanupFns || []).forEach((fn) => {
        try {
          fn();
        } catch (_) {}
      });
      // Remove popup
      if (state.popupEl && state.popupEl.parentNode) {
        state.popupEl.parentNode.removeChild(state.popupEl);
      }
      // Remove button
      if (state.buttonEl && state.buttonEl.parentNode) {
        state.buttonEl.parentNode.removeChild(state.buttonEl);
      }
    }

    // A final attempt to remove stray nodes
    const doc = win.document;
    const btn = doc.getElementById(DailyFolder.BUTTON_ID);
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    const popup = doc.getElementById(DailyFolder.POPUP_ID);
    if (popup && popup.parentNode) popup.parentNode.removeChild(popup);

    DailyFolder.gWinState.delete(win);
  } catch (e) {
    log("onMainWindowUnload error: " + e, win);
  }
}

function findToolbar(doc) {
  const selectors = [
    "#zotero-toolbar",
    "toolbar#zotero-toolbar",
    "div#zotero-toolbar",
    "#zotero-items-toolbar",
    "toolbar#zotero-items-toolbar",
    "#items-toolbar",
    "#main-toolbar",
    ".zotero-items-toolbar",
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function insertToolbarButton(win) {
  const doc = win.document;
  if (doc.getElementById(DailyFolder.BUTTON_ID)) return;

  const toolbar = findToolbar(doc);
  if (!toolbar) {
    log("Toolbar not found - button injection skipped", win);
    return;
  }

  const state = DailyFolder.gWinState.get(win);

  const label = "Daily Folder";
  const tooltip = "Open daily folder calendar";
  const svgIcon = getSVGIconDataURL();

  let button;
  if (toolbar.namespaceURI === DailyFolder.XUL_NS || toolbar.localName === "toolbar") {
    // XUL toolbarbutton
    button = doc.createElementNS(DailyFolder.XUL_NS, "toolbarbutton");
    button.setAttribute("id", DailyFolder.BUTTON_ID);
    button.setAttribute("tooltiptext", tooltip);
    button.setAttribute("type", "button");
    if (svgIcon) {
      button.setAttribute("image", svgIcon);
    }
  } else {
    // HTML button
    button = doc.createElement("button");
    button.setAttribute("id", DailyFolder.BUTTON_ID);
    button.setAttribute("title", tooltip);
    // minimal styling to blend in
    button.style.height = "24px";
    button.style.padding = "0";
    button.style.border = "1px solid var(--zotero-border-color, #ccc)";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    if (svgIcon) {
      button.style.background = "var(--zotero-toolbar-bg, #f5f5f5) url(" + svgIcon + ") no-repeat center";
      button.style.width = "24px"; // Match height
    }
  }

  button.addEventListener("click", () => togglePopup(win, button));
  toolbar.appendChild(button);

  state.buttonEl = button;

  // Cleanup when window unloads
  const onUnload = () => onMainWindowUnload(win);
  win.addEventListener("unload", onUnload, { once: true });
  state.cleanupFns.push(() => {
    try {
      win.removeEventListener("unload", onUnload);
    } catch (_) {}
  });

  log("Toolbar button inserted", win);
}

// --- Popup and Calendar ---

function togglePopup(win, anchorEl) {
  const doc = win.document;
  const state = DailyFolder.gWinState.get(win);

  // If a popup is already open, close it and do nothing else.
  if (state.popupEl && state.popupEl.isConnected) {
    closePopup(win);
    return;
  }

  // Clear any stale cleanup functions before creating a new popup.
  state.popupCleanupFns = [];

  const popup = buildPopup(win);
  state.popupEl = popup;
  doc.documentElement.appendChild(popup);

  positionPopupNearAnchor(win, popup, anchorEl);

  // Outside click and ESC to close
  const onDocMouseDown = (ev) => {
    if (!popup.contains(ev.target) && ev.target !== anchorEl) {
      closePopup(win);
    }
  };
  const onKeyDown = (ev) => {
    if (ev.key === "Escape") {
      closePopup(win);
    }
  };
  doc.addEventListener("mousedown", onDocMouseDown, true);
  doc.addEventListener("keydown", onKeyDown, true);

  const onResize = () => positionPopupNearAnchor(win, popup, anchorEl);
  win.addEventListener("resize", onResize);

  const onScroll = () => positionPopupNearAnchor(win, popup, anchorEl);
  win.addEventListener("scroll", onScroll, true);

  // Store cleanup functions specific to this popup instance.
  // These will be called by closePopup().
  state.popupCleanupFns.push(() => {
    try { doc.removeEventListener("mousedown", onDocMouseDown, true); } catch (_) {}
  });
  state.popupCleanupFns.push(() => {
    try { doc.removeEventListener("keydown", onKeyDown, true); } catch (_) {}
  });
  state.popupCleanupFns.push(() => {
    try { win.removeEventListener("resize", onResize); } catch (_) {}
  });
  state.popupCleanupFns.push(() => {
    try { win.removeEventListener("scroll", onScroll, true); } catch (_) {}
  });
}

function closePopup(win) {
  const state = DailyFolder.gWinState.get(win);
  if (!state) return;

  // Remove the popup DOM element
  if (state.popupEl && state.popupEl.parentNode) {
    state.popupEl.parentNode.removeChild(state.popupEl);
    state.popupEl = null;
  }

  // Execute and clear all event listener cleanup functions for the closed popup
  if (state.popupCleanupFns) {
    state.popupCleanupFns.forEach(fn => {
      try { fn(); } catch(e) { log("Error in popup cleanup: " + e, win); }
    });
    state.popupCleanupFns = [];
  }
}

function buildPopup(win) {
  const doc = win.document;
  const popup = doc.createElement("div");
  popup.id = DailyFolder.POPUP_ID;
  popup.style.position = "fixed";
  popup.style.width = "300px";
  popup.style.background = "white";
  popup.style.border = "1px solid rgba(0,0,0,0.15)";
  popup.style.borderRadius = "8px";
  popup.style.boxShadow = "0 10px 30px rgba(0,0,0,0.15)";
  popup.style.zIndex = "999999";
  popup.style.userSelect = "none";
  popup.style.font = "13px/1.4 system-ui, Arial, sans-serif";
  popup.style.color = "#222";

  // Header
  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.padding = "8px 10px";
  header.style.borderBottom = "1px solid #eee";
  header.style.background = "#fafafa";
  const prev = doc.createElement("button");
  prev.textContent = "◀";
  styleGhostButton(prev);
  const next = doc.createElement("button");
  next.textContent = "▶";
  styleGhostButton(next);
  const title = doc.createElement("button"); // Changed to button for clickability
  // Custom styling for a less wide, text-like button with hover effect
  title.style.padding = "4px 8px";
  title.style.border = "1px solid transparent";
  title.style.borderRadius = "4px";
  title.style.background = "transparent";
  title.style.cursor = "pointer";
  title.style.fontWeight = "600";
  title.style.color = "inherit";
  title.onmouseenter = () => (title.style.background = "#f0f0f0");
  title.onmouseleave = () => (title.style.background = "transparent");
  
  header.appendChild(prev);
  header.appendChild(title);
  header.appendChild(next);

  // --- Views Container ---
  const viewsContainer = doc.createElement("div");

  // Calendar (days) grid
  const grid = doc.createElement("div");
  grid.style.display = "grid"; // 'grid' or 'none'
  grid.style.gridTemplateColumns = "repeat(7, 1fr)";
  grid.style.gap = "4px";
  grid.style.padding = "8px 10px 10px";

  // Year selection grid
  const yearsView = doc.createElement("div");
  yearsView.style.display = "none"; // 'grid' or 'none'
  yearsView.style.gridTemplateColumns = "repeat(4, 1fr)";
  yearsView.style.gap = "4px";
  yearsView.style.padding = "8px 10px 10px";
  
  viewsContainer.appendChild(grid);
  viewsContainer.appendChild(yearsView);

  // Footer
  const footer = doc.createElement("div");
  footer.style.padding = "8px 10px 10px";
  const todayBtn = doc.createElement("button");
  todayBtn.textContent = "Today’s Folder";
  todayBtn.style.display = "flex";
  todayBtn.style.alignItems = "center";
  todayBtn.style.justifyContent = "center";
  todayBtn.style.width = "100%";
  todayBtn.style.padding = "8px 10px";
  todayBtn.style.background = "#1a73e8";
  todayBtn.style.color = "white";
  todayBtn.style.border = "1px solid #1669c1";
  todayBtn.style.borderRadius = "6px";
  todayBtn.style.cursor = "pointer";
  todayBtn.onmouseenter = () => (todayBtn.style.background = "#1669c1");
  todayBtn.onmouseleave = () => (todayBtn.style.background = "#1a73e8");
  footer.appendChild(todayBtn);

  popup.appendChild(header);
  popup.appendChild(viewsContainer);
  popup.appendChild(footer);

  // State
  let current = new Date();
  current.setDate(1);
  let currentView = "days"; // 'days' or 'years'

  // Cache of existing date collections names under root
  const existingSet = new Set();
  async function refreshExisting() {
    try {
      const Z = win.Zotero;
      const rootName = getPrefString("rootCollectionName", DailyFolder.DEFAULT_ROOT_COLLECTION_NAME);
      let libraryID = Z.Libraries.userLibraryID;
      if (win.ZoteroPane && typeof win.ZoteroPane.getSelectedLibraryID === "function") {
        libraryID = win.ZoteroPane.getSelectedLibraryID() || libraryID;
      }
      
      const root = await ensureCollection(win, rootName, null, libraryID);
      if (!root) {
        existingSet.clear();
        return;
      }

      existingSet.clear();
      const yearColls = await root.getChildCollections();
      for (const yearColl of yearColls) {
        const monthColls = await yearColl.getChildCollections();
        for (const monthColl of monthColls) {
          const dayColls = await monthColl.getChildCollections();
          for (const dayColl of dayColls) {
            if (dayColl && dayColl.name && /^\d{4}-\d{2}-\d{2}$/.test(dayColl.name)) {
              existingSet.add(String(dayColl.name));
            }
          }
        }
      }
    } catch (e) {
      log("refreshExisting failed: " + e, win);
    }
  }
  
  function toggleView() {
    currentView = currentView === "days" ? "years" : "days";
    const isDaysView = currentView === "days";
    
    grid.style.display = isDaysView ? "grid" : "none";
    yearsView.style.display = isDaysView ? "none" : "grid";
    prev.style.display = isDaysView ? "inline-block" : "none";
    next.style.display = isDaysView ? "inline-block" : "none";
    
    if (currentView === "years") {
      renderYears();
    } else {
      render();
    }
  }

  function renderYears() {
    yearsView.textContent = "";
    const endYear = new Date().getFullYear();
    for (let year = 2024; year <= endYear; year++) {
      const yearBtn = doc.createElement("button");
      styleDayCell(yearBtn); // Reuse style
      yearBtn.textContent = year;
      if (year === current.getFullYear()) {
        yearBtn.style.borderColor = "#1a73e8";
        yearBtn.style.fontWeight = "bold";
      }
      yearBtn.addEventListener("click", () => {
        current.setFullYear(year);
        toggleView(); // Switch back to days view
      });
      yearsView.appendChild(yearBtn);
    }
  }

  function render() {
    // Ensure month arrows are visible when rendering day view
    prev.style.display = "inline-block";
    next.style.display = "inline-block";
    
    const y = current.getFullYear();
    const m = current.getMonth(); // 0-based
    const mm = String(m + 1).padStart(2, "0");
    title.textContent = y + "-" + mm;
  
    // Week header (Mon..Sun, English 3-letter)
    grid.textContent = "";
    const weekNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const n of weekNames) {
      const cell = doc.createElement("div");
      cell.textContent = n;
      cell.style.textAlign = "center";
      cell.style.fontWeight = "600";
      cell.style.color = "#555";
      cell.style.padding = "4px 0";
      grid.appendChild(cell);
    }

    // First day offset, Monday as first day
    const firstDay = new Date(y, m, 1);
    let offset = firstDay.getDay(); // 0=Sun..6=Sat
    offset = offset === 0 ? 6 : offset - 1; // shift to Mon=0..Sun=6

    // Empty cells
    for (let i = 0; i < offset; i++) {
      const empty = doc.createElement("div");
      empty.textContent = "";
      grid.appendChild(empty);
    }

    // Days
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = formatDateYYYYMMDD(new Date());
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = doc.createElement("button");
      styleDayCell(cell);
      cell.textContent = "" + d;

      const dateStr = formatDateYYYYMMDD(new Date(y, m, d));
      if (dateStr === todayStr) {
        cell.style.borderColor = "#1a73e8";
        cell.style.color = "#1a73e8";
        cell.style.fontWeight = "600";
      }

      // Mark if collection exists
      if (existingSet.has(dateStr)) {
        cell.style.background = "#e8f0fe";
        cell.style.borderColor = "#c6dafc";
        cell.style.color = "#1a73e8";
        cell.style.fontWeight = "bold";
        cell.title = "Collection exists";
      }

      cell.addEventListener("click", () => {
        // Only navigate if the date collection already exists; do NOT create on click.
        if (existingSet.has(dateStr)) {
          log(`Date cell clicked (attempt navigate): ${dateStr}`, win);
          gotoDateCollection(win, dateStr, { createIfMissing: false })
            .then(() => {
              try { closePopup(win); } catch (_) {}
            })
            .catch(e => log("Op failed: " + e, win));
        } else {
          // Do nothing when clicking dates without existing collections.
        }
      });

      grid.appendChild(cell);
    }
  }

  title.addEventListener("click", toggleView);

  prev.addEventListener("click", () => {
    current.setMonth(current.getMonth() - 1);
    render();
  });
  next.addEventListener("click", () => {
    current.setMonth(current.getMonth() + 1);
    render();
  });
  todayBtn.addEventListener("click", () => {
    const today = new Date();
    const dateStr = formatDateYYYYMMDD(today);
    gotoDateCollection(win, dateStr, { createIfMissing: true })
      .then(() => closePopup(win))
      .catch(e => log("Op failed: " + e, win));
  });

  render();
  refreshExisting().then(render);
  return popup;
}

function styleGhostButton(btn) {
  btn.style.padding = "4px 8px";
  btn.style.border = "1px solid #ddd";
  btn.style.borderRadius = "4px";
  btn.style.background = "white";
  btn.style.cursor = "pointer";
  btn.onmouseenter = () => (btn.style.background = "#f3f3f3");
  btn.onmouseleave = () => (btn.style.background = "white");
}

function styleDayCell(btn) {
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.padding = "6px 0";
  btn.style.border = "1px solid #eee";
  btn.style.borderRadius = "6px";
  btn.style.background = "white";
  btn.style.cursor = "pointer";
  btn.style.color = "#555";
  btn.onmouseenter = () => (btn.style.background = "#f6faff");
  btn.onmouseleave = () => (btn.style.background = "white");
}

function positionPopupNearAnchor(win, popup, anchorEl) {
  const doc = win.document;
  const anchorRect = anchorEl.getBoundingClientRect();

  const viewportW = win.innerWidth;
  const viewportH = win.innerHeight;

  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;

  const popupW = 300;
  const popupH = 330; // approx
  if (left + popupW > viewportW - 8) left = viewportW - popupW - 8;
  if (top + popupH > viewportH - 8) top = Math.max(8, anchorRect.top - popupH - 6);

  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

function registerPreferencePane(win) {
  try {
    const Z = win.Zotero;
    if (!Z || !Z.PreferencePanes || typeof Z.PreferencePanes.register !== "function") return;
    if (registerPreferencePane._done) return;
    
    Z.PreferencePanes.register({
      pluginID: DailyFolder.gAddon.id,
      id: "daily-folder-pref",
      label: "Daily Folder",
      src: "content/preferences.xhtml"
    });
    registerPreferencePane._done = true;
    log("Preference pane registered", win);
  } catch (e) {
    log("registerPreferencePane failed: " + e, win);
  }
}

// --- Collections ---

async function ensureCollection(win, name, parentID, libraryID) {
  const Z = win.Zotero;
  
  // Find existing
  try {
    let collections;
    if (parentID) {
      collections = Z.Collections.getByParent(parentID);
    } else {
      collections = Z.Collections.getByLibrary(libraryID);
    }
    const existing = collections.find(c => c.name === name);
    if (existing) {
      return existing;
    }
  } catch (e) {
    log(`Error finding collection ${name}: ${e}`, win);
  }
  
  // Create if missing
  try {
    let collection = new Z.Collection();
    collection.name = name;
    collection.libraryID = libraryID;
    collection.parentID = parentID;
    await collection.saveTx();
    log(`Created collection: ${name}`, win);
    return collection;
  } catch (e) {
    log(`Error creating collection ${name}: ${e}`, win);
    throw new Error(`无法创建 collection: ${name}`);
  }
}


async function findCollectionPath(win, dateStr, libraryID) {
  const Z = win.Zotero;
  const rootName = getPrefString("rootCollectionName", DailyFolder.DEFAULT_ROOT_COLLECTION_NAME);

  const rootCollections = Z.Collections.getByLibrary(libraryID).filter(c => !c.parentID && c.name === rootName);
  if (rootCollections.length === 0) return null;
  const rootColl = rootCollections[0];

  const [year, month, day] = dateStr.split('-');
  const monthStr = `${year}-${month}`;

  const yearColl = (await rootColl.getChildCollections()).find(c => String(c.name) === year);
  if (!yearColl) return null;

  const monthColl = (await yearColl.getChildCollections()).find(c => String(c.name) === monthStr);
  if (!monthColl) return null;

  const dayColl = (await monthColl.getChildCollections()).find(c => String(c.name) === dateStr);
  if (!dayColl) return null;

  return [rootColl, yearColl, monthColl, dayColl];
}

async function gotoDateCollection(win, dateStr, options = { createIfMissing: true }) {
  log(`gotoDateCollection called with ${dateStr}, createIfMissing=${!!options.createIfMissing}`, win);
  const Z = win.Zotero;

  try {
    const pane = Z.getActiveZoteroPane();
    if (!pane || !pane.collectionsView) {
      log("Error: ZoteroPane or collectionsView is not available.", win);
      return;
    }
    let libraryID = pane.getSelectedLibraryID() || Z.Libraries.userLibraryID;

    let collectionPath = await findCollectionPath(win, dateStr, libraryID);

    if (!collectionPath && options.createIfMissing) {
      log(`Path not found for ${dateStr}. Creating...`, win);
      const [year, month] = dateStr.split('-');
      const monthStr = `${year}-${month}`;
      const rootName = getPrefString("rootCollectionName", DailyFolder.DEFAULT_ROOT_COLLECTION_NAME);
      
      const rootColl = await ensureCollection(win, rootName, null, libraryID);
      const yearColl = await ensureCollection(win, year, rootColl.id, libraryID);
      const monthColl = await ensureCollection(win, monthStr, yearColl.id, libraryID);
      await ensureCollection(win, dateStr, monthColl.id, libraryID);
      
      collectionPath = await findCollectionPath(win, dateStr, libraryID);
    }

    if (!collectionPath) {
      log(`Collection path for ${dateStr} not found. Aborting.`, win);
      return;
    }
    
    const view = pane.collectionsView;
    const [rootColl, yearColl, monthColl, dayColl] = collectionPath;
    
    const findAndExpandByName = async (name, startIndex = 0) => {
      log(`Scanning for '${name}' from index ${startIndex}...`, win);
      for (let i = startIndex; i < view.rowCount; i++) {
        view.selection.select(i);
        const item = pane.getSelectedCollection();
        
        if (item && typeof item.name !== 'undefined' && item.name === name) {
          log(`Found '${name}' at index ${i}.`, win);
          if (view.isContainer(i) && !view.isContainerOpen(i)) {
            log(`Expanding '${name}'...`, win);
            view.toggleOpenState(i);
            await Z.Promise.delay(250);
          }
          return { found: true, index: i };
        }
      }
      log(`Failed to find '${name}'.`, win);
      return { found: false, index: -1 };
    };

    const rootResult = await findAndExpandByName(rootColl.name);
    if (rootResult.found) {
      const yearResult = await findAndExpandByName(yearColl.name, rootResult.index + 1);
      if (yearResult.found) {
        const monthResult = await findAndExpandByName(monthColl.name, yearResult.index + 1);
        if (monthResult.found) {
          log(`Scanning for final target '${dayColl.name}'...`, win);
          for (let i = monthResult.index + 1; i < view.rowCount; i++) {
            view.selection.select(i);
            const item = pane.getSelectedCollection();
            if (item && typeof item.name !== 'undefined' && item.name === dayColl.name) {
              log(`Success! '${dayColl.name}' selected.`, win);
              return dayColl;
            }
          }
        }
      }
    }
    
    log("Navigation failed.", win);

  } catch (e) {
    log(`FATAL: gotoDateCollection failed with error: ${e}`, win);
    if (e.stack) {
      log(e.stack, win);
    }
  }
}

// --- Icon ---

function getSVGIconDataURL() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />' +
    '<line x1="16" y1="2" x2="16" y2="6" />' +
    '<line x1="8" y1="2" x2="8" y2="6" />' +
    '<line x1="3" y1="10" x2="21" y2="10" />' +
    '<rect x="7" y="14" width="4" height="4" fill="#1a73e8" stroke="#1a73e8"/>' +
    "</svg>";
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// Export required bootstrap functions
this.install = install;
this.uninstall = uninstall;
this.startup = startup;
this.shutdown = shutdown;