// app/api/ionex-proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { gzipSync } from 'zlib';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');

  if (!target || typeof target !== 'string') {
    return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
  }

  try {
    // 1. 拉取数据（根据目标可能需要设置 User-Agent 等）
    const upstream = await fetch(target, {
      headers: {
        'Accept': 'text/plain, */*',
        // 有些服务器会拒绝无 User-Agent 的请求
        'User-Agent': 'Mozilla/5.0 (compatible; IonexProxy/1.0)',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status },
      );
    }

    // 2. 获取文本
    const text = await upstream.text();

    // 3. 使用 zlib 压缩（同步方法，简单可靠）
    const compressed = gzipSync(text);

    // 4. 返回 gzip 二进制数据
    return new NextResponse(compressed, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Encoding': 'gzip',
        // 可选：添加 CORS 头（其实同源不需要，但无妨）
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Proxy error:', err);
    return NextResponse.json(
      { error: 'Proxy request failed' },
      { status: 500 },
    );
  }
}