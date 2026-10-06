# Mộc · Personal Finance PWA

Ứng dụng tài chính cá nhân bằng tiếng Việt, lưu dữ liệu trong IndexedDB. Không backend, tài khoản, analytics, quảng cáo hoặc subscription. App có giao diện riêng và không dùng tài sản thương hiệu HeDa.

## Chạy dự án

Node.js 22+ và pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm preview --port 4173
```

Trên Windows trong môi trường Codex này, có thể dùng runtime được đóng gói sẵn khi pnpm chưa nằm trong PATH:

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

`start.ps1` kiểm tra TypeScript, build production và mở máy chủ tại **http://localhost:4173**. Script không chỉnh, xóa hay seed database. Dùng `pnpm dev` khi sửa code; dùng bản build/preview để kiểm tra service worker offline. Database gắn với **origin**: đổi hostname, protocol hoặc port sẽ mở một database khác.

## Các phần đã xây

- Tổng quan: tổng tài sản hiện tại, tiền mặt, tài khoản/tài sản khác, thu chi theo tháng, ngân sách, dư nợ, lịch sử và biểu đồ từ dữ liệu thật.
- Ví: tạo/sửa, mặc định, lưu trữ/mở lại, lịch sử, chuyển tiền, điều chỉnh số dư, loại khỏi tổng tài sản. Ví có lịch sử không được sửa số dư đầu kỳ hay xóa.
- Giao dịch: chi, thu, chuyển khoản, vay, cho vay, điều chỉnh; tạo/sửa, nhân bản, tìm kiếm, phân trang 40 dòng, lọc ngày/loại/ví/danh mục/sự kiện/tag. Nhập biểu thức tiền bằng parser, không dùng `eval`.
- Danh mục: thu/chi, danh mục con, đổi tên, màu/icon, lưu trữ, kéo sắp xếp và nút lên/xuống, gộp tham chiếu trước khi xóa.
- Ngân sách theo tháng, theo danh mục hoặc tổng; nhiều ngân sách, sao chép tháng trước, mức gần giới hạn/vượt, lịch sử qua bộ chọn tháng.
- Thống kê: thu chi, danh mục, xu hướng theo ngày/tháng, số dư ví, tài sản ròng, ngân sách/thực tế, top khoản chi, bình quân, so sánh tháng, cùng tháng năm trước và tổng năm với năm trước. Bấm cột/danh mục để mở giao dịch.
- Nợ: một thẻ cho mỗi người trong từng nhóm vay/cho vay, cộng tổng gốc và số còn lại, hạn trả/trạng thái quá hạn, chi tiết từng khoản và lịch sử thanh toán. Thanh toán một phần/toàn bộ theo tổng người được phân bổ FIFO và ghi atomic vào ví. Tên được chuẩn hóa khoảng trắng, chữ hoa/thường và Unicode; giữ phân biệt dấu tiếng Việt.
- Sự kiện: thu/chi dự kiến, tổng thực tế, chênh lệch, danh mục và lịch sử giao dịch.
- Tags: tạo, đổi tên đồng bộ giao dịch, lọc, xóa nhãn mà giữ giao dịch.
- Định kỳ: ngày/tuần/tháng/năm/khoảng ngày, tự tạo lúc mở app hoặc kiểm tra thủ công; bắt kịp các kỳ thiếu, chống trùng và giữ ngày 29/30/31 sau tháng ngắn.
- Thùng rác: soft delete, khôi phục, xóa vĩnh viễn hoặc dọn toàn bộ với xác nhận.
- Cài đặt: sáng/tối/theo thiết bị, VND, định dạng ngày/số, ngày đầu tuần được lưu làm tùy chọn; bộ chọn ngày native tuân theo lịch của trình duyệt. About có phiên bản app/DB, số giao dịch và ước tính dung lượng origin.
- Backup/restore JSON, Excel export đầy đủ các bảng, generic Excel import có ánh xạ, kiểm tra từng dòng, chống trùng và đối chiếu batch.
- Manifest, icon riêng, service worker cache app, cập nhật cần chủ động xác nhận, safe area và bottom navigation.

PIN local, ảnh hóa đơn và thao tác swipe là các tùy chọn chưa bật; không có nút giả cho chúng trong app.

## Kế toán và bảo toàn dữ liệu

`src/finance.ts` định nghĩa các biến động ví. Số dư = **openingBalance + toàn bộ bút toán còn hiệu lực**; không lưu một số `currentBalance` độc lập. `getBalances()`/`getWalletBalance()` tính lại từ sổ. Không có lệnh reset IndexedDB trong startup.

| Loại | Biến động ví | Báo cáo thu/chi |
| --- | --- | --- |
| Thu | +amount | Thu |
| Chi | −amount | Chi |
| Chuyển khoản | Ví gửi −amount; ví nhận +amount; ví phí −fee | Chỉ phí được tính là chi |
| Đi vay | +amount; tăng phải trả | Không tính thu |
| Cho vay | −amount; tăng phải thu | Không tính chi |
| Trả nợ | Ví −amount; giảm phải trả | Không tính chi |
| Thu nợ | Ví +amount; giảm phải thu | Không tính thu |
| Điều chỉnh | Chênh lệch số dư thực tế và sổ sách | Không tính thu/chi |

“Tổng tài sản” trên tổng quan là tổng các ví được chọn; “Tài sản ròng” trong thống kê cộng phải thu và trừ phải trả. Số dư đầu kỳ áp dụng làm mốc xuyên suốt lịch sử; nếu cần đối chiếu theo ngày, dùng bút toán điều chỉnh có ngày cụ thể.

Chuyển khoản được biểu diễn bằng một giao dịch với đủ các ví. Khoản nợ và bút toán gốc, thanh toán và lịch sử trả nợ, recurring occurrences và con trỏ lịch đều được ghi trong transaction IndexedDB. Xóa/khôi phục thanh toán thay đổi dư nợ thông qua bút toán; không chỉnh `remainingAmount` thủ công. Khoản nợ đã có thanh toán không được sửa bút toán gốc. Lưu trữ ví/danh mục sẽ dừng các lịch định kỳ liên quan; mở lại lịch là thao tác chủ động riêng.

Schema **v1 → v2 → v3** có migration bảo toàn ID. v2 thêm chỉ mục ví liên quan và khóa occurrence; v3 thêm `[date+time]` để sắp xếp đúng giờ. Các index gồm ngày, ví, danh mục, loại, sự kiện, deletedAt, tags, fingerprints và source ID. Danh sách không đưa toàn bộ lịch sử vào DOM; tổng hợp duyệt bằng cursor và biểu đồ thu chi dùng phạm vi ngày đã chọn.

## Backup và restore

Vào **Khác → Cài đặt & dữ liệu → Tải backup**. Giữ file JSON ở Files/iCloud Drive/ổ riêng do bạn chủ động chọn. App không tự upload.

Backup chứa schemaVersion, appVersion, exportedAt, checksum SHA-256 và 15 bảng, gồm cả thùng rác, khoản nợ, thanh toán, tags/quan hệ, import metadata, lịch định kỳ và settings. SHA-256 phát hiện hỏng/sửa file; backup **không được mã hóa**.

Restore kiểm tra checksum, kiểu/giá trị, ID trùng, liên kết, ví, danh mục, lịch và bút toán nợ **trước khi ghi**. Sau preview, chọn:

- **Gộp:** giữ settings hiện tại; nhận ID mới/bản ghi trùng khớp; dừng khi cùng ID nhưng nội dung khác hoặc tag cùng tên khác ID. Không tự chọn bên thắng.
- **Thay thế:** dùng snapshot đã xác thực, sau xác nhận riêng.

Mọi bảng được cập nhật trong một transaction; lỗi giữa chừng rollback toàn bộ. Backup v2/v3 được xác thực và nâng lên v4 mà giữ nguyên bản ghi. Backup có phiên bản mới chưa hỗ trợ bị từ chối.

Trình duyệt có thể xóa IndexedDB khi clear website data, reset thiết bị hoặc do chính sách lưu trữ. App nhắc backup, hiển thị lần gần nhất và có nút yêu cầu persistent storage. Hãy kiểm tra file đã thực sự lưu sau khi tải.

## Excel và HeDa

**Không có dữ liệu tài chính thật trong source hoặc bundle.** `.gitignore` loại `private-data/`, Excel/CSV và file backup. Đặt export HeDa vào `private-data/` khi cung cấp; không chép nó vào `public/` hoặc `src/`.

Xuất Excel có các sheet Transactions, Wallets, Categories, Budgets, Debts, DebtPayments, Recurring, Events, Tags, TransactionTags, ImportBatches, ImportIssues, Settings, BackupMetadata và Metadata. Transactions có tên ví, danh mục, sự kiện cùng các trường gốc. Excel dùng để đọc/tra cứu; **JSON backup** là định dạng khôi phục toàn bộ database.

Generic importer đọc cột do bạn chọn và định dạng ngày/số được xác nhận; hỗ trợ thu, chi, chuyển khoản, điều chỉnh. Ví mới có số dư đầu kỳ 0; cần đối chiếu riêng. Khoản nợ, bản ghi trong thùng rác và tiền tệ khác VND được đưa vào issues thay vì đoán. Không nhập batch khi còn dòng lỗi. ID gốc ưu tiên chống trùng; khi không có ID, fingerprint dùng nội dung và số lần xuất hiện để giữ các dòng giống nhau trong cùng file. Các dòng khớp lịch sử được báo rõ trong preview. Đối chiếu batch kiểm tra số giao dịch, tổng thu/chi và biến động ví; **không** đồng nghĩa đã đối chiếu số dư nguồn.

**HeDa wallet-report adapter đã có (v1.1.0, DB v4).** Chọn toàn bộ file năm cùng lúc trong Khác → Cài đặt → Nhập Excel HeDa. Adapter xác thực layout thực tế (overview và sheet từng ví), định dạng VND có dấu/comma và ngày dd/MM/yy HH:mm; kiểm tra mọi số dư sau giao dịch, tổng vào/ra, tính liên tục giữa các kỳ, ghép hai vế chuyển khoản và phí, danh mục cha/con, tổng thu/chi theo loại gốc và tài sản ròng.

Các loại điều chỉnh mà HeDa đã ghi thành Chi tiêu/Thu nhập được giữ nguyên loại nguồn để đối chiếu đúng tổng lịch sử; ghi chú gốc không bị diễn giải thành quy tắc nhập khác. Khi không có ID liên kết khoản nợ, màn preview yêu cầu xác nhận FIFO theo từng người. Ví chỉ được nhắc trong chuyển khoản nhưng không có sổ nguồn được lưu trữ, có `balanceVerified: false` và loại khỏi tổng tài sản sau xác nhận riêng. Giá trị 0 ở ví này chỉ là mốc kỹ thuật của biến động đã biết; UI ghi rõ chưa xác minh, và không cho tính vào tài sản trước khi đối chiếu số dư thực tế.

Schema v4 thêm bảng `hedaSourceRows` mà giữ nguyên các bảng/ID đã có. Mọi dòng nguồn được giữ riêng (gồm loại, ví, danh mục/con, ghi chú, số tiền có dấu, số dư sau, thời gian gốc, vị trí sheet/dòng và SHA-256 file) cùng liên kết đến một hoặc nhiều giao dịch. Ghép chuyển khoản hoặc tách thanh toán không làm mất dòng nguồn. Backup/Excel export chứa bảng này và báo cáo đối chiếu; backup v2/v3 được nâng an toàn lên v4. Xóa vĩnh viễn giao dịch bỏ liên kết đang sống và lưu ID đã xóa trong dấu vết nguồn, không tạo tham chiếu hỏng; bản ghi gốc vẫn là tài liệu nhập có thể tra cứu trong backup.

Preview không nhập khi còn lỗi, không ghi đè ví có số dư đầu kỳ xung đột và không nhân đôi các dòng đã có, kể cả file đổi tên. Dữ liệu mới được bổ sung trong một transaction; lỗi viết hoặc đối chiếu rollback toàn bộ. Báo cáo được lưu theo thời điểm nhập, gồm cả snapshot cũ tự mâu thuẫn hoặc thông tin không được export, không tuyên bố các mục thiếu nguồn đã xác minh. Bản ghi hiện có, cài đặt và giao dịch người dùng nhập sau đó được giữ nguyên.

## Kiểm thử

```sh
pnpm test
pnpm build
pnpm exec playwright install chrome webkit
pnpm test:e2e
```

Unit/integration tests dùng fake IndexedDB độc lập, kiểm tra kế toán, atomic operations, nợ, recurring, checksum, restore rollback, duplicate detection, Excel và migrations. Browser tests dùng context mới, không đụng database của trình duyệt đang sử dụng. Các bài kiểm tra gồm giao dịch, ví, filter, tags, ngân sách, khoản nợ, sự kiện, recurring, import/export, backup/restore và offline.

Benchmark riêng tạo **100.000 giao dịch**, xác minh số dư và tối đa 40 transaction nodes mỗi trang. Kết quả đo nằm trong `test-results/report.json` (không commit). Đây là đo trên máy kiểm thử, không phải cam kết thời gian trên mọi iPhone.

WebKit offline được kiểm tra bằng máy chủ nguồn dừng thật do [lỗi Playwright #42775](https://github.com/microsoft/playwright/issues/42775) làm `setOffline(true)` chặn cả phản hồi từ service worker. Chrome kiểm tra bằng `setOffline`. Vẫn cần một lượt cài Add to Home Screen và sử dụng trực tiếp trên iPhone thật trước khi chuyển toàn bộ sổ lịch sử.

Development tools chỉ tồn tại trong development: seed 90/1k/10k/100k dữ liệu mẫu khi chưa có ví/giao dịch; kiểm tra lại số dư. Không tự seed vào production. Reset cần gõ `XÓA TẤT CẢ`.

## Deploy static

`dist/` là toàn bộ chương trình static. Router hash (`/#/transactions`) và `base: './'` hỗ trợ hosting trong subpath và refresh mà không cần backend rewrite.

