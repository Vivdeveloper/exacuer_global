"""Publish the chat key into frappe.boot so the widget can load on Desk.

Desk is a different injection surface from the website:

  * it does not read Website Settings -> <head> HTML, which is how the widget
    reaches website and portal pages
  * app_include_js renders a plain <script src="...">, so it cannot carry a
    data-chat-key attribute

So on Desk the key travels through boot instead, and chat_desk.js picks it up from
frappe.boot.exacuer_chat.

The snippet's origin is published alongside the key, and this matters: a customer
site's Desk is normally talking to a *different* site — the central helpdesk that
owns the HD Customer and the widget record. That origin is where chat_desk.js
fetches chat_embed.js from, which is also what makes a customer site self-
sufficient: the script does not have to be installed locally. chat_embed.js then
derives its API base from its own src, so the key goes back to the helpdesk that
issued it rather than to the local site, which would call it unknown.

Only the managed widget can load this way. A raw third-party snippet has no key
and is an inline <script> block, which app_include_js cannot express at all.
"""

import re
from urllib.parse import urlparse

import frappe

SETTINGS_DOCTYPE = "Exacuer Helpdesk Settings"

# Kept local rather than imported from the doctype controller so that boot never
# depends on that module being importable.
KEY_PATTERN = re.compile(r"""data-chat-key\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
SRC_PATTERN = re.compile(r"""<script[^>]*\ssrc\s*=\s*["']([^"']+)["']""", re.IGNORECASE)


def _api_origin(snippet):
	"""The origin the widget should call, from the snippet's script URL.

	Empty for a relative URL or anything that is not http(s) — the widget then
	falls back to its own origin, which is the right answer for a helpdesk that
	hosts its own Desk.
	"""
	match = SRC_PATTERN.search(snippet)
	if not match:
		return ""

	parsed = urlparse(match.group(1).strip())
	if parsed.scheme not in ("http", "https") or not parsed.netloc:
		return ""
	return f"{parsed.scheme}://{parsed.netloc}"


def get_desk_chat_config():
	"""{"key": ..., "origin": ...} when the widget should load on Desk, else {}."""
	if not frappe.db.exists("DocType", SETTINGS_DOCTYPE):
		return {}

	settings = frappe.get_cached_doc(SETTINGS_DOCTYPE)
	if not settings.get("enable_floating_chat"):
		return {}

	snippet = (settings.get("embed_snippet") or "").strip()
	if not snippet:
		return {}

	match = KEY_PATTERN.search(snippet)
	if not match:
		# Raw snippet — nothing to hand to chat_embed.js.
		return {}

	return {"key": match.group(1).strip(), "origin": _api_origin(snippet)}


def add_chat_key(bootinfo):
	"""boot_session hook. Never raises: a broken setting must not break Desk."""
	try:
		bootinfo.exacuer_chat = get_desk_chat_config()
	except Exception:
		bootinfo.exacuer_chat = {}
