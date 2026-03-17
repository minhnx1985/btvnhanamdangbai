# Telegram Sapo Bot

Bot Telegram nhan tieu de, noi dung va anh feature, sau do tao bai viet blog tren Sapo o trang thai nhap.

## Yeu cau

- Node.js 20+
- Tai khoan Telegram de tao bot voi BotFather
- Sapo private app credentials

## Cai dat

1. Cai dependencies:

```bash
npm install
```

2. Tao file `.env` tu mau:

```bash
cp .env.example .env
```

3. Dien day du cac bien moi truong.

## Tao bot Telegram voi BotFather

1. Mo Telegram, tim `@BotFather`.
2. Chay lenh `/newbot`.
3. Dat ten bot va username theo huong dan.
4. Luu `TELEGRAM_BOT_TOKEN` de dien vao `.env`.

## Tao Sapo private app / lay API credentials

1. Dang nhap trang quan tri Sapo cua shop.
2. Tao private app hoac ung dung co quyen doc blog va tao bai viet.
3. Lay `SAPO_API_KEY`, `SAPO_API_SECRET`, `SAPO_BASE_URL`.
4. Dam bao blog mac dinh ton tai voi ten `Bien tap vien gioi thieu` hoac doi `SAPO_DEFAULT_BLOG_NAME` cho phu hop.

## Cau hinh `.env`

```env
PORT=3000
NODE_ENV=development

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_URL=

SAPO_BASE_URL=https://your-shop.mysapo.net
SAPO_API_KEY=
SAPO_API_SECRET=
SAPO_DEFAULT_BLOG_NAME=Biên tập viên giới thiệu

BOT_ALLOWED_USER_IDS=
```

## Chay local

Khi `NODE_ENV=development` va `TELEGRAM_WEBHOOK_URL` rong, bot se chay bang polling:

```bash
npm run dev
```

## Chay production

1. Deploy app len server hoac container.
2. Set `NODE_ENV=production`.
3. Set `TELEGRAM_WEBHOOK_URL` la public base URL cua app.
4. Chay:

```bash
npm run build
npm run start
```

## Deploy len Render

### Cach 1: Deploy bang giao dien Render

1. Push project len GitHub.
2. Vao Render, chon `New` -> `Web Service`.
3. Ket noi repo.
4. Cau hinh:
   - Runtime: `Node`
   - Build Command: `npm install --include=dev && npm run build`
   - Start Command: `npm start`
   - Health Check Path: `/health`
5. Them env vars:
   - `NODE_ENV=production`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_URL=https://your-service.onrender.com`
   - `SAPO_BASE_URL`
   - `SAPO_API_KEY`
   - `SAPO_API_SECRET`
   - `SAPO_DEFAULT_BLOG_NAME=Biên tập viên giới thiệu`
   - `BOT_ALLOWED_USER_IDS` (de trong neu muon mo cho tat ca user)
6. Deploy service.

### Cach 2: Deploy bang Render Blueprint

Project da co san file `render.yaml`.

1. Push project len GitHub.
2. Vao Render, chon `New` -> `Blueprint`.
3. Chon repo chua project nay.
4. Render se doc file `render.yaml` va tao service.
5. Dien cac bien `sync: false` trong giao dien Render:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_URL`
   - `SAPO_BASE_URL`
   - `SAPO_API_KEY`
   - `SAPO_API_SECRET`
   - `BOT_ALLOWED_USER_IDS` (de trong neu muon mo cho tat ca user)

Luu y:

- `TELEGRAM_WEBHOOK_URL` phai la base URL public cua service Render, vi du `https://your-service.onrender.com`
- App se tu dang ky webhook theo duong dan `/telegram/webhook` khi khoi dong
- Sau khi doi domain hoac service URL, hay cap nhat lai `TELEGRAM_WEBHOOK_URL` va redeploy

## Webhook notes

- Webhook endpoint: `POST /telegram/webhook`
- Health check: `GET /health`
- Webhook URL thuc te duoc dang ky theo dang: `${TELEGRAM_WEBHOOK_URL}/telegram/webhook`

## Command list

- `/start`: Gioi thieu bot va huong dan su dung
- `/newpost`: Bat dau tao bai viet moi
- `/cancel`: Huy thao tac hien tai

## Flow su dung

1. Gui `/newpost`
2. Gui tieu de
3. Gui noi dung
4. Gui anh feature
5. Xac nhan bang `Y` hoac `N`

Neu xac nhan `Y`, bot se tao bai viet nhap trong blog mac dinh va tra ket qua ve Telegram.

## Troubleshooting

- `Bạn không có quyền sử dụng bot này.`: Kiem tra `BOT_ALLOWED_USER_IDS`.
- `Sapo API xác thực thất bại`: Kiem tra `SAPO_API_KEY` va `SAPO_API_SECRET`.
- `Không tìm thấy blog mặc định trên Sapo`: Kiem tra `SAPO_DEFAULT_BLOG_NAME`.
- `Không thể xử lý ảnh dưới 1MB`: Thu anh nho hon hoac anh it chi tiet hon.
- Bot khong nhan webhook: Kiem tra `TELEGRAM_WEBHOOK_URL`, SSL, va route `/telegram/webhook`.
