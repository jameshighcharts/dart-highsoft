import { NextRequest, NextResponse } from 'next/server';

import { resolvePersona } from '@/lib/commentary/personas';
import { buildRealtimeSessionInstructions } from '@/lib/commentary/realtimePrompt';
import {
  isUuid,
  REALTIME_COMMENTARY_MODEL,
  resolveRealtimeVoice,
  type RealtimeCommentaryCorrectionRequest,
  type RealtimeCommentaryPolicyDecisionRequest,
  type RealtimeCommentarySessionControl,
  type RealtimeCommentarySessionRequest,
} from '@/lib/commentary/realtimeTypes';
import { loadRealtimeCommentarySnapshot } from '@/lib/commentary/realtimeSnapshot';
import { isMatchActive, loadMatch } from '@/lib/server/matchGuards';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const MAX_SDP_LENGTH = 128_000;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function parseCallId(location: string | null): string | null {
  const callId = location?.split('/').filter(Boolean).at(-1);
  return callId?.startsWith('rtc_') ? callId : null;
}

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return noStoreJson({ error: 'Invalid request origin' }, 403);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return noStoreJson({ error: 'OpenAI API key not configured' }, 503);

  let body: RealtimeCommentarySessionRequest;
  try {
    body = (await request.json()) as RealtimeCommentarySessionRequest;
  } catch {
    return noStoreJson({ error: 'Invalid JSON body' }, 400);
  }

  if (
    !isUuid(body.matchId) ||
    !isUuid(body.clientInstanceId) ||
    typeof body.offerSdp !== 'string' ||
    body.offerSdp.length === 0 ||
    body.offerSdp.length > MAX_SDP_LENGTH
  ) {
    return noStoreJson({ error: 'Invalid realtime session request' }, 400);
  }

  const supabase = getSupabaseServerClient();
  const match = await loadMatch(supabase, body.matchId);
  if (!match) return noStoreJson({ error: 'Match not found' }, 404);
  if (!isMatchActive(match)) return noStoreJson({ error: 'Match is not active' }, 409);

  const snapshotPromise = loadRealtimeCommentarySnapshot(supabase, match).then(
    (snapshot) => ({ snapshot, error: null }),
    (error: unknown) => ({ snapshot: null, error })
  );

  const persona = resolvePersona(body.personaId);
  const voice = resolveRealtimeVoice(body.voice);
  const form = new FormData();
  form.set('sdp', body.offerSdp);
  form.set(
    'session',
    JSON.stringify({
      type: 'realtime',
      model: REALTIME_COMMENTARY_MODEL,
      instructions: buildRealtimeSessionInstructions(persona),
      reasoning: { effort: 'low' },
      output_modalities: ['audio'],
      // Audio and reasoning consume output tokens too; the prompt's word cap
      // controls spoken length while this prevents marquee calls truncating.
      max_output_tokens: 1_200,
      audio: { output: { voice } },
    })
  );

  let openaiResponse: Response;
  try {
    openaiResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error('Realtime commentary session creation failed:', error);
    return noStoreJson({ error: 'Could not reach OpenAI Realtime' }, 502);
  }

  const answerSdp = await openaiResponse.text();
  if (!openaiResponse.ok) {
    console.error('OpenAI Realtime rejected session creation with status:', openaiResponse.status);
    return noStoreJson({ error: 'OpenAI Realtime rejected the session' }, 502);
  }

  const callId = parseCallId(openaiResponse.headers.get('Location'));
  if (!callId) {
    console.error('OpenAI Realtime response did not contain a call id');
    return noStoreJson({ error: 'OpenAI Realtime returned an invalid session' }, 502);
  }

  await supabase
    .from('commentary_realtime_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('match_id', body.matchId)
    .eq('client_instance_id', body.clientInstanceId)
    .eq('status', 'active');

  const { data: session, error: insertError } = await supabase
    .from('commentary_realtime_sessions')
    .insert({
      match_id: body.matchId,
      client_instance_id: body.clientInstanceId,
      openai_call_id: callId,
      persona_id: persona.id,
      voice,
      status: 'active',
      last_seen_at: new Date().toISOString(),
      closed_at: null,
    })
    .select('id, epoch')
    .single();

  if (insertError || !session) {
    console.error('Could not register Realtime commentary session:', insertError);
    return noStoreJson({ error: 'Could not register realtime session' }, 500);
  }

  const snapshotResult = await snapshotPromise;
  if (!snapshotResult.snapshot) {
    console.error('Could not create Realtime commentary snapshot:', snapshotResult.error);
    await supabase
      .from('commentary_realtime_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', session.id);
    return noStoreJson({ error: 'Could not snapshot active match' }, 500);
  }

  return noStoreJson({
    answerSdp,
    sessionId: session.id,
    epoch: session.epoch,
    snapshot: snapshotResult.snapshot,
    snapshotSource: match.scolia_board_id ? 'worker' : 'browser',
  });
}

