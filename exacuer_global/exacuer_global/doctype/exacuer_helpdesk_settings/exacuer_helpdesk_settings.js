/**
 * Test Chat: end-to-end check that the floating chat will actually work.
 *
 * Two halves, because neither alone is the truth:
 *
 *   desk_status()  - the saved snippet, whether the script URL serves, and the
 *                    widget record (only readable when it is on this site).
 *   this file      - the config call, made exactly the way chat_embed.js makes
 *                    it, so CORS, guest access and the widget's origin allowlist
 *                    are exercised for real, plus whether this page has the key.
 *
 * Every path renders a result. A test that goes quiet on failure is the one
 * thing it must never do.
 */

const STATUS_METHOD =
	"exacuer_global.exacuer_global.doctype.exacuer_helpdesk_settings.exacuer_helpdesk_settings.desk_status";
const CONFIG_PATH = "/api/method/exacuer_support.chat_widget.config";

frappe.ui.form.on("Exacuer Helpdesk Settings", {
	refresh(frm) {
		// Added unconditionally: when chat is off or the snippet is unusable, the
		// test is exactly what says so.
		frm.add_custom_button(__("Test Chat"), () => run_test(frm));

		if (!frm.doc.enable_floating_chat) {
			frm.dashboard.set_headline(__("Floating chat is off."));
			return;
		}

		if (!(frm.doc.embed_snippet || "").trim()) {
			frm.dashboard.set_headline(
				__("Paste the embed snippet from Exacuer Chat Widget and save.")
			);
			return;
		}

		frm.dashboard.set_headline(
			__("Live on Desk. Reload after saving — the chat key is delivered through boot.")
		);
	},
});

async function run_test(frm) {
	if (frm.is_dirty()) {
		frappe.msgprint({
			title: __("Save first"),
			message: __("The test reads the saved snippet, not the one being edited."),
			indicator: "orange",
		});
		return;
	}

	frappe.dom.freeze(__("Testing chat…"));
	try {
		const rows = await collect();
		render(rows);
	} catch (err) {
		// Anything unforeseen still gets a verdict rather than a dead button.
		render([
			{
				label: __("Test"),
				state: "fail",
				detail: (err && err.message) || __("The test could not be run."),
			},
		]);
	} finally {
		frappe.dom.unfreeze();
	}
}

async function collect() {
	const rows = [];

	const r = await frappe.call({ method: STATUS_METHOD });
	if (r.exc || !r.message) {
		rows.push({
			label: __("Settings"),
			state: "fail",
			detail: __("Could not read the settings on the server."),
		});
		return rows;
	}

	const status = r.message;

	if (!status.enabled) {
		rows.push({ label: __("Snippet"), state: "fail", detail: esc(status.problem) });
		return rows;
	}

	rows.push({
		label: __("Snippet"),
		state: "pass",
		detail: `${__("Key")} ${esc(status.key)}<br>${esc(status.url)}`,
	});

	rows.push(asset_row(status.asset));
	rows.push(...widget_rows(status));
	rows.push(...(await api_rows(status)));
	rows.push(this_page_row(status));

	return rows;
}

/**
 * The snippet's script URL, as seen from the server.
 *
 * Scope matters here. Desk does not load this URL — app_include_js serves this
 * site's own copy of the file — so a problem with it never stops chat on Desk.
 * It is the URL pasted on customer websites, which is why it is still checked.
 *
 * And the server's network path is not a visitor's: a tunnel, CDN or firewall
 * can refuse the server while serving every browser. So only the site's own
 * answer (below 500) is called a failure; anything else is reported as unproven.
 */
function asset_row(asset) {
	const label = __("Script file");
	if (!asset) return { label, state: "warn", detail: __("Not checked.") };

	if (asset.ok) {
		return {
			label,
			state: "pass",
			detail: `${asset.status} · ${esc(asset.detail)}`,
		};
	}

	const website_note = __(
		"Desk loads its own copy of the script, so chat here is unaffected — this is the URL customer websites load."
	);

	if (asset.status && asset.status < 500) {
		return {
			label,
			state: "fail",
			detail: `${__("Answered")} ${asset.status} (${esc(asset.detail)}). ${website_note}`,
		};
	}

	return {
		label,
		state: "warn",
		detail: `${
			asset.status
				? `${__("Answered")} ${asset.status} ${__("on both tries")}`
				: `${__("Could not be reached from the server")}: ${esc(asset.detail)}`
		}. ${__("A tunnel, CDN or firewall can refuse the server and still serve browsers.")} ${website_note}`,
	};
}

