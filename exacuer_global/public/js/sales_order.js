// The customer's Stats strip and trading history on the Sales Order form.
// See party_stats.js and order_history.js.
//
// Called optionally so that a shared script failing to load — a desk tab opened
// before this app was deployed, say — costs one feature rather than both.

exacuer_global.party_stats?.setup({
	doctype: "Sales Order",
	party_field: "customer",
	party_doctype: "Customer",
});

exacuer_global.order_history?.setup({
	doctype: "Sales Order",
	party_field: "customer",
	button: __("Order History"),
	sources: [
		{
			doctype: "Sales Order",
			date_field: "transaction_date",
			title: __("Sales Order Items"),
			id_label: __("Order"),
		},
		{
			doctype: "Sales Invoice",
			date_field: "posting_date",
			title: __("Sales Invoice Items"),
			id_label: __("Invoice"),
			// A credit note carries negative quantities at the original rate,
			// which would read as a sale that never happened.
			filters: { is_return: 0 },
		},
	],
});
