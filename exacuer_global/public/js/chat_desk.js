/**
 * Desk loader for the floating support chat.
 *
 * chat_embed.js lives in exacuer_support, on the helpdesk. A customer site runs
 * this app alone — it has the settings and the boot key, but no local copy of
 * that script — so without this file the launcher never renders: boot carries a
 * key that nothing ever reads.
 *
 * So load the script the same way a customer *website* does: straight from the
 * helpdesk origin, with the key on a data- attribute. That has a second benefit.
 * chat_embed.js derives its API base from its own src, so pointing the tag at the
 * helpdesk sends the key back to the site that issued it. A local copy would
 * instead take the local origin and have to be corrected through boot.origin.
 *
 * The asset path stays in exacuer_support on purpose: it is the URL inside every
 * snippet already pasted on a customer's site, and /assets is served by nginx, so
 * moving it could not be redirected.
 */

(function () {
	"use strict";

	function load() {
		// exacuer_support installed here injects its own local copy through its
		// app_include_js. Deferring to DOMContentLoaded means every static tag is
		// in the DOM by now, so this check is reliable either way.
		if (window.__exacuerChatLoaded) return;
		if (document.querySelector('script[src*="chat_embed.js"]')) return;

		var config = (window.frappe && frappe.boot && frappe.boot.exacuer_chat) || {};

		// Empty when chat is off, no snippet is saved, or the snippet has no key.
		// chat_boot has already made that judgement; nothing to second-guess here.
		var key = (config.key || "").trim();
		if (!key) return;

		// Blank for a relative snippet URL, which means the helpdesk is this site —
		// and then exacuer_support is installed and served the script already.
		var origin = (config.origin || "").replace(/\/+$/, "");
		if (!origin) return;

		var script = document.createElement("script");
		script.src = origin + "/assets/exacuer_support/js/chat_embed.js";
		script.async = true;
		script.setAttribute("data-chat-key", key);
		document.head.appendChild(script);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", load);
	} else {
		load();
	}
})();
