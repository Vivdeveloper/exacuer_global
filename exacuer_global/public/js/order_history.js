// Trading history for the party on a draft document — what this customer bought
// or this supplier supplied before, and at what rate. Offered while the document
// is still a draft, which is when the answer can still change what you write.
//
// Lines can be ticked and brought into the document at the qty and rate they
// were traded at. Nothing is computed server-side and no endpoint is added: the
// generic list API reads the item lines by naming the child table in its fields,
// and the reading of them is done here.
//
// Two things are marked, in two channels, so neither has to speak for the other:
//
//   the coloured edge and its pill say how the item behaves — traded most
//   often, traded frequently, traded lately
//
//   the pill beside the rate says what the price did — moved sharply since the
//   last document, or held at the same level or better
//
// Both are explained in the legend at the top of the dialog, because a colour
// nobody can decode is just decoration.
//
// This file only defines; each form registers itself through setup() from its
// own doctype script, so nothing here depends on when the file loads.

frappe.provide("exacuer_global.order_history");

Object.assign(exacuer_global.order_history, {
	// Lines read per table. The dialog says so when a table fills up, rather
	// than letting a partial list read as the whole history.
	LINES: 100,

	// An item traded on this many separate documents is a regular.
	FREQUENT_DOCS: 3,

	// Traded within this many days counts as lately. Wide, because a quarter is
	// a short interval in repeat B2B trade.
	RECENT_DAYS: 90,

	// A rate this far from what the item last moved at is worth a second look,
	// in either direction: one way erodes the margin, the other may be a keying
	// error or a cost nobody has explained to the party yet.
	RATE_ALERT: 0.1,

	// `config` is { doctype, party_field, button, sources }, where each source is
	// { doctype, date_field, title, id_label, filters? } — see the doctype
	// scripts. Sales forms read orders and invoices; buying forms read theirs.
	setup(config) {
		const show = (frm) => exacuer_global.order_history.toggle_button(frm, config);

		frappe.ui.form.on(config.doctype, {
			refresh: show,
			// Choosing a party on a new document does not refresh the form, so
			// the button has to be offered — or withdrawn — as the choice
			// changes.
			[config.party_field]: show,
		});
	},

	toggle_button(frm, config) {
		// Drafts only: past rates matter while the document can still act on
		// them.
		const wanted = frm.doc.docstatus === 0 && !!frm.doc[config.party_field];

		if (!wanted) {
			frm.custom_buttons[config.button] && frm.remove_custom_button(config.button);
			return;
		}

		// A form refresh clears custom buttons, so the button is re-added here.
		// Changing the party on a draft does not, and would add a second.
		if (frm.custom_buttons[config.button]) return;

		frm.add_custom_button(config.button, () =>
			exacuer_global.order_history.show(frm, config)
		);
	},

	show(frm, config) {
		const history = exacuer_global.order_history;
		const party = frm.doc[config.party_field];
		// The document this dialog belongs to. It is checked again before
		// anything is added, so a document opened behind an open dialog cannot
		// quietly receive another party's lines.
		const docname = frm.doc.name;

		const dialog = new frappe.ui.Dialog({
			title: __("{0}: {1}", [
				config.button,
				frm.doc[`${config.party_field}_name`] || party,
			]),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "history" }],
		});

		const body = dialog.fields_dict.history.$wrapper;
		body.html(`<p class="text-muted">${__("Loading...")}</p>`);
		dialog.show();

		Promise.all(config.sources.map((source) => history.fetch(source, config, party))).then(
			(results) => {
				// One flat list so an item's behaviour is read across every
				// source, while each table still renders on its own.
				const lines = results.flatMap((rows, i) =>
					rows.map((row) => ({
						...row,
						doctype: config.sources[i].doctype,
						date: row[config.sources[i].date_field],
					}))
				);
				lines.forEach((line, i) => (line.idx = i));

				const top_count = history.analyse(lines);

				body.html(
					history.hint() +
						config.sources
							.map((source, i) =>
								history.section(
									source,
									lines.filter((line) => line.doctype === source.doctype),
									results[i].length,
									top_count
								)
							)
							.join("")
				);

				dialog.set_primary_action(__("Add to {0}", [__(config.doctype)]), () => {
					const picked = body
						.find(".order-history-pick:checked")
						.map((_, box) => lines[cint($(box).attr("data-line"))])
						.get();

					if (!picked.length) {
						frappe.show_alert({ message: __("Nothing selected"), indicator: "orange" });
						return;
					}

					// The form may have moved on while the dialog sat open.
					if (frm.doc.name !== docname) {
						frappe.show_alert({
							message: __("This document is no longer open"),
							indicator: "red",
						});
						dialog.hide();
						return;
					}

					dialog.hide();
					history.add_to_document(frm, picked);
				});
			}
		);

		body.on("change", ".order-history-pick-all", (event) => {
			$(event.currentTarget)
				.closest("table")
				// Only what the filter is showing: select-all should never tick
				// lines the reader cannot see.
				.find(".order-history-pick:visible")
				.prop("checked", event.currentTarget.checked);
		});

		body.on("click", ".order-history-filter", (event) => {
			$(event.currentTarget).toggleClass("on");
			history.apply_filter(body);
		});
	},

	fetch(source, config, party) {
		const history = exacuer_global.order_history;
		const child = `\`tab${source.doctype} Item\``;

		return new Promise((resolve) => {
			// A source the user may not read is an empty table, not a hung
			// dialog. frappe.db.get_list resolves only on success, so a refused
			// query would leave "Loading..." on screen for ever — hence the
			// permission check up front and the error handler behind it.
			if (!frappe.model.can_read(source.doctype)) return resolve([]);

			frappe.call({
				method: "frappe.desk.reportview.get_list",
				type: "GET",
				args: {
					doctype: source.doctype,
					filters: {
						[config.party_field]: party,
						docstatus: 1,
						...(source.filters || {}),
					},
					fields: [
						"name",
						source.date_field,
						"currency",
						`${child}.item_code`,
						`${child}.item_name`,
						`${child}.qty`,
						`${child}.uom`,
						`${child}.rate`,
					],
					order_by: `${source.date_field} desc`,
					limit: history.LINES,
				},
				callback: (r) => resolve(r.message || []),
				error: () => resolve([]),
			});
		});
	},

	// Mark up every line in place, and report how many documents the most
	// traded item appeared on.
	analyse(lines) {
		const history = exacuer_global.order_history;
		const recent_since = frappe.datetime.add_days(
			frappe.datetime.get_today(),
			-history.RECENT_DAYS
		);

		const by_item = {};
		for (const line of lines) (by_item[line.item_code] ||= []).push(line);

		let top_count = 0;

		for (const item_lines of Object.values(by_item)) {
			// Each table arrives newest first, so the merged history has to be
			// put back in order before rates can be read as a sequence.
			item_lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

			const documents = new Set(item_lines.map((line) => `${line.doctype}:${line.name}`));
			top_count = Math.max(top_count, documents.size);

			item_lines.forEach((line, i) => {
				// How often an item is traded is a fact about the item, and is
				// carried by every line of it. Recency is not: an item bought
				// last week does not make its line from January recent.
				line.times = documents.size;
				line.recent = line.date >= recent_since;

				// Compared against the last *document*, not the last line: a
				// document splitting one item across five sizes did not change
				// its price five times.
				const previous = item_lines
					.slice(i + 1)
					.find((older) => older.name !== line.name || older.doctype !== line.doctype);
				line.previous_rate = previous ? flt(previous.rate) : null;
			});
		}

		// Only a repeat purchase can lead. With everything at a single document
		// there is no leader to crown, and every row would wear a crown.
		return top_count > 1 ? top_count : null;
	},

	// How the item behaves. At most one wins the row's edge, strongest first.
	marks(line, top_count) {
		const history = exacuer_global.order_history;
		const marks = [];

		if (top_count && line.times === top_count) {
			marks.push({ color: "purple", label: __("Top") });
		} else if (line.times >= history.FREQUENT_DOCS) {
			marks.push({ color: "yellow", label: __("Frequent") });
		}

		if (line.recent) marks.push({ color: "blue", label: __("Recent") });

		return marks;
	},

	// What the price did since this item last moved.
	rate_mark(line) {
		const history = exacuer_global.order_history;

		// Nothing to compare the first sighting of an item against.
		if (!line.previous_rate) return null;

		const change = (flt(line.rate) - line.previous_rate) / line.previous_rate;

		if (Math.abs(change) >= history.RATE_ALERT) {
			return { color: "red", label: history.percent(change) };
		}
		if (change > 0) return { color: "green", label: history.percent(change) };
		if (change === 0) return { color: "green", label: __("same") };

		// A slight dip earns neither an alarm nor a reassurance.
		return null;
	},

	percent(change) {
		return `${change > 0 ? "+" : ""}${flt(change * 100, 1)}%`;
	},

	// The legend, which doubles as the filter: every colour shown here can be
	// clicked to narrow both tables to the lines carrying it.
	legend() {
		const history = exacuer_global.order_history;

		return [
			{ color: "purple", label: __("Traded most often") },
			{ color: "yellow", label: __("On {0}+ documents", [history.FREQUENT_DOCS]) },
			{ color: "blue", label: __("In the last {0} days", [history.RECENT_DAYS]) },
			{
				color: "red",
				label: __("Rate moved {0}%+", [flt(history.RATE_ALERT * 100, 1)]),
			},
			{ color: "green", label: __("Same rate or better") },
		];
	},

	hint() {
		const history = exacuer_global.order_history;

		return `
			<div class="text-muted small" style="margin-bottom: var(--margin-md);">
				<div style="margin-bottom: var(--margin-sm);">
					${__("Tick any lines to add them — quantity and rate come with them.")}
					${__("Click a colour to show only those lines.")}
				</div>
				<div style="display: flex; flex-wrap: wrap; gap: var(--margin-xs);">
					${history
						.legend()
						.map((mark) => history.pill(mark, "order-history-filter"))
						.join("")}
				</div>
			</div>
		`;
	},

	// Show only the lines carrying a chosen colour. Several colours can be on at
	// once, and a line wearing any of them stays.
	apply_filter(body) {
		const active = body
			.find(".order-history-filter.on")
			.map((_, pill) => $(pill).attr("data-mark"))
			.get();

		body.find(".order-history-filter").each((_, pill) => {
			const on = $(pill).hasClass("on");
			$(pill).css({
				// currentColor is the pill's own text colour, so the ring picks
				// up the mark's colour in either theme.
				"box-shadow": on ? "0 0 0 1.5px currentColor" : "none",
				opacity: !active.length || on ? 1 : 0.45,
			});
		});

		body.find("tbody tr").each((_, tr) => {
			const marks = ($(tr).attr("data-marks") || "").split(" ");
			const show = !active.length || active.some((color) => marks.includes(color));

			$(tr).toggle(show);
			// What is out of sight must not be added: a line hidden by a filter
			// keeps no tick.
			if (!show) $(tr).find(".order-history-pick").prop("checked", false);
		});

		// A table filtered down to nothing should say so, rather than leave a
		// header standing over blank space.
		body.find(".order-history-table").each((_, wrapper) => {
			const $wrapper = $(wrapper);
			$wrapper
				.find(".order-history-none")
				.toggle(!$wrapper.find("tbody tr:visible").length);
		});
	},

	section(source, lines, fetched, top_count) {
		const history = exacuer_global.order_history;

		return `
			<div style="margin-bottom: var(--margin-lg);">
				<div class="text-muted" style="margin-bottom: var(--margin-xs);">${source.title}</div>
				${
					fetched >= history.LINES
						? `<div class="text-muted small" style="margin-bottom: var(--margin-xs);">${__(
								"Showing the {0} most recent lines.",
								[history.LINES]
						  )}</div>`
						: ""
				}
				<div style="max-height: 300px; overflow: auto;">
					${history.table(source, lines, top_count)}
				</div>
			</div>
		`;
	},

	table(source, lines, top_count) {
		const history = exacuer_global.order_history;

		if (!lines.length) {
			return `<p class="text-muted">${__("Nothing here for this party yet.")}</p>`;
		}

		const rows = lines.map((line) => history.row(source, line, top_count)).join("");

		return `
			<div class="order-history-table">
				<table class="table table-bordered" style="margin: 0;">
					<thead>
						<tr>
							<th style="width: 32px;"><input type="checkbox" class="order-history-pick-all"></th>
							<th>${source.id_label}</th>
							<th>${__("Date")}</th>
							<th>${__("Item")}</th>
							<th class="text-right">${__("Qty")}</th>
							<th class="text-right">${__("Rate")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
				<p class="text-muted order-history-none" style="display: none; margin: var(--margin-sm) 0 0;">
					${__("No lines in this colour.")}
				</p>
			</div>
		`;
	},

	row(source, line, top_count) {
		const history = exacuer_global.order_history;
		const marks = history.marks(line, top_count);
		const rate_mark = history.rate_mark(line);

		// The row's left edge carries the strongest mark. A border rather than a
		// fill: it reads in either theme without putting text on a tinted ground.
		const edge = marks.length ? `border-left: 3px solid var(--text-on-${marks[0].color});` : "";

		// Every colour the line wears, for the legend filter to match against —
		// the rate's colour included, so a filter on it works the same way.
		const worn = marks
			.map((mark) => mark.color)
			.concat(rate_mark ? [rate_mark.color] : [])
			.join(" ");

		return `
			<tr data-marks="${worn}">
				<td style="${edge}">
					<input type="checkbox" class="order-history-pick" data-line="${line.idx}">
				</td>
				<td>${history.link(source.doctype, line.name)}</td>
				<td>${frappe.datetime.str_to_user(line.date)}</td>
				<td>
					<div style="display: flex; flex-wrap: wrap; gap: var(--margin-xs); align-items: center;">
						${history.link("Item", line.item_code)}
						${marks.map((mark) => history.pill(mark)).join("")}
					</div>
					${
						line.item_name && line.item_name !== line.item_code
							? `<div class="text-muted small">${frappe.utils.escape_html(
									line.item_name
							  )}</div>`
							: ""
					}
				</td>
				<td class="text-right">${history.quantity(line.qty)} ${frappe.utils.escape_html(
			line.uom || ""
		)}</td>
				<td class="text-right">
					<div style="display: flex; gap: var(--margin-xs); align-items: center; justify-content: flex-end;">
						${frappe.utils.escape_html(format_currency(line.rate, line.currency))}
						${rate_mark ? history.pill(rate_mark) : ""}
					</div>
				</td>
			</tr>
		`;
	},

	async add_to_document(frm, picked) {
		frappe.dom.freeze(__("Adding {0} item(s)...", [picked.length]));

		try {
			for (const line of picked) {
				const row = frm.add_child("items", { item_code: line.item_code });

				// Let ERPNext fetch the item's defaults first. The fetch brings
				// its own rate and qty, and would land on top of the historical
				// ones if those were written before it had finished.
				await frm.script_manager.trigger("item_code", row.doctype, row.name);
				await frappe.model.set_value(row.doctype, row.name, "qty", flt(line.qty));
				await frappe.model.set_value(row.doctype, row.name, "rate", flt(line.rate));
			}
		} finally {
			// In the finally: an item that fails to fetch must not leave the
			// rows that did land invisible in a frozen form.
			frappe.dom.unfreeze();
			exacuer_global.order_history.drop_empty_rows(frm);
			frm.refresh_field("items");
		}

		frappe.show_alert({
			message: __("Added {0} item(s) at their previous rate", [picked.length]),
			indicator: "green",
		});
	},

	// A new document opens with one empty item row. Adding to it leaves that
	// blank line sitting above the real ones, where it reads as an unfinished
	// item and fails validation on save.
	drop_empty_rows(frm) {
		const rows = frm.doc.items || [];
		const filled = rows.filter((row) => row.item_code);

		if (filled.length === rows.length) return;

		frm.doc.items = filled;
		filled.forEach((row, i) => (row.idx = i + 1));
	},

	pill(mark, extra_class = "") {
		const clickable = extra_class ? ' style="cursor: pointer;"' : "";
		return `<span class="indicator-pill ${mark.color} ${extra_class}" data-mark="${mark.color}"${clickable}>${mark.label}</span>`;
	},

	// Whole quantities read as whole numbers: 200.0000 is noise on a line that
	// only ever means 200.
	quantity(value) {
		return format_number(value, null, flt(value) % 1 ? 2 : 0);
	},

	// Escaped for display: a document name is data, and lands in the dialog's
	// markup as text.
	link(doctype, name) {
		return frappe.utils.get_form_link(doctype, name, true, frappe.utils.escape_html(name));
	},
});
