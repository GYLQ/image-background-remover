'use client';

import { useState } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function Home() {
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

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

  function reset() {
    setStatus('idle');
    setStatusMsg('');
    setPreviewUrl(null);
    setDownloadUrl(null);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 py-6">
        <div className="max-w-xl mx-auto px-6 text-center">
          <h1 className="text-2xl font-bold text-gray-800">🪄 BG Remover</h1>
          <p className="text-gray-500 text-sm mt-1">Remove Image Background</p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg">

          {/* Upload Zone - label wraps input for reliable click capture */}
          <label
            className={`
              relative block border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-200 select-none overflow-hidden
              ${status === 'loading' ? 'opacity-60 pointer-events-none' : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-gray-50'}
            `}
          >
            {/* Invisible file input overlaid on entire drop zone */}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              disabled={status === 'loading'}
            />

            {/* Drag events on the label */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <div className="text-6xl mb-4 pointer-events-none">📤</div>
              <p className="text-gray-700 font-medium mb-1 pointer-events-none">点击或拖拽上传图片</p>
              <p className="text-gray-400 text-sm pointer-events-none">JPG, PNG, WebP · 最大 4MB</p>
            </div>
          </label>

          {/* Loading */}
          {status === 'loading' && (
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-100 rounded-xl text-center">
              <div className="text-2xl mb-2">⏳</div>
              <p className="text-yellow-700">{statusMsg}</p>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-center">
              <div className="text-2xl mb-2">❌</div>
              <p className="text-red-700 mb-3">{statusMsg}</p>
              <button
                onClick={reset}
                className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {/* Success */}
          {status === 'success' && previewUrl && (
            <div className="mt-8 text-center">
              <div className="bg-white rounded-2xl p-4 shadow-lg inline-block">
                <img
                  src={previewUrl}
                  alt="Result"
                  className="max-w-full rounded-lg"
                  style={{ maxHeight: '400px' }}
                />
              </div>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <a
                  href={downloadUrl!}
                  download="no-bg.png"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors"
                >
                  ⬇️ 下载 PNG
                </a>
                <button
                  onClick={reset}
                  className="px-8 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
                >
                  处理下一张
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-gray-400 text-sm">
          Powered by{' '}
          <a
            href="https://www.remove.bg"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-500 hover:text-indigo-600 underline"
          >
            remove.bg
          </a>{' '}
          API
        </p>
      </footer>
    </div>
  );
}
