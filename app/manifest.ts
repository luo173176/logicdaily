import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'LogicDaily · 每日逻辑思维训练',
    short_name: 'LogicDaily',
    description:
      '每天 5～15 分钟的中文逻辑思维训练：逻辑推理、论证分析、因果辨析与真实生活思考日志，配合间隔复习与可选的 AI 思维教练。',
    lang: 'zh-CN',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait-primary',
    background_color: '#f6f6f4',
    theme_color: '#2f5d88',
    categories: ['education', 'productivity', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '开始今天的训练', url: '/train', description: '按今日计划开始训练' },
      { name: '写思考日志', url: '/journal/new', description: '记录一个真实生活里的问题' },
      { name: '复习错题', url: '/review', description: '查看到期的复习队列' },
    ],
  };
}
