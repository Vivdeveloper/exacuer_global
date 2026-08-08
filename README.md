# Exacuer Global

The **customer-side** half of Exacuer's Frappe tooling: turn on the support chat, and the
Desk reporting pages. Install this on a customer's site.

**Publisher:** Vivek Choudhary · **License:** MIT · **Requires:** Frappe 15 or 16

---

## What is in here

| Thing | Purpose |
|---|---|
| **Exacuer Helpdesk Settings** (Single) | Enable the floating chat launcher on Desk, hold the pasted embed snippet, and **Test Chat** |
| `chat_boot.py` | `boot_session` hook — parses the key and origin out of the snippet into `frappe.boot` so the widget can load on Desk |
| Pages | Customer Insights, Supplier Insights, Item Rate History, Product Traceability |
| Workspace | **Exacuer Features** |

## Its relationship to `exacuer_support`

`exacuer_support` is the **helpdesk-side** app: it owns the `Exacuer Chat Widget` doctype,
the guest chat API (`exacuer_support.chat_widget.*`) and the widget script itself at
`/assets/exacuer_support/js/chat_embed.js`.

That asset path deliberately stays there — it is the URL inside every embed snippet already
pasted on a customer's site, and `/assets` is served by nginx, so a move could not be
redirected.

**This app is enough on a customer site.** `chat_desk.js` reads the key and origin out of
boot and pulls `chat_embed.js` from the helpdesk — the same way a customer *website* loads
it. Installing `exacuer_support` alongside is not required; where it is installed, it serves
its own local copy and `chat_desk.js` stands down so nothing loads twice.

Because the script is fetched from the helpdesk, its origin must be reachable from the
browser, and an `https` Desk cannot load an `http` snippet URL — mixed content is blocked.
**Test Chat** reports both.

Chat design, access rules and API: see `DESIGN.md` in `exacuer_support`.

## Installation

```bash
bench get-app <url-of-this-repo>
bench --site <site> install-app exacuer_global
bench --site <site> migrate
```

Install order matters when moving from an older `exacuer_support`: install this app
**before** migrating, so its module exists when the moved DocType and Pages are synced to it.

## License

MIT
