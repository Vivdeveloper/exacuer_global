// The supplier's Stats strip and trading history on the Purchase Invoice form.
// See party_stats.js and order_history.js.

exacuer_global.party_stats?.setup({
	doctype: "Purchase Invoice",
	party_field: "supplier",
	party_doctype: "Supplier",
});

exacuer_global.order_history?.setup({
	doctype: "Purchase Invoice",
	party_field: "supplier",
	button: __("Purchase History"),
	sources: [
		{
			doctype: "Purchase Order",
			date_field: "transaction_date",
			title: __("Purchase Order Items"),
			id_label: __("Order"),
		},
		{
			doctype: "Purchase Invoice",
			date_field: "posting_date",
			title: __("Purchase Invoice Items"),
			id_label: __("Invoice"),
			// A debit note carries negative quantities at the original rate,
			// which would read as a purchase that never happened.
			filters: { is_return: 0 },
		},
	],
});
