# Verification · 2026-10-06

Production build and TypeScript checks passed. The generated PWA precaches 21 program assets (approximately 1.5 MB uncompressed), with no financial dataset in static output.

## Automated checks

- **52 unit/integration tests passed**: ledger arithmetic, transfers/fees, adjustments, debt payment and rollback, trash/restore, recurring catch-up and concurrency, backup/checksum/merge/restore rollback, schema migrations, Excel inspection/parsing/validation and duplicate detection.
- **14 browser tests passed, 4 intentionally skipped** across desktop Chrome, iPhone-sized Chrome and iPhone-sized WebKit. The skips avoid repeating the scale benchmark on every browser and run the server-stopped offline test only on WebKit.
- Browser coverage includes persistence after refresh, filters, duplicate/edit actions, trash restoration, budgets, charts, transfers with a third-party fee wallet, lending/collection, events, tag renaming, recurring occurrences, generic import issue blocking/reimport, Excel download and backup replacement after explicit reset.
- Chrome offline reload passed with the network disabled. WebKit offline reload and a new transaction passed with its origin server stopped; see [Playwright issue 42775](https://github.com/microsoft/playwright/issues/42775) for why WebKit's `setOffline` emulator is unsuitable here.
- Follow-up chart verification checks that donut sectors are visible on all three configurations. Initial chart animation was disabled to show complete charts immediately during startup and viewport changes.

## Scale benchmark

Measured in an isolated desktop Chrome context on this workstation:

| Check | Result |
| --- | --- |
| Transactions | 100,000 |
| Seed write | 11,864 ms |
| Fresh first page, including reload | 307 ms |
| Wallet balance screen, including full ledger reduction | 1,938 ms |
| Transaction DOM rows per page | 40 |
| Derived closing balance | 100,000,000 VND, exact |

These measurements are not a guarantee for other devices. Backup/export intentionally read the full dataset to produce a complete snapshot; transaction rendering uses pagination and aggregations use cursors.

## Visual checks

Dashboard and statistics inspected at 1440 px desktop and 390 px portrait. Own icon assets, safe-area padding, bottom sheets, bottom navigation, money typography, charts and empty states are present. Screenshots use sample records in a disposable context and are stored in ignored `private-data/qa/`.

## Remaining source-dependent work

The real HeDa workbook has not been supplied. A format-specific adapter, full historical migration and source reconciliation cannot be verified until that file is inspected. Generic import does not assert source wallet/debt balances are verified.

Physical iPhone Add to Home Screen, OS-level storage eviction and install/update behavior should be checked on the target device before relying on the app for the complete historical ledger. No public deployment or GitHub push was performed during this build.
