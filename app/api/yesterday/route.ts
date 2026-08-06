import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // 从 URL 获取参数
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: 'url parameter missing' }, { status: 400 });
  }
  // 请求目标资源
  const upstream = await fetch(target, {
    headers: { Accept: 'application/octet-stream,application/gzip,*/*' },
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Upstream failed' }, { status: upstream.status });
  }
  // 返回二进制数据，保持 Content-Type
  const blob = await upstream.blob();
  return new NextResponse(blob, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    },
  });
}