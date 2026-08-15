// The customer's Stats strip on the Sales Invoice form. See party_stats.js.
//
// Total Unpaid counts this invoice once it is submitted, exactly as it does on
// the Customer form.

exacuer_global.party_stats.setup({
	doctype: "Sales Invoice",
	party_field: "customer",
	party_doctype: "Customer",
});
