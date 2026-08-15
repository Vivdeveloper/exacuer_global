// The supplier's Stats strip on the Purchase Invoice form. See party_stats.js.

exacuer_global.party_stats.setup({
	doctype: "Purchase Invoice",
	party_field: "supplier",
	party_doctype: "Supplier",
});
