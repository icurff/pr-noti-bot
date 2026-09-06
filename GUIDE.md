# Repo Relay — Hướng dẫn sử dụng

> Bot tự host kết nối GitHub Webhook → Discord, gửi thông báo PR, CI, Review, Deploy, Release, Security.

---

## Yêu cầu

- Node.js >= 20.6.0
- Discord Bot Token
- Discord Channel ID (nơi nhận thông báo)
- GitHub repository (để cài webhook)

---

## Cài đặt

```bash
git clone <repo-url>
cd repo-relay
npm install
```

---

## Cấu hình

Tạo file `.env` tại root project:

```env
# Discord Bot Token — lấy tại https://discord.com/developers/applications
DISCORD_BOT_TOKEN=your_bot_token_here

# Discord Channel IDs
DISCORD_CHANNEL_PRS=123456789012345678        # bắt buộc
# DISCORD_CHANNEL_ISSUES=                     # để trống → dùng chung kênh PRS
# DISCORD_CHANNEL_RELEASES=
# DISCORD_CHANNEL_DEPLOYMENTS=
# DISCORD_CHANNEL_SECURITY=

# GitHub Token (không bắt buộc — dùng để xem chi tiết CI step)
# GITHUB_TOKEN=

# GitHub Webhook Secret (khuyến nghị)
# GITHUB_WEBHOOK_SECRET=your_secret_here

# Server (mặc định: port 3000, host 0.0.0.0)
# PORT=3000
# HOST=0.0.0.0
# WEBHOOK_PATH=/webhook
```

> **Tip:** Nếu chỉ có 1 kênh Discord, chỉ cần điền `DISCORD_CHANNEL_PRS`. Mọi thông báo sẽ gửi vào đó.

---

## Tạo Discord Bot

