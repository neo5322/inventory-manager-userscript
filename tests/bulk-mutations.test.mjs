import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inventory-manager.user.js', import.meta.url), 'utf8');
const context = {
  __INVENTORY_MANAGER_TEST__: true,
  URL,
  URLSearchParams,
  Intl,
  AbortController,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(source, context);

const {
  createInventoryApi,
  beginMutation,
  destructiveTargetsForDialog,
  shouldIgnoreDestructiveSubmit,
  verifyDestructiveTargets,
  runDestructiveOperation,
  runBulkOperations,
  formatBulkMutationMessage,
} = context.__INVENTORY_MANAGER_INTERNALS__;

test('bulk discard uses the captured confirmation targets even if current selection changes', () => {
  const captured = [{
    characterId: 'char-1',
    characterName: '확인 당시 캐릭터',
    itemId: 'item-confirmed',
    itemName: '확인 당시 아이템',
    quantity: 2,
  }];
  const currentSelection = [{
    characterId: 'char-2',
    characterName: '다른 캐릭터',
    itemId: 'different-item',
    quantity: 9,
  }];

  assert.deepEqual(
    Array.from(destructiveTargetsForDialog({ expectedTargets: captured }, currentSelection)),
    captured,
  );
});

test('stale or in-flight destructive submit events are ignored before reading dialog state', () => {
  const pendingDialog = { type: 'use-item' };

  assert.equal(shouldIgnoreDestructiveSubmit('submit-use-item', { busy: true, dialog: pendingDialog }), true);
  assert.equal(shouldIgnoreDestructiveSubmit('submit-discard-item', { busy: false, dialog: null }), true);
  assert.equal(shouldIgnoreDestructiveSubmit('submit-bulk-discard', { busy: false, dialog: { type: 'bulk-discard' } }), false);
  assert.equal(shouldIgnoreDestructiveSubmit('submit-bulk-move', { busy: true, dialog: pendingDialog }), false);
});

test('destructive preflight reads each character once and verifies every item id and quantity', async () => {
  const calls = [];
  const result = await verifyDestructiveTargets([
    { characterId: 'char-1', itemId: 'item-1', quantity: 2 },
    { characterId: 'char-1', itemId: 'item-2', quantity: 5 },
    { characterId: 'char-2', itemId: 'item-3', quantity: 1 },
  ], async (characterId) => {
    calls.push(characterId);
    return {
      result: 'success',
      items: characterId === 'char-1'
        ? [{ item_id: 'item-1', quantity: 2 }, { item_id: 'item-2', quantity: 5 }]
        : [{ item_id: 'item-3', quantity: 1 }],
    };
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['char-1', 'char-2']);
});

test('destructive preflight reports changed and missing targets without treating them as safe', async () => {
  const result = await verifyDestructiveTargets([
    { characterId: 'char-1', itemId: 'item-changed', quantity: 3 },
    { characterId: 'char-1', itemId: 'item-missing', quantity: 1 },
  ], async () => ({
    items: [{ item_id: 'item-changed', quantity: 2 }],
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(
    Array.from(result.issues, ({ itemId, status }) => [itemId, status]),
    [['item-changed', 'changed'], ['item-missing', 'missing']],
  );
});

test('a failed or malformed latest inventory query blocks destructive work', async () => {
  for (const getInventory of [
    async () => { throw new Error('조회 실패'); },
    async () => ({ result: 'success' }),
  ]) {
    const result = await verifyDestructiveTargets([
      { characterId: 'char-1', itemId: 'item-1', quantity: 1 },
    ], getInventory);

    assert.equal(result.ok, false);
    assert.equal(result.issues[0].status, 'unknown');
  }
});

test('a delayed destructive preflight admits one submit only and never retries its write', async () => {
  const state = { busy: false };
  let releaseInventory;
  let inventoryCalls = 0;
  let writeCalls = 0;
  let refreshCalls = 0;
  const getInventory = () => {
    inventoryCalls += 1;
    return new Promise((resolve) => {
      releaseInventory = () => resolve({ items: [{ item_id: 'item-1', quantity: 1 }] });
    });
  };
  const run = () => runDestructiveOperation(
    state,
    [{ characterId: 'char-1', itemId: 'item-1', quantity: 1 }],
    getInventory,
    async () => { writeCalls += 1; },
    async () => { refreshCalls += 1; return { ok: true, errors: [] }; },
  );

  const first = run();
  const duplicate = await run();
  assert.equal(duplicate.duplicate, true);
  assert.equal(inventoryCalls, 1);
  assert.equal(writeCalls, 0);

  releaseInventory();
  const completed = await first;
  assert.equal(completed.status, 'success');
  assert.equal(inventoryCalls, 1);
  assert.equal(writeCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(state.busy, false);
});

test('a changed destructive target blocks the write and refreshes the displayed inventory', async () => {
  const state = { busy: false };
  let writes = 0;
  let refreshes = 0;
  const result = await runDestructiveOperation(
    state,
    [{ characterId: 'char-1', itemId: 'item-1', quantity: 2 }],
    async () => ({ items: [{ item_id: 'item-1', quantity: 1 }] }),
    async () => { writes += 1; },
    async () => { refreshes += 1; return { ok: true, errors: [] }; },
  );

  assert.equal(result.blocked, true);
  assert.equal(result.status, 'changed');
  assert.equal(writes, 0);
  assert.equal(refreshes, 1);
  assert.equal(state.busy, false);
});

test('an unreadable destructive preflight blocks the write and never reports a successful operation', async () => {
  const state = { busy: false };
  let writes = 0;
  let refreshCalls = 0;
  const result = await runDestructiveOperation(
    state,
    [{ characterId: 'char-1', itemId: 'item-1', quantity: 1 }],
    async () => { throw new Error('최신 조회 실패'); },
    async () => { writes += 1; },
    async () => { refreshCalls += 1; return { ok: false, errors: ['재조회 실패'] }; },
  );

  assert.equal(result.started, false);
  assert.equal(result.blocked, true);
  assert.equal(result.status, 'unknown');
  assert.equal(writes, 0);
  assert.equal(refreshCalls, 1);
});

test('bulk destructive work checks every character before the first write', async () => {
  const state = { busy: false };
  const checked = [];
  let writes = 0;
  const result = await runDestructiveOperation(
    state,
    [
      { characterId: 'char-1', itemId: 'item-1', quantity: 2 },
      { characterId: 'char-2', itemId: 'item-2', quantity: 1 },
      { characterId: 'char-3', itemId: 'item-3', quantity: 4 },
    ],
    async (characterId) => {
      checked.push(characterId);
      if (characterId === 'char-1') return { items: [{ item_id: 'item-1', quantity: 1 }] };
      if (characterId === 'char-2') throw new Error('조회 실패');
      return { items: [{ item_id: 'item-3', quantity: 4 }] };
    },
    async () => { writes += 1; },
    async () => ({ ok: true, errors: [] }),
  );

  assert.deepEqual(checked, ['char-1', 'char-2', 'char-3']);
  assert.equal(result.blocked, true);
  assert.equal(result.started, false);
  assert.equal(writes, 0);
});

test('the destructive preflight uses the existing inventory GET endpoint and never a write request', async () => {
  const requests = [];
  const api = createInventoryApi(async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: 'success', items: [{ item_id: 'item-1', quantity: 2 }] }),
    };
  }, 'https://prm.dothome.co.kr');

  const result = await verifyDestructiveTargets([
    { characterId: 'char 1', itemId: 'item-1', quantity: 2 },
  ], (characterId) => api.getInventory(characterId));

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://prm.dothome.co.kr/inventory_proc.php?mode=get_inven&char_id=char%201');
  assert.equal(requests[0].init.method, undefined);
});

test('a failed destructive write is not retried and still reports the final refresh state', async () => {
  const state = { busy: false };
  let writes = 0;
  const timeout = new Error('응답 시간 초과');
  timeout.mutationOutcomeUnknown = true;
  const result = await runDestructiveOperation(
    state,
    [{ characterId: 'char-1', itemId: 'item-1', quantity: 1 }],
    async () => ({ items: [{ item_id: 'item-1', quantity: 1 }] }),
    async () => { writes += 1; throw timeout; },
    async () => ({ ok: false, errors: ['조회 실패'] }),
  );

  assert.equal(writes, 1);
  assert.equal(result.status, 'unknown');
  assert.equal(result.refresh.ok, false);
  assert.equal(state.busy, false);
});

test('a busy mutation gate rejects duplicate entry before the operation starts', () => {
  const state = { busy: true };

  assert.equal(beginMutation(state), false);
  assert.equal(state.busy, true);

  state.busy = false;
  assert.equal(beginMutation(state), true);
  assert.equal(state.busy, true);
});

test('bulk work records each target, continues after errors, and refreshes once without retrying', async () => {
  const attempts = [];
  let refreshCalls = 0;
  const timeout = new Error('요청 응답 시간 초과');
  timeout.mutationOutcomeUnknown = true;

  const result = await runBulkOperations([
    { target: 'A', run: async () => { attempts.push('A'); } },
    { target: 'B', run: async () => { attempts.push('B'); throw new Error('서버가 요청을 거절했습니다.'); } },
    { target: 'C', run: async () => { attempts.push('C'); throw timeout; } },
  ], async () => {
    refreshCalls += 1;
    return { ok: true, errors: [] };
  });

  assert.deepEqual(attempts, ['A', 'B', 'C']);
  assert.equal(refreshCalls, 1);
  assert.equal(result.started, true);
  assert.deepEqual(
    Array.from(result.results, ({ target, status }) => [target, status]),
    [['A', 'success'], ['B', 'failed'], ['C', 'unknown']],
  );
});

test('the first failed request still triggers a refresh and is attempted only once', async () => {
  let attempts = 0;
  let refreshCalls = 0;

  const result = await runBulkOperations([
    { target: 'A', run: async () => { attempts += 1; throw new Error('요청 거절'); } },
  ], async () => {
    refreshCalls += 1;
    return { ok: true, errors: [] };
  });

  assert.equal(attempts, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(result.results[0].status, 'failed');
});

test('successful bulk work refreshes and reports every target as successful', async () => {
  let refreshCalls = 0;

  const result = await runBulkOperations([
    { target: 'A', run: async () => {} },
    { target: 'B', run: async () => {} },
  ], async () => {
    refreshCalls += 1;
    return { ok: true, errors: [] };
  });

  assert.equal(refreshCalls, 1);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every(({ status }) => status === 'success'));
});

test('a refresh error is shown as possibly stale inventory with per-target outcomes', async () => {
  const result = await runBulkOperations([
    { target: 'A', run: async () => {} },
    { target: 'B', run: async () => { throw new Error('요청 거절'); } },
  ], async () => ({ ok: false, errors: ['B 조회 실패'] }));

  const message = formatBulkMutationMessage('선택 항목 이동', result);

  assert.match(message, /성공\s*1/);
  assert.match(message, /실패\s*1/);
  assert.match(message, /A.*성공/);
  assert.match(message, /B.*실패/);
  assert.match(message, /현재 표시 수량이 최신이 아닐 수 있습니다/);
});

test('a network error without a response is unknown, while a server rejection is failed', async () => {
  const networkApi = createInventoryApi(async () => {
    throw new TypeError('Failed to fetch');
  }, 'https://prm.dothome.co.kr');

  await assert.rejects(
    networkApi.assignFolder('char-1', ['item-1'], 'folder-1'),
    (error) => error.mutationOutcomeUnknown === true,
  );

  let request;
  const rejectedApi = createInventoryApi(async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: 'failure', msg: '폴더 이동 실패' }),
    };
  }, 'https://prm.dothome.co.kr');

  await assert.rejects(
    rejectedApi.assignFolder('char-1', ['item-1'], 'folder-1'),
    (error) => error.mutationOutcomeUnknown !== true,
  );
  assert.equal(request.url, 'https://prm.dothome.co.kr/assign_item_folder.php');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.body, 'char_id=char-1&itemIds%5B%5D=item-1&folder_id=folder-1');
});

