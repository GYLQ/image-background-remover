import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image_file');

    if (!imageFile || !(imageFile instanceof File)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const MAX_SIZE = 4 * 1024 * 1024;
    if (imageFile.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 4MB.' }, { status: 400 });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return NextResponse.json({ error: 'Unsupported file type. Use JPG, PNG, or WebP.' }, { status: 400 });
    }

    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    const removeBgForm = new FormData();
    removeBgForm.set('image_file', imageFile);
    removeBgForm.set('size', 'auto');
    removeBgForm.set('format', 'png');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: removeBgForm,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Remove.bg API error:', errText);
      return NextResponse.json({ error: 'Failed to process image. Please try again.' }, { status: 500 });
    }

    const resultBuffer = await response.arrayBuffer();

    return new NextResponse(resultBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="no-bg.png"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
