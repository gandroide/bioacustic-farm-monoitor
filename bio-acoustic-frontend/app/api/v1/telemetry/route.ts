import { NextResponse } from 'next/server';

const EXPRESS_API_URL = 'http://localhost:3000/api/v1';

export async function GET() {
  try {
    const res = await fetch(`${EXPRESS_API_URL}/telemetry`, {
      cache: 'no-store'
    });
    
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch telemetry from Express server' },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Error proxying GET /api/v1/telemetry:', error);
    return NextResponse.json(
      { error: 'Internal Server Error while connecting to backend' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await fetch(`${EXPRESS_API_URL}/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Error proxying POST /api/v1/telemetry:', error);
    return NextResponse.json(
      { error: 'Internal Server Error while connecting to backend' },
      { status: 500 }
    );
  }
}