async function updateSession(request: NextRequest, close: boolean) {
  if (!hasTrustedOrigin(request)) return noStoreJson({ error: 'Invalid request origin' }, 403);
  let body: RealtimeCommentarySessionControl;
  try {
    body = (await request.json()) as RealtimeCommentarySessionControl;
  } catch {
    return noStoreJson({ error: 'Invalid JSON body' }, 400);
  }
  if (!isUuid(body.matchId) || !isUuid(body.sessionId)) {
    return noStoreJson({ error: 'Invalid realtime session' }, 400);
  }

  const now = new Date().toISOString();
  const values = close
    ? { status: 'closed', closed_at: now, last_seen_at: now }
    : { last_seen_at: now };
  const { error } = await getSupabaseServerClient()
    .from('commentary_realtime_sessions')
    .update(values)
    .eq('id', body.sessionId)
    .eq('match_id', body.matchId)
    .eq('status', 'active');
  if (error) return noStoreJson({ error: 'Could not update realtime session' }, 500);
  return noStoreJson({ ok: true });
}

export async function PATCH(request: NextRequest) {
  let candidate: Partial<RealtimeCommentaryPolicyDecisionRequest> | null = null;
  try {
    candidate = await request.clone().json() as Partial<RealtimeCommentaryPolicyDecisionRequest>;
  } catch {
    // The heartbeat handler below owns the ordinary invalid-body response.
  }
  if (candidate?.action === 'policy_decision') {
    if (!hasTrustedOrigin(request)) return noStoreJson({ error: 'Invalid request origin' }, 403);
    const priorities = new Set(['silent', 'ordinary', 'notable', 'marquee', 'terminal']);
    const reasons = new Set([
      'guaranteed', 'silent-priority', 'visit-in-progress', 'rapid-sequence',
      'duplicate-observation', 'cooldown', 'ordinary-sampling',
      'active-higher-priority', 'speak',
    ]);
    if (
      !candidate.matchId || !isUuid(candidate.matchId)
      || !candidate.sessionId || !isUuid(candidate.sessionId)
      || (candidate.turnId !== undefined && !isUuid(candidate.turnId))
      || typeof candidate.sourceEventId !== 'string'
      || candidate.sourceEventId.length === 0
      || candidate.sourceEventId.length > 200
      || !Number.isSafeInteger(candidate.epoch) || Number(candidate.epoch) < 0
      || typeof candidate.policyVersion !== 'string'
      || candidate.policyVersion.length === 0
      || candidate.policyVersion.length > 100
      || !candidate.priority || !priorities.has(candidate.priority)
      || !Array.isArray(candidate.signals)
      || candidate.signals.length > 20
      || candidate.signals.some((signal) => typeof signal !== 'string' || signal.length > 100)
      || typeof candidate.shouldSpeak !== 'boolean'
      || typeof candidate.guaranteed !== 'boolean'
      || typeof candidate.interrupt !== 'boolean'
      || !candidate.reason || !reasons.has(candidate.reason)
      || typeof candidate.evaluatedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.evaluatedAt))
    ) return noStoreJson({ error: 'Invalid commentary policy decision' }, 400);

    const supabase = getSupabaseServerClient();
    const activeSession = await supabase
      .from('commentary_realtime_sessions')
      .select('id')
      .eq('id', candidate.sessionId)
      .eq('match_id', candidate.matchId)
      .eq('epoch', candidate.epoch)
      .eq('status', 'active')
      .maybeSingle();
    if (activeSession.error) return noStoreJson({ error: 'Could not verify realtime session' }, 500);
    if (!activeSession.data) return noStoreJson({ error: 'Realtime session is not active' }, 409);

    const inserted = await supabase
      .from('dartiq_commentary_policy_decisions')
      .upsert({
        session_id: candidate.sessionId,
        match_id: candidate.matchId,
        turn_id: candidate.turnId ?? null,
        source_event_id: candidate.sourceEventId,
        epoch: candidate.epoch,
        channel: 'browser',
        policy_version: candidate.policyVersion,
        priority: candidate.priority,
        signals: candidate.signals,
        should_speak: candidate.shouldSpeak,
        guaranteed: candidate.guaranteed,
        interrupt: candidate.interrupt,
        reason: candidate.reason,
        evaluated_at: candidate.evaluatedAt,
      }, {
        onConflict: 'session_id,epoch,source_event_id,policy_version',
        ignoreDuplicates: true,
      });
    if (inserted.error) return noStoreJson({ error: 'Could not record policy decision' }, 500);
    return noStoreJson({ ok: true });
  }
  return updateSession(request, false);
}

