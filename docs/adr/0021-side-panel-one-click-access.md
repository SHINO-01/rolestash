# ADR-0021: One-click access through a docked side panel and a pinned icon, not a widget on web pages

- **Status:** Superseded by ADR-0030 (floating widget, 2026-10-06)
- **Date:** 2026-10-02

## Context

When Rolestash isn't pinned, opening it takes two clicks (the extensions
menu, then Rolestash). The owner asked for a small floating button on the
right of the screen. There were three ways to provide one-click access:

1. **A widget drawn on web pages.** That needs a content script on those
   pages:
   - on every site, it means "Read and change all your data on all
     websites" at install, which AGENTS.md rule 3 forbids, and it breaks
     the promise that Rolestash reads a page only when you click;
   - on job sites only, as an opt-in, it means runtime host permissions for
     about 50 sites.
2. **Chrome's side panel** (`chrome.sidePanel`). It docks on the right of
   the browser and stays open across tabs. The `sidePanel` permission has
   no install warning and gives no access to pages. It was already on the
   Phase 1c list.
3. **Pinning the icon:** one click from any page, with no change at all.

## Decision

- **A side panel** (`src/entrypoints/sidepanel`,
  `src/features/sidepanel/side-panel.tsx`), opened from:
  - the popup's panel button;
  - right-clicking the icon → **Open side panel**;
  - for true one click, the board menu setting **Toolbar icon opens the
    side panel** (`settings.iconOpensPanel`, per device). It switches
    `sidePanel.setPanelBehavior` and clears the popup, and the background
    worker re-applies it at startup.
- **What the panel shows:**
  - **every plan:** **Save this page** and **Open board**;
  - **Advanced** (the side panel is an Advanced feature, ADR-0013): also
    autofill, Today, the board list and a job's details. These reuse the
    web board's phone-sized views (`src/web/today-view.tsx`,
    `board-view.tsx`, `job-sheet.tsx`). Other plans see what the panel
    adds.
- **Saving needs the user's click on the page.** The panel itself grants no
  page access. "Save this page" uses the `activeTab` grant from clicking
  the icon or pressing Alt+J on that page. Without it, the panel says
  exactly that. With "icon opens the side panel", clicking the icon both
  opens the panel and grants access.
- **A pin tip on the board** (`PinTip`) shows only while
  `action.getUserSettings().isOnToolbar` is false, and can be dismissed.

## Consequences

- **No page access is added.** The store listing's "reads a page only when
  you click" stays true. The only new permission is `sidePanel`.
- **One click to everything:** with the icon pinned and the panel setting
  on, a single click opens Rolestash beside any page.
- **No save for a tab you haven't clicked on:** the panel can't save a tab
  the user switched to without clicking the icon. Allowing it would need
  page access.
- **Shared views:** the web board's views are now shared by two surfaces,
  so changes to them must suit both.

## Alternatives considered

| Option                                  | Why not                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Floating button on every website        | "Read and change all your data on all websites" at install; against AGENTS.md rule 3   |
| Opt-in floating button on job sites     | Runtime access to about 50 sites for a button the panel and a pinned icon already give |
| Make the icon always open the board tab | Loses one-click capture from the popup; the panel keeps both                           |