test('a pending write is aborted at its deadline, marked unknown, and followed by refresh', async () => {
  let signal;
  let requestCalls = 0;
  let refreshCalls = 0;
  const api = createInventoryApi((_url, init) => {
    requestCalls += 1;
    signal = init.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }, 'https://prm.dothome.co.kr', 5);

  const run = runBulkOperations([
    { target: 'A', run: async () => {} },
    { target: 'B', run: () => api.assignFolder('char-2', ['item-2'], 'folder-2') },
  ], async () => {
    refreshCalls += 1;
    return { ok: true, errors: [] };
  });
  const completed = await Promise.race([
    run.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);

  assert.equal(completed, true);
  const result = await run;
  assert.equal(signal.aborted, true);
  assert.equal(requestCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(
    Array.from(result.results, ({ target, status }) => [target, status]),
    [['A', 'success'], ['B', 'unknown']],
  );
});

test('valid but unrecognized mutation responses are unknown rather than definite failures', async () => {
  for (const body of [null, {}, { result: 'pending' }]) {
    const api = createInventoryApi(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    }), 'https://prm.dothome.co.kr');

    await assert.rejects(
      api.assignFolder('char-1', ['item-1'], 'folder-1'),
      (error) => error.mutationOutcomeUnknown === true,
    );
  }
});
