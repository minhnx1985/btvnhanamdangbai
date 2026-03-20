export const messages = {
  unauthorized: "Bạn không có quyền sử dụng bot này.",
  start: [
    "Xin chào. Tôi là bot đăng bài nháp lên blog Sapo.",
    "",
    "Lệnh hỗ trợ:",
    "- /newpost: tạo bài blog thường",
    "- /author: tạo bài ở mục Tác giả",
    "- /cancel: hủy thao tác hiện tại",
    "",
    "Flow blog thường:",
    "1. Gửi tiêu đề",
    "2. Gửi một hoặc nhiều tin nhắn nội dung",
    "3. Gửi ảnh feature",
    "4. Gửi link sản phẩm hoặc BO QUA",
    "5. Bot tạo bài nháp tự động",
    "",
    "Flow tác giả:",
    "1. Gửi tiêu đề",
    "2. Gửi một hoặc nhiều tin nhắn nội dung",
    "3. Gửi ảnh feature",
    "4. Bot tạo bài nháp ở mục Tác giả"
  ].join("\n"),
  genericStartFlow: "Gõ /newpost để tạo bài blog hoặc /author để tạo bài tác giả",
  askTitle: "Gửi tiêu đề bài viết",
  askAuthorTitle: "Gửi tiêu đề bài viết tác giả",
  askContent: "Gửi nội dung bài viết. Bạn có thể gửi nhiều tin nhắn liên tiếp, xong thì gửi ảnh feature.",
  contentAppended: "Đã nhận thêm nội dung. Bạn có thể gửi tiếp hoặc gửi ảnh feature để sang bước tiếp theo.",
  askImage: "Gửi ảnh feature",
  askProductLink:
    "Gửi link sản phẩm dạng https://nhanam.vn/... để gắn tag cho bài viết, hoặc trả lời BO QUA để đăng bài không kèm sản phẩm.",
  cancelCurrentAction: "❌ Đã hủy thao tác hiện tại",
  waitTitleText: "Hiện tại tôi đang chờ tiêu đề bài viết. Vui lòng gửi tiêu đề bằng text.",
  waitContentText: "Hiện tại tôi đang chờ nội dung bài viết. Vui lòng gửi nội dung bằng text.",
  waitImagePhoto: "Hiện tại tôi đang chờ ảnh feature. Vui lòng gửi 1 ảnh.",
  waitProductLinkText:
    "Hiện tại tôi đang chờ link sản phẩm dạng https://nhanam.vn/... hoặc tin nhắn BO QUA để tiếp tục.",
  submitting: "Đang tạo bài nháp..."
} as const;
