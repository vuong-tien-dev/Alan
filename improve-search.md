# Hướng Dẫn Nhanh: Gợi Ý `openUrl` Sau `webSearch`

## Mục tiêu
Khi AI gọi `webSearch`, hệ thống trả thêm một chỉ dẫn ngắn để model ưu tiên dùng `openUrl` đọc link chi tiết thay vì trả lời từ snippet nông.

## 1. Chỗ cần sửa
- `assets/js/chat.js` hoặc `Resources/Js/chat/chat.js`
- `assets/js/search-tools.js` hoặc `Resources/Js/chat/search-tools.js`

## 2. Thêm mô tả tool `openUrl`
Trong `TOOLS`, cập nhật description của `openUrl`:

```js
"Open and read content from URL(s). Fetches in parallel and merges results. IMPORTANT: After webSearch, use this with relevant URLs instead of searching again."
```

## 3. Gắn hint vào kết quả `webSearch`
Trong `webSearch(query, num)`, khai báo:

```js
const searchHint = "Nếu snippet chưa đủ thông tin, hãy dùng openUrl để đọc trực tiếp URL liên quan.";
```

Sau đó thêm field `_system_instruction_` vào mọi nhánh `return success`:

```js
return {
  success: true,
  query,
  results: finalResults,
  source: sources.join('+'),
  _system_instruction_: searchHint
};
```

## 4. Khuyến nghị an toàn (tránh over-guidance)
Dùng feature flag để bật/tắt nhanh:

```js
const ENABLE_SEARCH_HINT = false; // bật true khi cần
...
...(ENABLE_SEARCH_HINT ? { _system_instruction_: searchHint } : {})
```

Cách này giúp rollback không cần xóa code.

## 5. Checklist test
- Search xong, AI có xu hướng gọi `openUrl` khi câu hỏi cần chi tiết.
- AI không bị lặp call `openUrl` vô ích khi snippet đã đủ.
- Tắt flag -> hành vi quay lại như cũ.

## 6. Rollback nhanh
- Xóa `searchHint`
- Xóa `_system_instruction_` khỏi các return của `webSearch`
- Giữ nguyên logic search/openUrl còn lại
