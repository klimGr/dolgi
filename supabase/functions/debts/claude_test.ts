// Сквозной тест разговора с Claude без сети: подменяем API Claude (SSE-поток) и PostgREST Supabase (таблицы в памяти).
// deno test --allow-env supabase/functions/debts/claude_test.ts
import { assert, claudeRequests, type Row, script, tables } from './test_mocks.ts';

const { chat } = await import('./assistant.ts');

Deno.test('Claude: договор → add_debt → ответ; затем платёж текстом', async () => {
  Deno.env.set('DEBTS_AI', 'claude');
  // 1. Прислали договор: Claude вызывает add_debt, потом отвечает текстом
  script.push(
    [
      { type: 'text', text: 'Смотрю договор.' },
      { type: 'tool_use', id: 'tu_1', name: 'add_debt', input: { name: 'Тинькофф Платинум', kind: 'card', creditor: 'Т-Банк', owner: '42', balance: 48300, limit: 150000, rate: 34.9, min_payment: 3000, pay_day: 15 } },
    ],
    [{ type: 'text', text: 'Добавил карту **Тинькофф Платинум**: долг 48 300 ₽.' }],
  );
  const r1 = await chat({
    chatId: 42,
    me: { id: '42', name: 'Клим' },
    text: '',
    attachments: [{ file: { id: 'FILE1', name: 'dogovor.pdf', type: 'document' }, mime: 'application/pdf', base64: 'JVBERi0=' }],
  });
  assert(r1.changed, 'изменение не отмечено');
  assert(r1.reply.includes('Тинькофф'), 'нет ответа модели');

  const debt = tables.debts?.[0];
  assert(debt, 'долг не сохранён');
  assert(debt.name === 'Тинькофф Платинум' && Number(debt.balance) === 48300 && debt.pay_day === 15 && debt.owner === '42', 'поля долга: ' + JSON.stringify(debt));
  assert(JSON.stringify(debt.files).includes('FILE1'), 'договор не прикреплён к долгу');

  // Запрос к Claude: модель, резервная модель, потоковые инструменты, кэш, документ перед текстом
  const first = claudeRequests[0];
  assert(first.body.model === 'claude-opus-5-5', 'модель');
  assert(first.body.fallbacks === 'default', 'нет fallbacks');
  assert((first.headers.get('anthropic-beta') || '').includes('server-side-fallback-2026-07-01'), 'нет beta-заголовка');
  assert((first.body.tools as Row[]).every(t => t.eager_input_streaming === true), 'eager_input_streaming');
  assert(!('thinking' in first.body) && !('temperature' in first.body), 'лишние параметры');
  const userContent = (first.body.messages as Row[]).at(-1)!.content as Row[];
  assert(userContent[0].type === 'text' && String(userContent[0].text).startsWith('Контекст'), 'контекст первым');
  assert(userContent[1].type === 'document', 'документ перед текстом вопроса');
  // Второй запрос продолжает тот же диалог: ответ ассистента и результат инструмента дописаны в конец
  const second = claudeRequests[1].body.messages as Row[];
  assert(second.length === 3 && second[1].role === 'assistant' && (second[2].content as Row[])[0].type === 'tool_result', 'цикл инструментов');

  // 2. «Заплатил 3000» — record_payment
  const id = String(debt.id);
  script.push(
    [{ type: 'tool_use', id: 'tu_2', name: 'record_payment', input: { debt_id: id, amount: 3000 } }],
    [{ type: 'text', text: 'Записал платёж 3 000 ₽, осталось 45 300 ₽.' }],
  );
  const r2 = await chat({ chatId: 42, me: { id: '42', name: 'Клим' }, text: 'заплатил 3000 по тинькофф', attachments: [] });
  assert(r2.changed, 'платёж не отмечен');
  assert(Number(tables.debts[0].balance) === 45300, 'остаток после платежа: ' + tables.debts[0].balance);
  assert(tables.debt_events?.length === 1 && Number(tables.debt_events[0].amount) === 3000, 'событие платежа');
  // История переписки подтянулась во второй разговор
  const hist = claudeRequests[2].body.messages as Row[];
  assert(hist[0].role === 'user' && String(hist[0].content).includes('dogovor.pdf'), 'история не подтянулась');

  // 3. Неверный ввод инструмента не ломает базу, а возвращается модели как ошибка
  script.push(
    [{ type: 'tool_use', id: 'tu_3', name: 'record_payment', input: { debt_id: id, amount: 'много' } }],
    [{ type: 'text', text: 'Уточните сумму, пожалуйста.' }],
  );
  await chat({ chatId: 42, me: { id: '42', name: 'Клим' }, text: 'заплатил много', attachments: [] });
  const last = claudeRequests.at(-1)!.body.messages as Row[];
  const result = (last.at(-1)!.content as Row[])[0];
  assert(result.is_error === true, 'ошибка инструмента не передана');
  assert(Number(tables.debts[0].balance) === 45300, 'остаток изменился от неверного ввода');
  assert(script.length === 0, 'не все ответы использованы');
});
