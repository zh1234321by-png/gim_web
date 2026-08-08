import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');

  if (!target || typeof target !== 'string') {
    return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'Accept': 'text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; IonexProxy/1.0)',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const text = await upstream.text();

    // 使用 CompressionStream 替代 zlib
    const encoder = new TextEncoder();
    const stream = new Blob([text])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));

    const compressedBuffer = await new Response(stream).arrayBuffer();

    return new NextResponse(compressedBuffer, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Encoding': 'gzip',
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