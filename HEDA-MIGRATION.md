# HeDa wallet report migration

Version 1.1.0 supports the inspected wallet-report layout with a Vietnamese overview and individual wallet sheets. Source workbooks and generated previews stay in ignored `private-data/`; no personal data is embedded in the program, public assets or tests.

Import all relevant yearly files together through Settings → Nhập Excel HeDa. The preview verifies chronological running balances, year-to-year opening/closing balances, cash-in/out totals, ordinary income/expense totals, two-sided transfers, fees, debt cash flows and the newest overview's assets/net worth. Complete raw rows are stored separately with source file hashes and links to transformed transactions.

Transfer legs and fees become one transfer; debt collections may become several payment entries when allocated across loans. Logical transaction count can therefore differ from original row count without losing any original record. Selecting the same data again, including under a renamed file, does not create new records.

The current export does not identify the original loan for a collection/repayment. FIFO allocation by person and direction requires explicit approval. A wallet referenced in a transfer but absent from the source ledger requires separate approval; it stays archived, excluded from assets and marked with an unverified opening balance. The zero baseline for its known movements is not presented as a verified actual balance.

Older overview snapshots may conflict with their own wallet figures. Those contradictions are retained in the report; detailed historical ledgers are checked independently and current balances use the latest reporting period with a matching overview. Missing source information is never labeled verified.

Database schema v4 adds the source-row table without recreating existing financial records. v2/v3 backups are validated and upgraded, and v4 backups include the complete source mapping and reconciliation report. Imports add missing IDs atomically, preserve existing data and preferences, and roll back on any failed write or validation.

Validation includes synthetic fixtures for paired transfers/fees, subcategories, FIFO splits, missing-wallet handling, consent guards, broken balances, duplicate imports, write rollback, source provenance after deletion, backup roundtrip and v3-to-v4 upgrades. Browser tests cover preview/approval gates, import, displayed balances, raw-source inspection and reimport on Chrome desktop/mobile and WebKit.
