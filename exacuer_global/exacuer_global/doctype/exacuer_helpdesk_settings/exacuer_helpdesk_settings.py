"""Site-level settings for the floating support chat on Desk.

Paste the embed snippet copied from Exacuer Chat Widget and the launcher appears
bottom-right on every Desk page. Delivery is:

    hooks.app_include_js  -> loads chat_embed.js on Desk
    hooks.boot_session    -> chat_boot publishes the key into frappe.boot
    chat_embed.js         -> reads frappe.boot.exacuer_chat.key

Two Frappe details this depends on:

  * embed_snippet must be fieldtype Code. sanitize_html() runs on save and
    exempts only Attach, Attach Image, Barcode and Code (or fields flagged
    ignore_xss_filter), so a Small Text or Text field would have its <script>
    tag silently stripped.
  * Desk renders app_include_js as a bare <script src="...">. It cannot carry a
    data- attribute and it cannot express an inline script, which is why the key
    goes through boot and why a raw third-party snippet is rejected here.

The snippet is the single source of truth; the key is parsed on demand rather
than copied into another field that could drift.
"""

import html
import re
from urllib.parse import urlparse

import frappe
from frappe.model.document import Document
from frappe.utils import get_url

# Legacy: earlier versions injected into Website Settings -> <head> HTML. Kept
# only so saving these settings cleans that block up.
BLOCK_START = "<!-- exacuer-support-chat:start -->"
BLOCK_END = "<!-- exacuer-support-chat:end -->"
BLOCK_PATTERN = re.compile(
	re.escape(BLOCK_START) + r".*?" + re.escape(BLOCK_END) + r"\n?",
	re.DOTALL,
)

MAX_SNIPPET_LENGTH = 8000

WIDGET_DOCTYPE = "Exacuer Chat Widget"
# Short enough that a wrong host cannot hold the form's test open.
ASSET_TIMEOUT = 6

