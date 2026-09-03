type SlackApiResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
  user?: {
    profile?: {
      display_name?: string;
      real_name?: string;
    };
    real_name?: string;
    name?: string;
  };
};

async function callSlackApi(method: string, body: Record<string, object | string>): Promise<SlackApiResponse> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');

  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as SlackApiResponse;
  if (!response.ok || !result.ok) {
    throw new Error(`Slack ${method} failed: ${result.error ?? response.status}`);
  }
  return result;
}

export async function postSlackMessage(
  channel: string,
  message: { text: string; blocks: object[] },
): Promise<string> {
  const result = await callSlackApi('chat.postMessage', { channel, ...message });
  if (!result.ts) throw new Error('Slack chat.postMessage did not return a timestamp');
  return result.ts;
}

export async function updateSlackMessage(
  channel: string,
  ts: string,
  message: { text: string; blocks: object[] },
): Promise<void> {
  await callSlackApi('chat.update', { channel, ts, ...message });
}

export async function getSlackDisplayName(userId: string, fallback: string): Promise<string> {
  const result = await callSlackApi('users.info', { user: userId });
  const name =
    result.user?.profile?.display_name ||
    result.user?.profile?.real_name ||
    result.user?.real_name ||
    result.user?.name ||
    fallback;
  return name.trim().slice(0, 80);
}

export async function respondToSlack(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
  });
}
