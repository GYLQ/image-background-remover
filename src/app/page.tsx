'use client';

import { useState, useRef } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function Home() {
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_SIZE = 4 * 1024 * 1024;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  async function processFile(file: File) {
    if (!allowedTypes.includes(file.type)) {
      setStatus('error');
      setStatusMsg('请上传 JPG、PNG 或 WebP 格式图片');
      return;
    }
    if (file.size > MAX_SIZE) {
      setStatus('error');
      setStatusMsg('文件过大，请选择小于 4MB 的图片');
      return;
    }

    setStatus('loading');
    setStatusMsg('处理中，请稍候...');
    setPreviewUrl(null);
    setDownloadUrl(null);

    const formData = new FormData();
    formData.append('image_file', file);

    try {
      const res = await fetch('/api/remove-bg', { method: 'POST', body: formData });

      if (!res.ok) {
        let msg = '处理失败，请稍后重试';
        try { const d = await res.json(); msg = d.error || msg; } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setDownloadUrl(url);
      setStatus('success');
      setStatusMsg('处理完成！');
    } catch (err) {
      setStatus('error');
      setStatusMsg(err instanceof Error ? err.message : '处理失败，请稍后重试');
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function reset() {
    setStatus('idle');
    setStatusMsg('');
    setPreviewUrl(null);
    setDownloadUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', padding: '24px 0', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#111827' }}>🪄 BG Remover</h1>
        <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '4px' }}>Remove Image Background</p>
      </header>

      {/* Main */}
      <main style={{ maxWidth: '512px', margin: '0 auto', padding: '48px 24px' }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          id="file-input"
          style={{ display: 'none' }}
        />

        {/* Upload Zone */}
        <div
          onClick={openFilePicker}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          style={{
            border: '2px dashed #d1d5db',
            borderRadius: '16px',
            padding: '80px 40px',
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: '#fff',
            transition: 'all 0.2s',
            opacity: status === 'loading' ? 0.6 : 1,
            pointerEvents: status === 'loading' ? 'none' : 'auto',
          }}
        >
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>📤</div>
          <p style={{ color: '#374151', fontWeight: '500', marginBottom: '8px' }}>点击或拖拽上传图片</p>
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>JPG, PNG, WebP · 最大 4MB</p>
        </div>

        {/* Loading */}
        {status === 'loading' && (
          <div style={{ marginTop: '24px', padding: '16px', borderRadius: '12px', backgroundColor: '#fef9c3', color: '#854d0e', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
            <p>{statusMsg}</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={{ marginTop: '24px', padding: '16px', borderRadius: '12px', backgroundColor: '#fee2e2', color: '#991b1b', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>❌</div>
            <p style={{ marginBottom: '12px' }}>{statusMsg}</p>
            <button
              onClick={(e) => { e.stopPropagation(); reset(); }}
              style={{ padding: '8px 20px', backgroundColor: '#fecaca', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#991b1b' }}
            >
              重试
            </button>
          </div>
        )}

        {/* Success */}
        {status === 'success' && previewUrl && (
          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', display: 'inline-block' }}>
              <img
                src={previewUrl}
                alt="Result"
                style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px' }}
              />
            </div>
            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href={downloadUrl!}
                download="no-bg.png"
                style={{ padding: '12px 32px', backgroundColor: '#4f46e5', color: '#fff', borderRadius: '12px', fontWeight: '600', textDecoration: 'none' }}
              >
                ⬇️ 下载 PNG
              </a>
              <button
                onClick={reset}
                style={{ padding: '12px 32px', backgroundColor: '#f3f4f6', color: '#374151', borderRadius: '12px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
              >
                处理下一张
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '24px', color: '#9ca3af', fontSize: '14px' }}>
        Powered by <a href="https://www.remove.bg" target="_blank" style={{ color: '#818cf8', textDecoration: 'none' }}>remove.bg</a> API
      </footer>
    </div>
  );
}
