// The customer's Stats strip on the Sales Order form. See party_stats.js.

exacuer_global.party_stats.setup({
	doctype: "Sales Order",
	party_field: "customer",
	party_doctype: "Customer",
});