**GitHub Pages:** tạo repository, push source đã kiểm tra không chứa tài chính thật, chọn Settings → Pages → Source: GitHub Actions. Chạy workflow **Deploy static PWA to GitHub Pages** bằng tay trong Actions. Workflow test/build trước khi deploy; không tự publish khi push. Workflow CI riêng test/build khi push/PR.

**Static hosting khác:** build command `pnpm build`, output directory `dist`, bật HTTPS. `_headers` cung cấp CSP/chính sách cache cho hosting hỗ trợ định dạng Netlify/Cloudflare; GitHub Pages không áp dụng file này. Không đặt file tài chính hoặc backup vào output public.

Trên iPhone/iPad: mở URL HTTPS trong **Safari → Chia sẻ → Thêm vào Màn hình chính**. Mở app từ icon, đợi tải lần đầu rồi thử bật chế độ máy bay. Dữ liệu ở từng thiết bị/trình duyệt là riêng biệt; dùng backup/restore để chuyển dữ liệu.

Repository triển khai: https://github.com/r0bjn10-maker/money. URL GitHub Pages khi bật thành công: https://r0bjn10-maker.github.io/money/. Các lần cập nhật được triển khai bằng workflow thủ công sau khi test/build đạt.

## Cấu trúc

```text
src/types.ts              Domain entities, versions
src/db.ts                 Dexie schema and migrations
src/finance.ts            Money/date parser and ledger math
src/services.ts           Atomic writes, queries and aggregations
src/backup.ts             Snapshot validation, checksum, restore
src/excel.ts              Workbook inspection, export, generic adapter
src/*.tsx                 Vietnamese UI and functional screens
tests/                    Logic, migrations and browser tests
public/                   Own icons and static headers
scripts/                  Windows setup/preview helpers
.github/workflows/        Verification and manually triggered hosting
```

Các phần lưu trữ, kế toán và adapter tách khỏi UI để có thể thêm backup cloud do người dùng chủ động, OCR, voice input hoặc nguồn ngân hàng sau này.
