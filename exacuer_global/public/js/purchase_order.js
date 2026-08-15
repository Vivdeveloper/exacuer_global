// The supplier's Stats strip on the Purchase Order form. See party_stats.js.
//
// The party is the supplier, not the `customer` field a drop-ship order also
// carries: what is owed here is owed by us.

exacuer_global.party_stats.setup({
	doctype: "Purchase Order",
	party_field: "supplier",
	party_doctype: "Supplier",
});