function widget_rows(status) {
	const widget = status.widget;
	if (!widget) {
		// Remote helpdesk: the record is not ours to read. The config call below is
		// the check that covers it.
		return [
			{
				label: __("Widget record"),
				state: "warn",
				detail: `${__("Owned by")} ${esc(status.api_origin)} — ${__(
					"checked through the API call below."
				)}`,
			},
		];
	}

	if (!widget.found) {
		return [{ label: __("Widget record"), state: "fail", detail: esc(widget.reason) }];
	}

	const rows = [
		{
			label: __("Widget record"),
			state: widget.enabled ? "pass" : "fail",
			detail: widget.enabled
				? esc(widget.name)
				: `${esc(widget.name)} — ${__("disabled, so every request is refused.")}`,
		},
	];

	if (widget.open_to_all) {
		rows.push({
			label: __("Allowed origins"),
			state: "warn",
			detail: __("Empty — any website can embed this key. Set the allowlist."),
		});
	} else {
		rows.push({
			label: __("Allowed origins"),
			state: widget.origin_allowed ? "pass" : "fail",
			detail: widget.origin_allowed
				? widget.allowed_origins.map(esc).join("<br>")
				: `${esc(status.site_origin)} ${__(
						"is not listed, so chat on this Desk is refused"
				  )}:<br>${widget.allowed_origins.map(esc).join("<br>")}`,
		});
	}

	rows.push({
		label: __("Tickets created as"),
		state: widget.agent_enabled ? "pass" : "fail",
		detail: widget.create_ticket_as
			? widget.agent_enabled
				? esc(widget.create_ticket_as)
				: `${esc(widget.create_ticket_as)} — ${__("that user is disabled")}`
			: __("Not set — ticket creation will fail."),
	});

	return rows;
}

async function api_rows(status) {
	let result;
	try {
		result = await call_config(status.api_origin, status.key);
	} catch (err) {
		// fetch only rejects on a network-level failure, and the browser never
		// tells us which one it was.
		return [
			{
				label: __("API response"),
				state: "fail",
				detail: `${__("No response from")} ${esc(status.api_origin)} — ${__(
					"unreachable, offline, or the origin was refused by CORS."
				)}`,
			},
		];
	}

	if (!result.ok) {
		return [
			{
				label: __("API response"),
				state: "fail",
				detail: `${__("Request failed")} (${result.status}) — ${esc(result.error)}`,
			},
		];
	}

	const config = result.config;
	const rows = [
		{
			label: __("API response"),
			state: "pass",
			detail: `${esc(config.brand_name) || __("(no brand name)")} · ${
				(config.ticket_types || []).length
			} ${__("types")} · ${(config.priorities || []).length} ${__("priorities")} · ${
				(config.statuses || []).length
			} ${__("statuses")}`,
		},
	];

	if (!(config.ticket_types || []).length || !(config.priorities || []).length) {
		rows.push({
			label: __("Pre-chat form"),
			state: "fail",
			detail: __(
				"Type or Priority came back empty, so a visitor cannot complete the form. Check HD Ticket Type and HD Ticket Priority on the helpdesk."
			),
		});
	}

	rows.push({
		label: __("Support validity"),
		state: config.expired ? "fail" : "pass",
		detail: config.expired
			? `${__("Expired")} ${esc(config.expires_on)} — ${__(
					"new tickets are blocked and the notice is shown instead."
			  )}`
			: config.expires_on
			? `${__("Valid until")} ${esc(config.expires_on)}`
			: __("No expiry set."),
	});

	return rows;
}

/**
 * What this browser actually got.
 *
 * Every row above is about the helpdesk. This one is the only check that can see
 * the last hop — whether chat_desk.js got the script onto the page and whether
 * the widget then mounted. "Has the key but no launcher" was previously the whole
 * answer here, which is true but points nowhere, so the two ways it fails are
 * separated: the script never arrived, or it arrived and rendered nothing.
 */
