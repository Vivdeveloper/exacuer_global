// Party stats strip for transaction forms.
//
// The Customer and Supplier forms carry a Stats row — Annual Billing, Total
// Unpaid — that answers "is this account good for the money". The question is
// just as live while writing an order or an invoice for that party, so the same
// strip is drawn on those forms, from the party the document names.
//
// Nothing is computed and no endpoint is added. Loading the party through the
// desk's own document API runs the Customer or Supplier controller's onload,
// which is what attaches dashboard_info; ERPNext's own renderer turns that into
// the indicators. The figures agree with the party's own form because they are
// the same figures — including the reading of a credit balance, which comes
// back as Total Advance Received from a customer or Total Advance Paid to a
// supplier rather than as a debt.
//
// This file only defines; each form registers itself through setup() from its
// own doctype script, so nothing here depends on when the file loads.

frappe.provide("exacuer_global.party_stats");

Object.assign(exacuer_global.party_stats, {
	// Draw the strip on a transaction form. `party_field` is the link field on
	// the document — customer on a sales document, supplier on a buying one —
	// and `party_doctype` is what it points at.
	setup({ doctype, party_field, party_doctype }) {
		const show = (frm) => exacuer_global.party_stats.show(frm, party_field, party_doctype);

		frappe.ui.form.on(doctype, {
			refresh: show,
			// Drawn the moment a party is picked rather than only once the
			// document is saved: on a new document the figures are worth having
			// before the work is done, not after. Company decides which of a
			// multi-company party's figures apply, so a change there redraws.
			[party_field]: show,
			company: show,
		});
	},

	show(frm, party_field, party_doctype) {
		// Indicators append, and a party changed on an unsaved document gets no
		// form refresh to clear the last one's figures — so clear them here.
		frm.dashboard.stats_area_row.empty();
		frm.dashboard.stats_area.hide();

		const party = frm.doc[party_field];
		if (!party) return;

		frappe.model.with_doc(party_doctype, party, () => {
			// A reply lands after the fetch, by which time the party may have
			// moved on — a second pick, or another document opened — and two
			// picks can come back out of order. Draw only while this one holds.
			if (frm.doc[party_field] !== party) return;

			// dashboard_info is absent when the user may not read invoices.
			const info = frappe.get_doc(party_doctype, party)?.__onload?.dashboard_info || [];

			// A document belongs to one company, so the per-company blocks the
			// party's own form renders narrow to a single set of figures here.
			const company_info = info.filter((d) => d.company === frm.doc.company);
			if (!company_info.length) return;

			// What erpnext.utils reads from. __onload is never saved, so adding
			// to it leaves the document itself untouched.
			frm.doc.__onload = Object.assign(frm.doc.__onload || {}, {
				dashboard_info: company_info,
			});

			exacuer_global.party_stats.host_on_details_tab(frm);
			erpnext.utils.set_party_dashboard_indicators(frm);
		});
	},

	// Frappe hangs the whole form dashboard — Stats, Connections, charts — off
	// whichever tab carries show_dashboard, which on all four of these forms is
	// Connections. Only the Stats section is wanted on Details, so it is lifted
	// out on its own and the rest is left where the framework put it.
	//
	// The move survives the form's lifecycle: .form-dashboard-section is styled
	// by class rather than by where it sits, the dashboard holds its own
	// reference to the element and only ever empties it, and the layout is built
	// once — so a later call finds the section already in place and does nothing.
	host_on_details_tab(frm) {
		const stats = frm.dashboard.stats_area?.wrapper;
		// Tab zero is Details: the tabs a doctype declares come after the one
		// Frappe adds for the fields that precede the first Tab Break. A form
		// with no tabs at all has none, and keeps the stock placement.
		const details_tab = frm.layout.tabs?.[0]?.wrapper;

		if (!stats?.length || !details_tab?.length || stats.parent().is(details_tab)) return;

		stats.prependTo(details_tab);
	},
});
