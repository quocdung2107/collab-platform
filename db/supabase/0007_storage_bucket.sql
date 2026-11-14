-- 0007: bucket riêng tư cho tệp đính kèm (F9b). Không có chính sách cho anon/authenticated trên storage.objects:
-- chỉ Backend (khoá máy chủ) ký URL tải lên/tải xuống sau khi kiểm tra can() (DATA_MODEL §8).
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520)
on conflict (id) do nothing;
