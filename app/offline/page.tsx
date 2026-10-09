'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function OfflinePage() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return (
    <div className="stack gap-4">
      <h1 className="text-2xl">离线状态</h1>
      <p className="muted">
        {online === false
          ? '当前没有网络连接。'
          : online === true
            ? '网络已恢复，可以回到首页继续。'
            : '正在检查连接…'}
      </p>
      <div className="card stack gap-2 text-sm">
        <p className="font-semibold">离线时仍然可用</p>
        <ul className="stack gap-1 muted">
          <li>· 打开已缓存的页面、查看今日计划与解析</li>
          <li>· 作答、写思考日志（数据保存在本机 IndexedDB）</li>
          <li>· 复习队列与统计（全部本地计算）</li>
        </ul>
      </div>
      <div className="card stack gap-2 text-sm">
        <p className="font-semibold">离线时不可用</p>
        <ul className="stack gap-1 muted">
          <li>· AI 思维教练：需要联网并经由服务端调用模型</li>
          <li>· 首次安装时尚未缓存的页面分块</li>
        </ul>
      </div>
      <Link href="/" className="btn btn-primary">
        回到首页
      </Link>
    </div>
  );
}