1. Vào [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Tab **Bot** → **Reset Token** → copy token → dán vào `.env`
3. Tab **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Manage Threads`, `Embed Links`, `Read Message History`
4. Copy URL → mở trình duyệt → mời bot vào server Discord

---

## Lấy Channel ID

1. Discord → Settings → Advanced → bật **Developer Mode**
2. Chuột phải vào kênh → **Copy Channel ID**
3. Dán vào `DISCORD_CHANNEL_PRS` trong `.env`

---

## Chạy

```bash
# Dev (tự reload khi sửa code)
npm run dev

# Production
npm run build
npm start
```

Server chạy tại `http://0.0.0.0:3000`

---

## Cài GitHub Webhook

1. GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**: `http://<IP_SERVER>:3000/webhook`
3. **Content type**: `application/json`
4. **Secret**: giá trị của `GITHUB_WEBHOOK_SECRET` (khuyến nghị)
5. **Events** cần chọn:
   - ✅ Pull requests, Pull request reviews
   - ✅ Workflow runs
   - ✅ Issues, Releases
   - ✅ Deployment statuses, Pushes
   - ✅ Dependabot alerts, Secret scanning alerts, Code scanning alerts

---

## Tính năng & Các Sự Kiện Hỗ Trợ

| Event GitHub | Hành động & Vị trí thông báo trên Discord | Image Pool Sử Dụng |
|---|---|:---:|
| `pull_request` (opened, reopened) | Tạo Embed PR với Diff Bar `🟩🟩🟩🟥` trên kênh chính + Mở Thread riêng theo dõi tiến độ | — |
| `pull_request` (closed & merged) | Chuyển Embed chính sang màu tím `[MERGED]` + Gửi tin nhắn ăn mừng vào Thread | **`merged`** |
| `pull_request_review` (approved) | Cập nhật mục Review trên Embed chính + Reply vào Thread thông báo Approved kèm link | **`approved`** |
| `pull_request_review` (changes_requested) | Cập nhật mục Review màu vàng cam + Reply vào Thread yêu cầu sửa code | **`needs_work`** |
| `workflow_run` (conclusion: success) | Cập nhật mục CI Status trên Embed chính + Reply chúc mừng vào Thread | **`merged`** |
| `workflow_run` (conclusion: failure) | Đổi CI Status màu đỏ + Reply báo lỗi (kèm chi tiết các step thất bại nếu có) | **`needs_work`** |
| `issues` (opened, closed, reopened) | Tạo tin nhắn Embed Issue riêng trên kênh chỉ định kèm Thread thảo luận | — |
| `release` (published) | Gửi Embed thông tin Release mới + Gắn ảnh thumbnail chúc mừng | **`merged`** |
| `deployment_status` (success) | Gửi Embed trạng thái triển khai thành công | **`merged`** |
| `deployment_status` (failure) | Gửi Embed cảnh báo triển khai thất bại | **`needs_work`** |
| `push` (to default branch) | Gửi danh sách các commits vừa được push | — |
| `dependabot_alert`, `secret_scanning_alert`, `code_scanning_alert` | Gửi Embed cảnh báo bảo mật khẩn cấp | **`needs_work`** |

---

## Chi Tiết Các Image Pools (Kho GIF Phản Ứng)

Hệ thống phân chia toàn bộ ảnh GIF phản ứng thành **4 nhóm chuẩn** (tương tự [example webex-bot](./example/webex-bot/routes/hook.js)). Các sự kiện trọng tâm sẽ bốc ngẫu nhiên một ảnh trong pool tương ứng từ database SQLite để gửi vào Discord:

### 1. 🔀 Pool `opened` — Mở PR Mới / Bắt Đầu Code (Kho Lưu Trữ Mở Rộng)
- **Cảm xúc / Ý nghĩa**: Hăng hái, quyết tâm, năng lượng tích cực khi bắt đầu một tính năng mới.
- **Trạng thái**: Lưu trữ sẵn trong kho media của bot để quản trị viên có thể cấu hình hoặc dùng cho các kịch bản mở rộng trong tương lai. Tin nhắn mở đầu luồng PR (`Updates for PR #... will appear here.`) được giữ dạng văn bản thuần gọn gàng, không đính kèm GIF để tránh làm loãng nội dung luồng.
- **Ví dụ ảnh mẫu trong kho**:
  - *Let's Do This* (`LmN8OYiY4m0X85K0Zz`)
  - *Hacker Fast Typing* (`b5LTssxCLpvVe`)
  - *Cat Coding Focus* (`unQ3IJU2RG7DO`)
  - *Clapping Applause* (`nbvFVPiEiJH6JOGIok`)

### 2. 👍 Pool `approved` — Review Phê Duyệt / LGTM
- **Cảm xúc / Ý nghĩa**: Đồng tình, tán thành, "Look Good To Me", khen ngợi chất lượng code.
- **Trường hợp kích hoạt**:
  - Khi Reviewer gửi đánh giá chấp thuận PR (`pull_request_review` với state `approved`).
- **Vị trí hiển thị**: Reply trực tiếp vào luồng (Thread) của PR kèm badge màu xanh Emerald và nút bấm dẫn đến trang Review trên GitHub.
- **Ví dụ ảnh mẫu trong kho**:
  - *Approved Stamp* (`XreQmk7ETCak0`)
  - *Nod of Approval* (`NEvPzZ8bdvtxG`)
  - *Chuck Norris Thumbs Up* (`diUKszNTUghVe`)

### 3. 🚀 Pool `merged` — Hợp Nhất Thành Công / Ăn Mừng / Hoàn Tất
- **Cảm xúc / Ý nghĩa**: Ăn mừng chiến thắng, pháo hoa, nâng ly chúc mừng tính năng đã được ship lên production.
- **Trường hợp kích hoạt**:
  - Khi PR được merge vào nhánh chính (`pull_request.closed` với `merged: true`).
  - Khi quy trình CI kiểm thử vượt qua tất cả các bài test (`workflow_run` với kết quả `success`).
  - Khi triển khai môi trường thành công (`deployment_status.success`).
  - Khi phát hành phiên bản mới (`release.published`).
- **Vị trí hiển thị**:
  - Banner ảnh lớn nằm dưới cùng của Embed PR chính khi PR chuyển sang trạng thái `[MERGED]`.
  - Reply ăn mừng trong Thread PR: `🎉 PR Merged to main by @author!`.
  - Embed thông báo CI pass và thumbnail bản phát hành Release.
- **Ví dụ ảnh mẫu trong kho**:
  - *Minions Cheering* (`26u4cqiYI30juCOGY`)
  - *High Five Victory* (`artj92V8o75VPL7AeQ`)
  - *Leo DiCaprio Toast* (`3o7abKhOpu0NwenH3O`)
  - *Office Dancing* (`DhstvI3CH03yOTXRjs`)
  - *Borat Great Success* (`10uEX5kfeodYgo`)
  - *Party Confetti Poppers* (`ely3apij36BJhoZ234`)

### 4. ⚠️ Pool `needs_work` — Cần Sửa Đổi / Báo Lỗi / Cảnh Báo
- **Cảm xúc / Ý nghĩa**: Soi bug cẩn thận, yêu cầu kiểm tra lại, cảnh báo sự cố hài hước để giảm căng thẳng.
- **Trường hợp kích hoạt**:
  - Khi Reviewer yêu cầu chỉnh sửa code (`pull_request_review` với state `changes_requested`).
  - Khi quy trình CI kiểm thử bị rớt hoặc build lỗi (`workflow_run` với kết quả `failure`, `timed_out`, `startup_failure`).
  - Khi triển khai hệ thống thất bại (`deployment_status.failure`).
  - Khi phát hiện lỗ hổng bảo mật hoặc rò rỉ mã bí mật (`dependabot_alert`, `secret_scanning_alert`, `code_scanning_alert`).
- **Vị trí hiển thị**:
  - Reply cảnh báo trong Thread PR kèm badge màu vàng cam (Changes Requested) hoặc màu đỏ (CI Failed).
  - Thumbnail cảnh báo bảo mật trên kênh bảo mật.
- **Ví dụ ảnh mẫu trong kho**:
  - *This Is Fine Dog* (`QMHoU66sBXCAHonOmG`)
  - *Keyboard Smash* (`oOTTyHRHj0HYY`)
  - *Hold Up Wait A Minute* (`puOukoEvH4uAw`)
  - *No No Wagging Finger* (`3o7TKwmnDgQb5jemjK`)
  - *Inspecting Bug* (`3gNotAoIRZsb9UHPnj`)
  - *Deep Thinking Question* (`l4pT0NtPSMV3pwJ20`)

---

## Quản Lý Kho GIF (Dashboard UI & REST API)

Bạn có thể quản lý trực quan qua **Web Dashboard** tại `http://localhost:3000` (Tab *🎬 Quản Lý Kho GIF*) hoặc gọi trực tiếp qua REST API:

### REST API Endpoints

```bash
# Xem danh sách ảnh (hoặc lọc theo danh mục: opened, approved, merged, needs_work)
GET /api/media
GET /api/media?category=opened
GET /api/media?category=approved
GET /api/media?category=merged
GET /api/media?category=needs_work

# Thêm một ảnh GIF mới vào kho
POST /api/media
Content-Type: application/json

{
  "category": "opened",
  "url": "https://media.giphy.com/media/.../giphy.gif",
  "title": "Mô tả gợi nhớ của ảnh"
}

# Xóa một ảnh khỏi kho theo ID
DELETE /api/media/12
```

---

## Giao Diện Web Dashboard (`http://localhost:3000`)

Khi mở trình duyệt tại địa chỉ chạy bot, bạn có sẵn trang quản trị:
1. **📊 Tổng quan (Dashboard)**: Xem trạng thái bot (Online/Connecting, Ping ms), tổng số ảnh GIF, số lượng chi tiết của từng Pool (Mở PR, Phê Duyệt, Đã Merge, Cần Sửa), và nhật ký các sự kiện Webhook gần nhất.
2. **🎬 Quản lý kho GIF**: Bộ lọc theo từng danh mục, xem trước ảnh, nút Copy link, nút Xóa, và Modal thêm GIF mới có xem trước ảnh trực tiếp (Live Preview).
3. **🧪 Mô phỏng Webhook (Simulator)**: Bấm các nút thử nghiệm để bắn trực tiếp các sự kiện mẫu vào Discord mà không cần chờ GitHub webhook thật.
4. **⚙️ Cấu hình & Giám sát**: Hiển thị Webhook Endpoint URL đầy đủ (`http://<domain>/webhook`), trạng thái xác thực HMAC Secret, ID các kênh Discord đang lắng nghe, và phiên bản môi trường thực thi.

---

## Mô Phỏng Webhook Nhanh (Simulator)

Hệ thống tích hợp sẵn bộ phát sinh payload mẫu (Mock Generator) trực tiếp trong mã nguồn, **hoạt động độc lập ngay lập tức mà không cần bất kỳ file ngoài nào**. Đồng thời thư mục `test-events/` cũng được tạo sẵn 6 file JSON chuẩn để bạn có thể xem và tùy biến:

```bash
POST /api/test
Content-Type: application/json

{ "scenario": "open", "prNumber": 105 }
```

| Mã Kịch Bản (`scenario`) | Sự Kiện GitHub Giả Lập | Kết Quả Trên Discord |
|---|---|---|
| `open` | `pull_request` (opened) | Tạo Embed PR mới màu Emerald kèm Diff Bar + Thread có GIF `opened` |
| `ci` | `workflow_run` (success) | Đổi CI sang xanh ✅ + Reply vào Thread kèm GIF `merged` ăn mừng |
| `ci-fail` | `workflow_run` (failure) | Đổi CI sang đỏ ❌ + Reply vào Thread kèm GIF `needs_work` hài hước |
| `approve` | `pull_request_review` (approved) | Cập nhật Review ✅ + Reply vào Thread kèm GIF `approved` |
| `changes` | `pull_request_review` (changes_requested) | Cập nhật Review ⚠️ + Reply yêu cầu sửa kèm GIF `needs_work` |
| `merge` | `pull_request` (closed, merged: true) | Đổi Embed sang tím hoàng gia `[MERGED]` + Banner pháo hoa ăn mừng |

---

## Cấu trúc project

```
.env                  ← cấu hình (tạo file này)
src/
  config/
    index.ts          ← đọc biến môi trường
    channels.ts       ← routing event → channel
  routes/
    webhook.ts        ← POST /webhook
    api.ts            ← /api/* endpoints
  embeds/
    media.ts          ← 4 GIF categories
    builders.ts       ← Discord embed builders
  handlers/           ← xử lý từng loại event GitHub
  db/state.ts         ← SQLite state management
  server.ts           ← entry point
public/               ← Web Dashboard UI
```

---

## Lỗi thường gặp

**Bot không kết nối Discord** — kiểm tra `DISCORD_BOT_TOKEN` trong `.env`

**Webhook không nhận** — đảm bảo server public (dùng ngrok để test local), kiểm tra `GITHUB_WEBHOOK_SECRET`

**Bot thiếu quyền** — mời lại bot với đủ permissions

**`DISCORD_CHANNEL_PRS` bắt buộc** — để trống bot sẽ không khởi động
