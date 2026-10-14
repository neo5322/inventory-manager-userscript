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

const { buildOrganizeQuickViewModel } = context.__INVENTORY_MANAGER_INTERNALS__;

test('quick organize groups items by destination and keeps the inventory image URLs for icons', () => {
  const snapshot = {
    records: [
      {
        itemId: 'root-1',
        itemName: '재료 아이템 A',
        imageUrl: 'https://prm.dothome.co.kr/uploads/item-a.webp',
        quantity: 2,
        types: ['재료'],
      },
      {
        itemId: 'root-2',
        itemName: '재료 아이템 B',
        imageUrl: 'uploads/item-b.webp',
        quantity: 1,
        types: ['재료', '선물'],
      },
      {
        itemId: 'root-3',
        itemName: '선물 아이템 C',
        imageUrl: 'https://prm.dothome.co.kr/uploads/item-c.webp',
        quantity: 5,
        types: ['선물'],
      },
      {
        itemId: 'root-4',
        itemName: '분류 없는 아이템',
        imageUrl: '',
        quantity: 1,
        types: [],
      },
      {
        itemId: 'root-5',
        itemName: '선물 아이템 D',
        imageUrl: 'https://prm.dothome.co.kr/uploads/item-d.webp',
        quantity: 3,
        types: ['선물'],
      },
    ],
  };
  const decisions = [
    { itemId: 'root-1', target: 'folder-a', suggestion: '', tier: 'ready', reason: '같은 아이템이 있는 폴더' },
    { itemId: 'root-2', target: 'folder-a', suggestion: '', tier: 'ready', reason: '같은 아이템이 있는 폴더' },
    { itemId: 'root-3', target: '', suggestion: 'folder-b', tier: 'review', reason: '아이템 종류와 폴더 이름 일치' },
    { itemId: 'root-4', target: '', suggestion: '', tier: 'stay', reason: '맞는 폴더를 찾지 못함', types: [] },
    { itemId: 'root-5', target: '', suggestion: '', tier: 'stay', reason: '맞는 폴더를 찾지 못함', types: ['선물'] },
  ];

  const groups = buildOrganizeQuickViewModel(
    snapshot,
    decisions,
    'https://prm.dothome.co.kr/',
  );

  assert.equal(groups.length, 4);
  assert.equal(groups[0].key, 'target:folder-a');
  assert.deepEqual(Array.from(groups[0].items, (item) => item.decision.itemId), ['root-1', 'root-2']);
  assert.equal(groups[0].items[0].imageUrl, 'https://prm.dothome.co.kr/uploads/item-a.webp');
  assert.equal(groups[0].items[1].imageUrl, 'https://prm.dothome.co.kr/uploads/item-b.webp');
  assert.equal(groups[0].items[1].quantity, 1);
  assert.deepEqual(Array.from(groups[0].items[1].types), ['재료', '선물']);
  assert.equal(groups[1].key, 'suggestion:folder-b');
  assert.equal(groups[1].items[0].imageUrl, 'https://prm.dothome.co.kr/uploads/item-c.webp');
  const untyped = groups.find((group) => group.key === 'unassigned:맞는 폴더를 찾지 못함');
  const gifts = groups.find((group) => group.key === 'unassigned:선물');
  assert.equal(untyped.items[0].decision.itemId, 'root-4');
  assert.equal(untyped.items[0].imageUrl, '');
  assert.equal(gifts.items[0].decision.itemId, 'root-5');
  assert.equal(gifts.items[0].imageUrl, 'https://prm.dothome.co.kr/uploads/item-d.webp');
});