function this_page_row(status) {
	const label = __("This page");
	const boot = (frappe.boot && frappe.boot.exacuer_chat) || {};

	if (boot.key !== status.key) {
		return {
			label,
			state: "warn",
			detail: __("Loaded before the last save. Reload to pick up the current key."),
		};
	}

	if (document.querySelector("div[data-exacuer-chat]")) {
		return { label, state: "pass", detail: __("The launcher is on this page, bottom-right.") };
	}

	const tag = document.querySelector('script[src*="chat_embed.js"]');
	if (tag) {
		return {
			label,
			state: "warn",
			detail: `${__("The script tag is on this page but nothing rendered, so it failed to load or errored.")}<br>${esc(
				tag.src
			)}<br>${__("Check Script file above, then the browser console.")}`,
		};
	}

	// Mixed content is the one failure the server cannot see: it depends on how
	// *this* page was served, not on whether the URL works.
	if (window.location.protocol === "https:" && (status.api_origin || "").startsWith("http://")) {
		return {
			label,
			state: "fail",
			detail: `${__("Blocked as mixed content.")} ${esc(status.api_origin)} ${__(
				"is http and this Desk is https, so the browser refuses to load the script. Serve the helpdesk over https and re-copy the snippet."
			)}`,
		};
	}

	return {
		label,
		state: "fail",
		detail: __(
			"No chat script reached this page. Reload; if it stays away, chat_desk.js did not inject it — check the browser console."
		),
	};
}

/**
 * The config call, shaped exactly like chat_embed.js's call(): form-encoded POST
 * with credentials omitted, which keeps it a CORS "simple request". Copying that
 * shape is the point — a test that used frappe.call would prove the endpoint
 * works for a logged-in Desk user and tell us nothing about a visitor.
 */
async function call_config(origin, key) {
	const body = new URLSearchParams();
	body.append("key", key);

	const res = await fetch(origin + CONFIG_PATH, { method: "POST", credentials: "omit", body });
	// A refusal is JSON too; a proxy in the way may send HTML, hence the fallback.
	const data = await res.json().catch(() => ({}));

	return {
		ok: res.ok,
		status: res.status,
		config: (data && data.message) || {},
		error: api_error(data, res.status),
	};
}

/** Frappe reports a deliberate throw in _server_messages and little else. */
function api_error(data, http_status) {
	try {
		const messages = JSON.parse((data && data._server_messages) || "[]");
		for (const raw of messages) {
			let text = raw;
			try {
				text = JSON.parse(raw).message || raw;
			} catch (e) {
				// Older payloads put the text in directly.
			}
			text = strip(text);
			if (text) return text;
		}
	} catch (e) {
		// Fall through to the generic forms below.
	}

	const exception = strip((data && (data._error_message || data.exception)) || "");
	if (exception) return exception.replace(/^[\w.]*(Error|Exception):\s*/, "");
	if (http_status === 403) return __("Refused — unknown key, disabled widget, or blocked origin.");
	if (http_status === 429) return __("Rate limited. Wait an hour or test from a logged-in session.");
	return __("No detail was returned. Check the site's error log.");
}

function strip(html) {
	const el = document.createElement("div");
	el.innerHTML = html || "";
	return (el.textContent || "").trim();
}

/**
 * Every dynamic value goes through this. A detail cell is rendered as HTML so
 * that rows can carry <br>, which means the parts that are not ours — the
 * snippet's URL, a remote server's Content-Type, an error message that has
 * already been through strip() once — must be escaped on the way in.
 */
function esc(value) {
	return frappe.utils.escape_html(value === null || value === undefined ? "" : String(value));
}

function render(rows) {
	const marks = {
		pass: '<span style="color:var(--green-500,#28a745);font-weight:700">&#10003;</span>',
		warn: '<span style="color:var(--orange-500,#f5a623);font-weight:700">!</span>',
		fail: '<span style="color:var(--red-500,#dc3545);font-weight:700">&#10007;</span>',
	};

	const body = rows
		.map(
			(row) => `
				<tr>
					<td style="width:28px;text-align:center">${marks[row.state]}</td>
					<td style="width:34%"><b>${frappe.utils.escape_html(row.label)}</b></td>
					<td style="word-break:break-word">${row.detail || ""}</td>
				</tr>`
		)
		.join("");

	// Named, not counted. "1 check failed" reads as "chat is down" even when the
	// one failure is a detail that does not stop chat from working.
	const failed = rows.filter((row) => row.state === "fail").map((row) => row.label);
	const warned = rows.filter((row) => row.state === "warn").map((row) => row.label);

	frappe.msgprint({
		title: __("Chat Test"),
		indicator: failed.length ? "red" : warned.length ? "orange" : "green",
		message: `
			<p>${
				failed.length
					? __("Failed: {0}", [frappe.utils.escape_html(failed.join(", "))])
					: warned.length
					? __("Working, worth a look: {0}", [frappe.utils.escape_html(warned.join(", "))])
					: __("Working end to end.")
			}</p>
			<table class="table table-bordered" style="margin-bottom:0">${body}</table>
		`,
	});
}
