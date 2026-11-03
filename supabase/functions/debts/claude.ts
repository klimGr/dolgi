// Модель Claude (платный API Anthropic). Включается, если задан ANTHROPIC_API_KEY.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { AiError, type RunArgs, runTool, SYSTEM, TOOLS } from './assistant.ts';
import { ANTHROPIC_API_KEY, EFFORT, MODEL } from './config.ts';

type Block = Anthropic.Beta.BetaContentBlockParam;
type Message = Anthropic.Beta.BetaMessageParam;

const tools = TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  eager_input_streaming: true,
  input_schema: { type: 'object' as const, properties: t.properties, required: t.required, additionalProperties: false },
}));

function toBlock(a: RunArgs['attachments'][number]): Block {
  if (a.text !== undefined) return { type: 'document', title: a.file.name, source: { type: 'text', media_type: 'text/plain', data: a.text } };
  if (a.mime === 'application/pdf') return { type: 'document', title: a.file.name, source: { type: 'base64', media_type: 'application/pdf', data: a.base64! } };
  return { type: 'image', source: { type: 'base64', media_type: a.mime as 'image/jpeg', data: a.base64! } };
}

/**
 * После отказа посреди ответа (сработала резервная модель) нельзя повторять в истории
 * размышления и вызовы инструментов, которые были до блока fallback.
 */
function echoable(content: Anthropic.Beta.BetaContentBlock[]) {
  const last = content.map(b => b.type as string).lastIndexOf('fallback');
  if (last < 0) return content;
  const drop = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
  return content.filter((b, i) => i > last || !drop.has(b.type));
}

export async function runClaude({ history, context, attachments, userText, ctx }: RunArgs): Promise<string> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY() });
  const messages: Message[] = history.map(h => ({ role: h.role, content: h.text }));
  messages.push({ role: 'user', content: [{ type: 'text', text: context }, ...attachments.map(toBlock), { type: 'text', text: userText }] });

  let badJson = 0;
  try {
    for (let turn = 0; turn < 10; turn++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
        cache_control: { type: 'ephemeral' },
        output_config: { effort: EFFORT },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });

      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await stream.finalMessage();
        badJson = 0;
      } catch (err) {
        // Повторяем только если не разобрался JSON аргументов; ошибки API пробрасываем
        if (err instanceof Anthropic.APIError || badJson++ >= 2) throw err;
        continue;
      }

      if (msg.stop_reason === 'refusal') return 'С этим помочь не могу. Давайте вернёмся к долгам и платежам.';
      const content = echoable(msg.content);
      const said = content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();

      if (msg.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content });
        continue;
      }
      const uses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!uses.length) return said;
      if (msg.stop_reason === 'max_tokens') return said || 'Ответ получился слишком длинным. Спросите, пожалуйста, покороче.';

      messages.push({ role: 'assistant', content });
      const results: Block[] = [];
      for (const u of uses) {
        const r = await runTool(u.name, u.input, ctx);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('auth', e.message);
    if (e instanceof Anthropic.RateLimitError) throw new AiError('rate', e.message);
    if (e instanceof Anthropic.BadRequestError) throw new AiError('bad', e.message);
    if (e instanceof Anthropic.APIError) throw new AiError('down', e.message);
    throw e;
  }
  return '';
}
