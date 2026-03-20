export const messages = {
  unauthorized: "Bạn không có quyền sử dụng bot này.",
  start: [
    "Xin chào. Tôi là bot đăng bài nháp lên blog Sapo.",
    "",
    "Quy trình:",
    "1. Gửi tiêu đề",
    "2. Gửi một hoặc nhiều tin nhắn nội dung",
    "3. Gửi ảnh feature",
    "4. Gửi link sản phẩm hoặc BO QUA",
    "5. Bot tạo bài nháp tự động",
    "",
    "Gõ /newpost để bắt đầu."
  ].join("\n"),
  genericStartFlow: "Gõ /newpost để bắt đầu tạo bài viết",
  askTitle: "Gửi tiêu đề bài viết",
  askContent: "Gửi nội dung bài viết. Bạn có thể gửi nhiều tin nhắn liên tiếp, xong thì gửi ảnh feature.",
  contentAppended: "Đã nhận thêm nội dung. Bạn có thể gửi tiếp hoặc gửi ảnh feature để sang bước link sản phẩm.",
  askImage: "Gửi ảnh feature",
  askProductLink:
    "Gửi link sản phẩm dạng https://nhanam.vn/... để gắn tag cho bài viết, hoặc trả lời BO QUA để đăng bài không kèm sản phẩm.",
  invalidProductLink:
    "Link sản phẩm không hợp lệ. Vui lòng gửi đúng link dạng https://nhanam.vn/... hoặc trả lời BO QUA.",
  productLookupFailed:
    "Không tìm thấy sản phẩm từ link này. Vui lòng kiểm tra lại link https://nhanam.vn/... hoặc trả lời BO QUA.",
  cancelCurrentAction: "❌ Đã hủy thao tác hiện tại",
  waitTitleText: "Hiện tại tôi đang chờ tiêu đề bài viết. Vui lòng gửi tiêu đề bằng text.",
  waitContentText: "Hiện tại tôi đang chờ nội dung bài viết. Vui lòng gửi nội dung bằng text.",
  waitImagePhoto: "Hiện tại tôi đang chờ ảnh feature. Vui lòng gửi 1 ảnh.",
  waitProductLinkText:
    "Hiện tại tôi đang chờ link sản phẩm dạng https://nhanam.vn/... hoặc tin nhắn BO QUA để tiếp tục.",
  submitting: "Đang tạo bài nháp..."
} as const;
