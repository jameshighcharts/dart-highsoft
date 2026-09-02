import { NextResponse } from 'next/server';

import { requireScoliaBoardManagementAccess } from '@/lib/scolia/access';
import { disconnectScoliaBoard, ScoliaApiError } from '@/lib/scolia/client';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serialNumber: string }> }
) {
  const denied = requireScoliaBoardManagementAccess();
  if (denied) return denied;
  try {
    const { serialNumber } = await params;
    if (!serialNumber || serialNumber.length > 128) {
      return NextResponse.json({ error: 'Invalid serial number' }, { status: 400 });
    }
    await disconnectScoliaBoard(serialNumber);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ScoliaApiError) {
      if (process.env.NODE_ENV !== 'production' && error.diagnostics) {
        console.warn('DELETE Scolia board rejected:', error.diagnostics);
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('DELETE Scolia board error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