SRC_PATTERN = re.compile(r"""src\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
KEY_PATTERN = re.compile(r"""data-chat-key\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
SCRIPT_TAG = re.compile(r"<script\b", re.IGNORECASE)
URL_PATTERN = re.compile(r"""https?://[^\s"'<>]+""")
SAFE_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


class ExacuerHelpdeskSettings(Document):
	def validate(self):
		if not self.enable_floating_chat:
			return

		snippet = (self.embed_snippet or "").strip()
		if not snippet:
			frappe.throw("Paste the embed snippet, or untick Enable Floating Chat.")
		if len(snippet) > MAX_SNIPPET_LENGTH:
			frappe.throw(f"That snippet is too long (max {MAX_SNIPPET_LENGTH} characters).")

		if not KEY_PATTERN.search(snippet):
			if SCRIPT_TAG.search(snippet):
				# A third-party inline block has no key, and Desk cannot render an
				# inline script through app_include_js, so it would save and do
				# nothing. Say so rather than fail quietly.
				frappe.throw(
					"That snippet has no <b>data-chat-key</b>, so it cannot load on Desk. "
					"Desk loads scripts by URL only, which cannot carry an inline "
					"third-party script. Copy the snippet from <b>Exacuer Chat Widget</b> "
					"on the helpdesk, or put a third-party snippet in "
					"<b>Website Settings &rarr; &lt;head&gt; HTML</b> instead."
				)
			frappe.throw(
				"No &lt;script&gt; tag found. Paste the complete snippet, including the "
				"&lt;script&gt; line."
			)

		# Parsing is the validation: raises a specific error if unusable.
		self.parsed()

	def on_update(self):
		# These settings no longer manage website injection; drop any block a
		# previous version left in Website Settings.
		remove_legacy_website_block()

	def parsed(self):
		"""(script_url, chat_key) from the stored snippet."""
		return parse_managed((self.embed_snippet or "").strip())

	def chat_key(self):
		return self.parsed()[1]


def parse_managed(snippet):
	"""Pull (script_url, chat_key) out of the managed widget snippet."""
	src_match = SRC_PATTERN.search(snippet)
	key_match = KEY_PATTERN.search(snippet)

	url = (src_match.group(1) if src_match else "").strip()
	key = (key_match.group(1) if key_match else "").strip()

	if not url:
		found = URL_PATTERN.search(snippet)
		url = found.group(0) if found else ""

	if not url:
		frappe.throw("Could not find a script URL in that snippet.")
	if not (url.startswith("http://") or url.startswith("https://")):
		frappe.throw("The script URL must start with http:// or https://")
	if not key:
		frappe.throw("Could not find data-chat-key in that snippet.")
	if not SAFE_KEY.match(key):
		frappe.throw("That chat key does not look valid.")

	return url, key


def remove_legacy_website_block():
	"""Strip the old injected block from Website Settings -> <head> HTML."""
	website = frappe.get_single("Website Settings")
	current = website.head_html or ""
	if BLOCK_START not in current:
		return

	website.head_html = BLOCK_PATTERN.sub("", current).strip()
	# Saving clears the website cache so the old tag stops being served.
	website.save(ignore_permissions=True)


def plain(text):
	"""A validate() message as plain text.

	Those messages are written for a msgprint, so they carry <b> tags and escaped
	entities. The test escapes everything it renders, which would otherwise show
	an admin "&amp;lt;script&amp;gt;".
	"""
	return html.unescape(frappe.utils.strip_html(text or "")).strip()


def origin_of(url):
	"""scheme://host[:port] for an http(s) URL, else "" ."""
	parsed = urlparse(url or "")
	if parsed.scheme in ("http", "https") and parsed.netloc:
		return f"{parsed.scheme}://{parsed.netloc}"
	return ""


def check_script_url(url):
	"""Is that script URL actually served?

	This has to happen server-side. A browser loading a cross-origin <script>
	learns only "worked" or "didn't" — never the status code — and /assets sends
	no CORS headers, so fetch() cannot read the response either. A 404 there is
	the difference between a silent no-op and a working launcher, so it is worth
	one HTTP request.

	Tried twice. A tunnel or CDN in front of the site can drop a single request
	and answer 5xx while every browser is being served fine — observed as a
	Cloudflare 530 from a quick tunnel that returned 200 a moment later. One flap
	must not be reported as a broken setup.
	"""
	result = {"ok": False, "status": 0, "detail": "not attempted", "attempts": 0}

	for attempt in (1, 2):
		result["attempts"] = attempt
		try:
			import requests

			res = requests.get(url, timeout=ASSET_TIMEOUT, stream=True)
			res.close()
			content_type = (res.headers.get("Content-Type") or "").split(";")[0].strip()
			# A wrong path on a Frappe site answers 404, but a catch-all in front
			# of it can answer 200 with an HTML error page, so the type matters too.
			result["status"] = res.status_code
			result["detail"] = content_type or "no content type"
			result["ok"] = res.status_code == 200 and "javascript" in content_type.lower()

			if result["ok"] or res.status_code < 500:
				# Below 500 is the site's own answer; a retry would say the same.
				break
		except Exception as exc:
			result["status"] = 0
			result["detail"] = str(exc)[:200] or exc.__class__.__name__

	return result


def local_widget(key, api_origin, site_origin):
	"""Diagnostics for the widget record, when it lives on this site.

	None when the snippet points at another site: the record is not readable from
	here, and the form's own call to that site's config endpoint covers it.
	"""
	if api_origin and api_origin != site_origin:
		return None
	if not frappe.db.exists("DocType", WIDGET_DOCTYPE):
		return {"found": False, "reason": f"{WIDGET_DOCTYPE} is not installed on this site."}

	name = frappe.db.get_value(WIDGET_DOCTYPE, {"widget_key": key}, "name")
	if not name:
		return {"found": False, "reason": "No widget on this site carries that key."}

	widget = frappe.get_doc(WIDGET_DOCTYPE, name)
	allowed = widget.origin_list()
	agent = widget.create_ticket_as or ""

	return {
		"found": True,
		"name": name,
		"enabled": bool(widget.enabled),
		"expired": bool(widget.has_expired()),
		"expires_on": str(widget.get("expires_on") or ""),
		"allowed_origins": allowed,
		# Blank means the allowlist is off — any site may embed the key.
		"open_to_all": not allowed,
		"origin_allowed": (not allowed) or site_origin in allowed,
		"create_ticket_as": agent,
		"agent_enabled": bool(frappe.db.get_value("User", agent, "enabled")) if agent else False,
	}


@frappe.whitelist()
def desk_status():
	"""The server half of the form's chat test.

	Covers what only the server can see: the saved snippet, whether the script
	URL serves, and the widget record when it is on this site. The browser half —
	the config call, CORS, the launcher on the page — is run by the form, because
	only a browser can prove what a visitor's browser gets.
	"""
	frappe.only_for("System Manager")

	settings = frappe.get_single("Exacuer Helpdesk Settings")
	site_origin = origin_of(get_url())
	status = {
		"enabled": False,
		"url": "",
		"key": "",
		"api_origin": "",
		"site_origin": site_origin,
		"problem": "",
		"asset": None,
		"widget": None,
	}

	if not settings.enable_floating_chat:
		status["problem"] = "Enable Floating Chat is off, so nothing loads on Desk."
		return status

	if not (settings.embed_snippet or "").strip():
		status["problem"] = "No embed snippet is saved."
		return status

	# These two are checked before parsing, in validate()'s order. A raw inline
	# snippet has no src either, and "no script URL" would send someone looking
	# for the wrong thing. Written as plain text: the form escapes what it renders.
	snippet = settings.embed_snippet.strip()
	if not SCRIPT_TAG.search(snippet):
		status["problem"] = (
			"No <script> tag found. Paste the complete snippet copied from "
			"Exacuer Chat Widget, including the <script> line."
		)
		return status

	if not KEY_PATTERN.search(snippet):
		status["problem"] = (
			"That snippet has no data-chat-key, so Desk cannot load it. Desk loads scripts "
			"by URL only, which cannot carry an inline third-party script. Copy the snippet "
			"from Exacuer Chat Widget on the helpdesk."
		)
		return status

	try:
		url, key = settings.parsed()
	except frappe.ValidationError as exc:
		# parse_managed reports through frappe.throw, which also queues a message
		# for the client. Drop it: the test renders the reason itself.
		frappe.clear_last_message()
		status["problem"] = plain(str(exc)) or "That snippet could not be parsed."
		return status

	status.update(
		{
			"enabled": True,
			"url": url,
			"key": key,
			# Blank when the snippet is relative — the widget then calls its own
			# origin, which for a self-hosted helpdesk is this site.
			"api_origin": origin_of(url) or site_origin,
			"asset": check_script_url(url),
		}
	)
	status["widget"] = local_widget(key, origin_of(url), site_origin)
	return status
