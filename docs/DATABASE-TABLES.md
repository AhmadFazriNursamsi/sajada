# Tabel PostgreSQL Sajada v0.42

Dihasilkan dari schema lengkap yang berhasil dieksekusi pada PGlite, tanpa data operasional.

| Tabel | Kolom | Foreign key | Policy RLS | Trigger aplikasi |
|---|---:|---:|---:|---:|
| capital_account | 11 | 1 | 1 | 1 |
| capital_wallet_activation | 10 | 2 | 1 | 2 |
| capital_wallet_payment | 10 | 4 | 1 | 3 |
| capital_wallet_refund | 11 | 4 | 1 | 3 |
| inventory_balance | 6 | 2 | 1 | 0 |
| inventory_config | 4 | 2 | 1 | 1 |
| inventory_document | 6 | 2 | 1 | 1 |
| inventory_location | 9 | 4 | 1 | 1 |
| inventory_movement | 11 | 2 | 1 | 1 |
| investor | 3 | 1 | 1 | 0 |
| journal | 5 | 1 | 1 | 2 |
| journal_line | 6 | 1 | 1 | 2 |
| member | 7 | 3 | 1 | 0 |
| member_number | 10 | 1 | 1 | 1 |
| member_number_counter | 3 | 1 | 1 | 1 |
| order_item | 6 | 2 | 1 | 1 |
| outbox | 8 | 1 | 1 | 0 |
| product | 7 | 1 | 1 | 0 |
| profit_report | 23 | 2 | 1 | 3 |
| purchase_confirmation | 5 | 1 | 1 | 2 |
| purchase_inspection | 5 | 2 | 1 | 2 |
| purchase_invoice | 6 | 3 | 1 | 2 |
| purchase_order | 6 | 3 | 1 | 2 |
| purchase_payment | 5 | 2 | 1 | 2 |
| purchase_receipt | 4 | 2 | 1 | 1 |
| purchase_replacement | 6 | 2 | 1 | 2 |
| purchase_replacement_reversal | 4 | 1 | 1 | 2 |
| purchase_supplier | 3 | 1 | 1 | 1 |
| region | 5 | 1 | 0 | 0 |
| reorder_policy | 5 | 3 | 1 | 0 |
| sales_order | 23 | 3 | 1 | 4 |
| tenant | 3 | 0 | 0 | 0 |
