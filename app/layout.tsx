/**
 * 应用根布局。
 *
 * 这里不承载对局状态，而是统一设置全局 CSS、页面语言和分享卡片元数据。
 * 分享图片地址根据当前请求主机生成，以便本地和线上环境都能正确显示。
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol =
    requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const image = `${protocol}://${host}/og.png`;
  const title = '二人麻将 · 34张选牌竞技';
  const description = '自选听牌、双立直开局、满贯起胡。支持电脑与好友联机对战。';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: image, width: 1731, height: 911, alt: '二人麻将牌桌' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
