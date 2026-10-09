import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="stack gap-4">
      <h1 className="text-2xl">页面不存在</h1>
      <p className="muted">
        你访问的地址没有对应的页面。已保存的训练数据不受影响，它们仍然在这台设备的浏览器里。
      </p>
      <div className="row wrap gap-2">
        <Link href="/" className="btn btn-primary">
          回到首页
        </Link>
        <Link href="/train" className="btn btn-secondary">
          开始训练
        </Link>
      </div>
    </div>
  );
}
