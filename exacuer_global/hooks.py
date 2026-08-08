app_name = "exacuer_global"
app_title = "Exacuer Global"
app_publisher = "Vivek Choudhary"
app_description = "Exacuer Global"
app_email = "choudharyvivek195@gmail.com"
app_license = "mit"

# Publish the chat key into frappe.boot so the floating widget can load on Desk.
#
# The widget's script and its API live in exacuer_support, on the helpdesk. This app
# owns the *customer* side: Exacuer Helpdesk Settings holds the pasted snippet, and
# chat_boot parses the key and origin out of it.
#
# app_include_js stays in exacuer_support, which owns /assets/exacuer_support/js/
# chat_embed.js — moving that path would break every snippet already pasted on a
# customer's site. So a Desk launcher needs both apps installed; with only one, the
# widget quietly does nothing rather than half-loading.
boot_session = [
    "exacuer_global.chat_boot.add_chat_key",
]