export async function PUT(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return noStoreJson({ error: 'Invalid request origin' }, 403);
  let body: RealtimeCommentaryCorrectionRequest;
  try {
    body = (await request.json()) as RealtimeCommentaryCorrectionRequest;
  } catch {
    return noStoreJson({ error: 'Invalid JSON body' }, 400);
  }
  if (
    !isUuid(body.matchId)
    || !isUuid(body.sessionId)
    || !isUuid(body.correctionId)
    || !['throw_updated', 'throw_deleted'].includes(body.reason)
  ) {
    return noStoreJson({ error: 'Invalid commentary correction' }, 400);
  }

  const supabase = getSupabaseServerClient();
  const match = await loadMatch(supabase, body.matchId);
  if (!match) return noStoreJson({ error: 'Match not found' }, 404);

  let epoch: number | null = null;
  for (let attempt = 0; attempt < 5 && epoch === null; attempt += 1) {
    const { data: current, error: currentError } = await supabase
      .from('commentary_realtime_sessions')
      .select('epoch, last_correction_id')
      .eq('id', body.sessionId)
      .eq('match_id', body.matchId)
      .eq('status', 'active')
      .maybeSingle();
    if (currentError) return noStoreJson({ error: 'Could not load realtime session' }, 500);
    if (!current) return noStoreJson({ error: 'Realtime session is not active' }, 409);
    if (current.last_correction_id === body.correctionId) {
      epoch = Number(current.epoch);
      break;
    }

    const currentEpoch = Number(current.epoch);
    const { data: advanced, error: updateError } = await supabase
      .from('commentary_realtime_sessions')
      .update({
        epoch: currentEpoch + 1,
        last_correction_id: body.correctionId,
        last_correction_reason: body.reason,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', body.sessionId)
      .eq('match_id', body.matchId)
      .eq('status', 'active')
      .eq('epoch', currentEpoch)
      .select('epoch')
      .maybeSingle();
    if (updateError) return noStoreJson({ error: 'Could not advance commentary epoch' }, 500);
    if (advanced) epoch = Number(advanced.epoch);
  }
  if (epoch === null) return noStoreJson({ error: 'Commentary correction conflicted' }, 409);

  try {
    const snapshot = await loadRealtimeCommentarySnapshot(supabase, match);
    return noStoreJson({ epoch, snapshot });
  } catch (error) {
    console.error('Could not create corrected Realtime commentary snapshot:', error);
    return noStoreJson({ error: 'Could not snapshot corrected match' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  return updateSession(request, true);
}
