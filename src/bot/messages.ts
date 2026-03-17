export const messages = {
  unauthorized: "Bạn không có quyền sử dụng bot này.",
  start: [
    "Xin chào. Tôi là bot đăng bài nháp lên blog Sapo.",
    "",
    "Quy trình:",
    "1. Gửi tiêu đề",
    "2. Gửi nội dung",
    "3. Gửi ảnh",
    "4. Xác nhận bằng Y hoặc N",
    "",
    "Gõ /newpost để bắt đầu."
  ].join("\n"),
  genericStartFlow: "Gõ /newpost để bắt đầu tạo bài viết",
  askTitle: "Gửi tiêu đề bài viết",
  askContent: "Gửi nội dung bài viết",
  askImage: "Gửi ảnh feature",
  cancelCurrentAction: "❌ Đã hủy thao tác hiện tại",
  cancelPosting: "❌ Đã hủy đăng bài",
  waitTitleText: "Hiện tại tôi đang chờ tiêu đề bài viết. Vui lòng gửi tiêu đề bằng text.",
  waitContentText: "Hiện tại tôi đang chờ nội dung bài viết. Vui lòng gửi nội dung bằng text.",
  waitImagePhoto: "Hiện tại tôi đang chờ ảnh feature. Vui lòng gửi 1 ảnh.",
  waitConfirmationText: "Vui lòng trả lời Y để đăng hoặc N để hủy",
  submitting: "Đang tạo bài nháp..."
} as const;
