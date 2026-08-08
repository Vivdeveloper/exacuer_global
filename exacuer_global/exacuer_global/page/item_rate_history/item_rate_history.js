frappe.pages['item-rate-history'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Purchase & Sales Price History',
        single_column: true
    });

    const filters = {
        item: [],
        item_group: '',
        supplier: '',
        customer: '',
        company: frappe.defaults.get_default('company') || '',
        date_range: 'Last 3 Months',
        selected_date_range: [frappe.datetime.month_start(), frappe.datetime.now_date()]
    };

    // ---------------- Filter Section ----------------
    this.form = new frappe.ui.FieldGroup({
        fields: [
            { fieldtype: 'MultiSelectList', label: 'Item', fieldname: 'item', options: 'Item',
              get_data: (txt) => frappe.db.get_link_options('Item', txt),
              onchange: function () { filters.item = this.values; fetch_data(); } },
            { fieldtype: 'Column Break' },
            { fieldtype: 'Link', label: 'Item Group', fieldname: 'item_group', options: 'Item Group',
              onchange: function () { filters.item_group = this.value; fetch_data(); } },
            { fieldtype: 'Column Break' },
            { fieldtype: 'Link', label: 'Supplier', fieldname: 'supplier', options: 'Supplier',
              onchange: function () { filters.supplier = this.value; fetch_data(); } },
            { fieldtype: 'Column Break' },
            { fieldtype: 'Link', label: 'Customer', fieldname: 'customer', options: 'Customer',
              onchange: function () { filters.customer = this.value; fetch_data(); } },
            { fieldtype: 'Column Break' },
            { fieldtype: 'Select', label: 'Date Range', fieldname: 'date_range',
              options: ['Last Week','Last Month','Last 3 Months','Last Year','Select Date Range'],
              default: filters.date_range,
              onchange: function () { filters.date_range = this.value; fetch_data(); } },
            { fieldtype: 'Date Range', label: 'Select Date Range', fieldname: 'selected_date_range',
              depends_on: "eval:doc.date_range == 'Select Date Range'"},
            { fieldtype: 'Button', label: 'Refresh', fieldname: 'refresh_button', click: fetch_data }
        ],
        body: this.page.body,
    });
    this.form.make();

    // ---------------- CSS ----------------
    $(`<style>
        body, .page-content, .page-body {
            font-family:Inter, "Helvetica Neue", Arial, sans-serif;
            font-size:13px;
            color:#111827;
        }
        .item-cards { display:flex; flex-direction:column; gap:15px; }
        .item-card {
            display:flex; background:#fff;
            border:1px solid #e5e7eb; border-radius:8px;
            overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.05);
        }
        .item-card .left {
            width:180px; padding:12px;
            background:#f9fafb; text-align:center;
            border-right:1px solid #e5e7eb;
        }
        .item-card .left img {
            max-width:100%; max-height:100px;
            object-fit:contain; margin-bottom:8px;
            border:1px solid #e5e7eb; border-radius:6px;
        }
        .item-card .left h5 { font-size:14px; font-weight:600; margin:0; }
        .item-card .left span { font-size:12px; color:#6b7280; }
        .item-card .right {
            flex:1;
            display:grid;
            grid-template-columns: 1fr 1fr;
            gap:15px;
            padding:12px;
            width:100%;
        }
        .item-card .history {
            background:#fff;
            border:1px solid #e5e7eb;
            border-radius:6px;
            max-height:250px;
            overflow-y:auto;
            padding:0;
        }
        .item-card .history h6 {
            font-size:13px; font-weight:600;
            margin:0; padding:8px;
            border-bottom:1px solid #e5e7eb;
        }
        .item-card .summary {
            display:flex; flex-wrap:wrap; gap:16px;
            font-size:12px; color:#374151;
            padding:8px;
            background:#fafafa;
            border-bottom:1px solid #e5e7eb;
        }
        .item-card .summary div { min-width:100px; }
        .item-card .summary span { font-weight:600; }
        .summary .positive { color:#16a34a; font-weight:600; }
        .summary .negative { color:#dc2626; font-weight:600; }
        .item-card table { width:100%; border-collapse:collapse; font-size:12px; }
        .item-card th {
            background:#f3f4f6; padding:6px;
            text-align:left; font-size:12px; font-weight:600;
            border-bottom:1px solid #e5e7eb;
            position:sticky; top:0; z-index:2;
        }
        .item-card td { padding:6px; border-bottom:1px solid #f0f0f0; }
        .item-card tr:nth-child(even) { background:#fafafa; }
        .item-card .history.purchase .rate-up { color:#dc2626; font-weight:600; }
        .item-card .history.purchase .rate-down { color:#16a34a; font-weight:600; }
        .item-card .history.sales .rate-up { color:#16a34a; font-weight:600; }
        .item-card .history.sales .rate-down { color:#dc2626; font-weight:600; }
        .item-card a:hover { text-decoration:underline; }
    </style>`).appendTo(page.main);

    // ---------------- Item Cards ----------------
    const item_card_container = $('<div class="item-cards"></div>').appendTo(page.main);

    function render_history(rows, type='purchase') {
        let prev = null;
        return (rows || []).map(h => {
            let raw = h.raw_rate ?? h.rate ?? null;
            let cur = Number(raw);
            if (!isFinite(cur)) {
                const parsed = parseFloat(String(raw || "").replace(/[^0-9.-]+/g, ""));
                cur = isFinite(parsed) ? parsed : null;
            }
            let cls = "";
            if (prev !== null && cur !== null) {
                cls = cur > prev ? "rate-up" : cur < prev ? "rate-down" : "";
            }
            if (cur !== null) prev = cur;

            // clickable invoice link
            let doctype = type === 'purchase' ? "Purchase Invoice" : "Sales Invoice";
            let invoice_link = `<a href="/app/Form/${doctype}/${h.invoice}" target="_blank">${h.invoice}</a>`;

            return `<tr>
                <td>${h.date}</td>
                <td>${h.party}</td>
                <td>${invoice_link}</td>
                <td class="${cls}">${h.rate}</td>
            </tr>`;
        }).join("");
    }

    function render_item_cards(items = []) {
        item_card_container.empty();
        items.forEach(it => {
            const purchase = render_history(it.purchase_history || [], 'purchase');
            const sales = render_history(it.sales_history || [], 'sales');

            const purchase_summary = it.summary.purchase || {};
            const sales_summary = it.summary.sales || {};

            const formatChange = (val) => {
                if (!val) return "-";
                const num = parseFloat(val);
                if (isNaN(num)) return val;
                return num > 0
                    ? `<span class="positive">${val}</span>`
                    : num < 0
                    ? `<span class="negative">${val}</span>`
                    : val;
            };

            item_card_container.append(`
                <div class="item-card">
                    <div class="left">
                        <img src="${it.image || '/assets/frappe/images/no-image.jpg'}">
                        <h5>${it.item_name}</h5>
                        <span>${it.item_code}</span>
                    </div>
                    <div class="right">
                        <div class="history purchase">
                            <h6>Purchase History</h6>
                            <div class="summary">
                                <div><span>Last Rate:</span> ${purchase_summary.last_rate || "-"}</div>
                                <div><span>Highest:</span> ${purchase_summary.highest || "-"}</div>
                                <div><span>Lowest:</span> ${purchase_summary.lowest || "-"}</div>
                                <div><span>% Change:</span> ${formatChange(purchase_summary.pct_change)}</div>
                            </div>
                            <table>
                                <thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th>Rate</th></tr></thead>
                                <tbody>${purchase || '<tr><td colspan="4">No Data</td></tr>'}</tbody>
                            </table>
                        </div>
                        <div class="history sales">
                            <h6>Sales History</h6>
                            <div class="summary">
                                <div><span>Last Rate:</span> ${sales_summary.last_rate || "-"}</div>
                                <div><span>Highest:</span> ${sales_summary.highest || "-"}</div>
                                <div><span>Lowest:</span> ${sales_summary.lowest || "-"}</div>
                                <div><span>% Change:</span> ${formatChange(sales_summary.pct_change)}</div>
                            </div>
                            <table>
                                <thead><tr><th>Date</th><th>Customer</th><th>Invoice</th><th>Rate</th></tr></thead>
                                <tbody>${sales || '<tr><td colspan="4">No Data</td></tr>'}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `);
        });
    }

    // ---------------- Fetch ----------------
    function fetch_data() {
        frappe.call({
            method: 'exacuer_global.exacuer_global.page.item_rate_history.item_rate_history.get_price_history',
            args: { filters },
            freeze: true,
            callback: function (r) {
                frappe.dom.unfreeze();
                if (!r.message) return;
                render_item_cards(r.message.item_cards || []);
            }
        });
    }

    fetch_data();
};
