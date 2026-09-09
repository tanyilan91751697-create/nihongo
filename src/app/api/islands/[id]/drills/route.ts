import { NextResponse } from 'next/server';
import { db, getSetting, logActivity } from '@/lib/db';
import { diffChars } from '@/lib/diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Double translation drill.
 *
 * Step 1 stores the L1 back-translation and stamps when step 2 unlocks (24h by
 * default — the delay is the point of the exercise). Step 2 stores the L2
 * reconstruction and the diff against the verified Japanese.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const islandId = Number(id);
  const body = (await request.json()) as {
    step?: number;
    l1_back_translation?: string;
    l2_reconstruction?: string;
    drill_id?: number;
  };

  const island = db.prepare('SELECT * FROM islands WHERE id = ?').get(islandId) as
    | { verified_version: string | null; l2_translation: string | null }
    | undefined;
  if (!island) return NextResponse.json({ error: 'Island not found' }, { status: 404 });

  if (body.step === 2) {
    if (!body.drill_id) return NextResponse.json({ error: 'drill_id is required for step 2' }, { status: 400 });
    const target = island.verified_version || island.l2_translation || '';
    const diff = diffChars(target, body.l2_reconstruction ?? '');
    db.prepare(
      `UPDATE island_drills SET step = 2, l2_reconstruction = ?, diff_json = ? WHERE id = ? AND island_id = ?`,
    ).run(body.l2_reconstruction ?? '', JSON.stringify(diff), body.drill_id, islandId);
    logActivity({
      activity: 'island_drill',
      strand: 'output',
      ref_table: 'islands',
      ref_id: islandId,
      detail: 'double translation step 2',
      minutes: 10,
    });
    return NextResponse.json({
      drill: db.prepare('SELECT * FROM island_drills WHERE id = ?').get(body.drill_id),
      diff,
    });
  }

  const delayHours = Number(getSetting('drill_delay_hours', '24'));
  const info = db
    .prepare(
      `INSERT INTO island_drills (island_id, step, l1_back_translation, available_at)
       VALUES (?, 1, ?, datetime('now', ?))`,
    )
    .run(islandId, body.l1_back_translation ?? '', `+${delayHours} hours`);
  logActivity({
    activity: 'island_drill',
    strand: 'output',
    ref_table: 'islands',
    ref_id: islandId,
    detail: 'double translation step 1',
    minutes: 10,
  });
  return NextResponse.json({
    drill: db.prepare('SELECT * FROM island_drills WHERE id = ?').get(Number(info.lastInsertRowid)),
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const drillId = Number(searchParams.get('drill_id'));
  if (!drillId) return NextResponse.json({ error: 'drill_id is required' }, { status: 400 });
  db.prepare('DELETE FROM island_drills WHERE id = ? AND island_id = ?').run(drillId, Number(id));
  return NextResponse.json({ ok: true });
}
