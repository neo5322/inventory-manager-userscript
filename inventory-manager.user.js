// ==UserScript==
// @name         인벤토리 매니저
// @namespace    inventory-manager
// @homepageURL  https://github.com/neo5322/inventory-manager-userscript
// @supportURL   https://github.com/neo5322/inventory-manager-userscript/issues
// @updateURL    https://raw.githubusercontent.com/neo5322/inventory-manager-userscript/main/inventory-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/neo5322/inventory-manager-userscript/main/inventory-manager.user.js
// @version      2.5.0
// @description  인벤토리 관리, 누이 이미지 페이지 분할·간략화 및 개별/ZIP 저장을 지원합니다.
// @match        https://prm.dothome.co.kr/my_page*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const win = typeof window !== 'undefined' ? window : globalThis;

  const GRADE_ORDER = ['ultra_rare', 'secret', 'ex', 'epic', 'unique', 'rare', 'uncommon', 'common', 'normal', 'unknown'];
  const GRADE_DEFINITIONS = {
    ultra_rare: { label: '울트라레어', color: '#b7791f' },
    secret: { label: '시크릿', color: '#8b5cf6' },
    ex: { label: 'EX', color: '#db2777' },
    epic: { label: '에픽', color: '#ea580c' },
    unique: { label: '유니크', color: '#7c3aed' },
    rare: { label: '레어', color: '#2563eb' },
    uncommon: { label: '언커먼', color: '#059669' },
    common: { label: '커먼', color: '#64748b' },
    normal: { label: '일반', color: '#64748b' },
    unknown: { label: '기타', color: '#64748b' },
  };

  const GRADE_ALIASES = {
    'ultra-rare': 'ultra_rare',
    'ultra rare': 'ultra_rare',
    ultrarare: 'ultra_rare',
    ur: 'ultra_rare',
    울트라레어: 'ultra_rare',
    '울트라 레어': 'ultra_rare',
    secret: 'secret',
    s: 'secret',
    시크릿: 'secret',
    normal: 'normal',
    n: 'normal',
    일반: 'normal',
    common: 'common',
    uncommon: 'uncommon',
    rare: 'rare',
    unique: 'unique',
    epic: 'epic',
    ex: 'ex',
  };

  const NUI_STATUS = {
    available: { label: '교환 가능', tone: 'success' },
    unavailable: { label: '교환 불가', tone: 'danger' },
    unclassified: { label: '미분류', tone: 'warning' },
  };

  const CANVAS = {
    width: 1200,
    margin: 48,
    gap: 18,
    columns: 4,
    tileHeight: 314,
    compactTileHeight: 96,
    maxImageHeight: 4200,
    maxUnsplitHeight: 32000,
    sectionGap: 28,
    headerHeight: 164,
    sectionHeaderHeight: 82,
  };

  function normalizeItemName(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
  }


  // BEGIN NUI WANTED CORE
  function normalizeNuiWantedText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ko');
  }

  function isExcludedNuiWantedCard(card) {
    return normalizeItemName(card && card.name)
      === '밤피누이 No.81 요염한 네이처 밤피';
  }

  function getPrmUploadUrl(value) {
    const raw = String(value || '').trim();
    if (!/^(?:https:\/\/prm\.dothome\.co\.kr\/uploads\/|\/?uploads\/)/i.test(raw)) {
      return '';
    }
    try {
      const url = new URL(raw, 'https://prm.dothome.co.kr/');
      return url.origin === 'https://prm.dothome.co.kr'
        && !url.username && !url.password
        && url.pathname.startsWith('/uploads/')
        ? url.href
        : '';
    } catch (_) {
      return '';
    }
  }

  function normalizeNuiDownloadMode(value) {
    return value === 'zip' ? 'zip' : 'individual';
  }

  function getNuiPageFilename(baseName, date, pageIndex, pageCount) {
    const page = String(pageIndex + 1).padStart(2, '0');
    const total = String(pageCount).padStart(2, '0');
    return `${baseName}-${date}-page-${page}-of-${total}.png`;
  }

  function canDownloadAllNuiPages(preview, splitPages) {
    return Boolean(
      splitPages
      && preview
      && Array.isArray(preview.pages)
      && preview.pages.length > 1,
    );
  }

  function getOrdinaryNuiCatalog(cards) {
    const seen = new Set();
    const catalog = [];

    (cards || []).forEach((card) => {
      const name = normalizeItemName(card && card.name);
      const rawImage = String(card && card.image || '').trim();
      const image = getPrmUploadUrl(rawImage);
      const grade = String(card && card.grade || '').trim();

      if (
        !name
        || !image || image !== rawImage
        || (card && card.isSecret)
        || /시크릿|secret/i.test(name)
        || /시크릿|secret/i.test(grade)
        || /(?:티켓|선택권|랜덤)/i.test(name)
      ) {
        return;
      }

      const key = JSON.stringify([name, image]);
      if (seen.has(key)) return;
      seen.add(key);

      catalog.push({
        key,
        name,
        image,
        category: normalizeItemName(card.category) || '기타',
        grade: grade || 'common',
      });
    });

    return catalog;
  }

  function getVerifiedSecretNuiCatalog(cards) {
    const seen = new Set();
    const catalog = [];

    (cards || []).forEach((card) => {
      const name = normalizeItemName(card && card.name);
      const rawImage = String(card && card.image || '').trim();
      const image = getPrmUploadUrl(rawImage);
      const category = normalizeItemName(card && card.category) || '기타';

      if (
        !name
        || !/(?:누이|누잏)/i.test(name)
        || !/No\s*\.\s*\d+/i.test(name)
        || !/시크릿|secret/i.test(name)
        || !image || image !== rawImage
      ) {
        return;
      }

      const key = JSON.stringify([name, image]);
      if (seen.has(key)) return;
      seen.add(key);

      catalog.push({
        key,
        name,
        image,
        category,
        grade: 'secret',
        isSecret: true,
      });
    });

    return catalog;
  }

  function filterNuiWantedCatalog(catalog, query, category) {
    const normalizedQuery = normalizeNuiWantedText(query);
    const normalizedCategory = String(category || 'all');

    return (catalog || []).filter((card) => {
      if (isExcludedNuiWantedCard(card)) return false;

      if (
        normalizedCategory !== 'all'
        && card.category !== normalizedCategory
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      return normalizeNuiWantedText(
        [card.name, card.category].join(' '),
      ).includes(normalizedQuery);
    });
  }

  function getSelectedNuiWantedCards(catalog, selectedKeys) {
    const selected = selectedKeys instanceof Set
      ? selectedKeys
      : new Set(selectedKeys || []);

    return (catalog || []).filter(
      (card) =>
        selected.has(card.key)
        && !isExcludedNuiWantedCard(card),
    );
  }

  function toNuiWantedImageRecords(cards) {
    return (cards || [])
      .filter((card) => !isExcludedNuiWantedCard(card))
      .map((card) => ({
        key: card.key,
        itemName: card.name,
        imageUrl: card.image,
        characterId: 'wanted:' + card.category,
        characterName: card.category,
        folderName: card.category,
        category: card.category,
        grade: card.grade,
        quantity: 1,
        status: 'wanted',
      }));
  }

  function groupNuiWantedImageRecords(items, compact = false) {
    const groups = [];
    const map = new Map();

    (items || []).forEach((item) => {
      const category = compact
        ? getNuiTypeLabel(item)
        : normalizeItemName(
            item.category || item.characterName || item.folderName,
          ) || '기타';

      if (!map.has(category)) {
        const group = {
          key: category,
          characterName: category,
          ownerName: '',
          items: [],
        };

        map.set(category, group);
        groups.push(group);
      }

      map.get(category).items.push(item);
    });

    return groups;
  }

  function getNuiTypeLabel(item) {
    const name = normalizeItemName(
      item && (item.itemName || item.name),
    );

    if (/^메이드\s*누이/i.test(name)) return '메이드';
    if (/^미코\s*누이/i.test(name)) return '미코';
    if (/^스쿨\s*누이/i.test(name)) return '스쿨';
    if (/^아이돌\s*누이/i.test(name)) return '아이돌';
    if (/^누잏/i.test(name)) return '누잏';

    const category = normalizeItemName(
      item && item.category,
    );
    if (category) return category;
    return '기타';
  }

  function getNuiItemNumber(item) {
    if (
      item
      && item.number !== undefined
      && item.number !== null
      && String(item.number).trim() !== ''
    ) {
      const supplied = Number(item.number);
      if (Number.isFinite(supplied)) return supplied;
    }

    const name = normalizeItemName(
      item && (item.itemName || item.name),
    );
    const match = name.match(/(?:^|\s)No\.?\s*(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : Infinity;
  }

  function getNuiCharacterAlias(item) {
    const name = normalizeItemName(
      item && (item.itemName || item.name),
    );
    const match = name.match(/(?:^|\s)No\.?\s*\d+(?:\.\d+)?\s*(.*)$/i);
    return normalizeItemName(
      match && match[1]
        || item && (item.characterAlias || item.alias || item.characterName)
        || name,
    );
  }

  function compareNuiImageItems(left, right) {
    const typeComparison = getNuiTypeLabel(left).localeCompare(
      getNuiTypeLabel(right),
      'ko',
      { sensitivity: 'base', numeric: true },
    );
    if (typeComparison) return typeComparison;

    const leftNumber = getNuiItemNumber(left);
    const rightNumber = getNuiItemNumber(right);
    if (leftNumber !== rightNumber) {
      return leftNumber < rightNumber ? -1 : 1;
    }

    const aliasComparison = getNuiCharacterAlias(left).localeCompare(
      getNuiCharacterAlias(right),
      'ko',
      { sensitivity: 'base', numeric: true },
    );
    if (aliasComparison) return aliasComparison;

    return normalizeItemName(left && (left.itemName || left.name)).localeCompare(
      normalizeItemName(right && (right.itemName || right.name)),
      'ko',
      { sensitivity: 'base', numeric: true },
    );
  }

  function sortNuiImageItems(items) {
    const collator = new Intl.Collator('ko', {
      sensitivity: 'base',
      numeric: true,
    });

    return (items || [])
      .map((item, index) => ({
        item,
        index,
        type: getNuiTypeLabel(item),
        number: getNuiItemNumber(item),
        alias: getNuiCharacterAlias(item),
        name: normalizeItemName(item && (item.itemName || item.name)),
      }))
      .sort((left, right) =>
        collator.compare(left.type, right.type)
        || (left.number < right.number ? -1 : left.number > right.number ? 1 : 0)
        || collator.compare(left.alias, right.alias)
        || collator.compare(left.name, right.name)
        || left.index - right.index,
      )
      .map(({ item }) => item);
  }

  function getNuiPreviewGroupKey(item, mode, compact) {
    return getNuiTypeLabel(item);
  }

  function crc32Bytes(value) {
    const bytes = new Uint8Array(value);
    const table = new Uint32Array(256);

    for (let index = 0; index < table.length; index += 1) {
      let valueAtIndex = index;
      for (let bit = 0; bit < 8; bit += 1) {
        valueAtIndex = valueAtIndex & 1
          ? 0xedb88320 ^ (valueAtIndex >>> 1)
          : valueAtIndex >>> 1;
      }
      table[index] = valueAtIndex >>> 0;
    }

    let checksum = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      checksum = table[(checksum ^ bytes[index]) & 0xff] ^ (checksum >>> 8);
    }

    return (checksum ^ 0xffffffff) >>> 0;
  }

  function buildStoredZipBytes(entries, createdAt = new Date()) {
    const files = entries || [];
    if (!files.length) throw new Error('ZIP에 저장할 PNG가 없습니다.');
    if (files.length > 0xffff) throw new Error('ZIP 항목 수 제한을 넘었습니다.');

    const date = createdAt instanceof Date
      ? createdAt
      : new Date(createdAt);
    const dosTime = (date.getHours() << 11)
      | (date.getMinutes() << 5)
      | Math.floor(date.getSeconds() / 2);
    const dosDate = (Math.max(0, Math.min(127, date.getFullYear() - 1980)) << 9)
      | ((date.getMonth() + 1) << 5)
      | date.getDate();
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    files.forEach((entry) => {
      const nameBytes = encoder.encode(String(entry.name || 'page.png'));
      const dataBytes = new Uint8Array(entry.data || []);
      const size = dataBytes.byteLength;

      if (nameBytes.byteLength > 0xffff) {
        throw new Error('ZIP 파일 이름이 너무 깁니다.');
      }
      if (
        size > 0xffffffff
        || localOffset + 30 + nameBytes.byteLength + size > 0xffffffff
      ) {
        throw new Error('ZIP 파일 크기가 4GB 제한을 넘었습니다.');
      }

      const checksum = crc32Bytes(dataBytes);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, size, true);
      localView.setUint32(22, size, true);
      localView.setUint16(26, nameBytes.byteLength, true);
      localView.setUint16(28, 0, true);
      localParts.push(localHeader, nameBytes, dataBytes);

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, size, true);
      centralView.setUint32(24, size, true);
      centralView.setUint16(28, nameBytes.byteLength, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralParts.push(centralHeader, nameBytes);

      localOffset += localHeader.byteLength + nameBytes.byteLength + size;
      centralSize += centralHeader.byteLength + nameBytes.byteLength;
    });

    if (localOffset + centralSize + 22 > 0xffffffff) {
      throw new Error('ZIP 전체 크기가 4GB 제한을 넘었습니다.');
    }

    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    endView.setUint16(20, 0, true);

    const result = new Uint8Array(localOffset + centralSize + endRecord.byteLength);
    let cursor = 0;
    [...localParts, ...centralParts, endRecord].forEach((part) => {
      result.set(part, cursor);
      cursor += part.byteLength;
    });

    return result;
  }

  function getNuiPreviewPageHeight(
    items,
    mode,
    compact,
    layout = CANVAS,
  ) {
    const counts = new Map();

    (items || []).forEach((item) => {
      const key = getNuiPreviewGroupKey(item, mode, compact);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const tileHeight = compact
      ? layout.compactTileHeight
      : layout.tileHeight;
    const columns = Math.max(1, Number(layout.columns) || 1);
    let height = Math.max(440, layout.headerHeight || 0);

    counts.forEach((count) => {
      height += layout.sectionHeaderHeight
        + Math.ceil(count / columns) * tileHeight
        + layout.sectionGap;
    });

    return height;
  }

  function paginateNuiImageItems(
    items,
    mode,
    compact,
    layout = CANVAS,
    splitPages = true,
  ) {
    if (!splitPages) {
      const singlePage = Array.from(items || []);
      return singlePage.length ? [singlePage] : [];
    }

    const pages = [];
    let page = [];
    let counts = new Map();
    let height = Math.max(440, layout.headerHeight || 0);
    const tileHeight = compact
      ? layout.compactTileHeight
      : layout.tileHeight;
    const columns = Math.max(1, Number(layout.columns) || 1);
    const maxHeight = Number(layout.maxImageHeight) || 4200;

    (items || []).forEach((item) => {
      const key = getNuiPreviewGroupKey(item, mode, compact);
      let count = counts.get(key) || 0;
      let addedHeight = count
        ? (count % columns === 0 ? tileHeight : 0)
        : layout.sectionHeaderHeight + tileHeight + layout.sectionGap;

      if (page.length && height + addedHeight > maxHeight) {
        pages.push(page);
        page = [];
        counts = new Map();
        height = Math.max(440, layout.headerHeight || 0);
        count = 0;
        addedHeight = layout.sectionHeaderHeight
          + tileHeight
          + layout.sectionGap;
      }

      if (height + addedHeight > maxHeight) {
        throw new Error('페이지 높이 제한보다 Canvas 헤더가 큽니다.');
      }

      page.push(item);
      counts.set(key, count + 1);
      height += addedHeight;
    });

    if (page.length) pages.push(page);
    return pages;
  }

  function getNuiModalChoiceCards(choices) {
    return (choices || []).flatMap((choice) => {
      if (!choice || choice.type !== 'item') return [];

      const name = normalizeItemName(choice.item_name);
      const image = getPrmUploadUrl(choice.img_url);
      if (!image) return [];

      const categoryMatch = name.match(/^(.+?)\s*누이(?:\s|$)/i);
      return [{
        name,
        image,
        category: normalizeItemName(categoryMatch && categoryMatch[1])
          || getNuiTypeLabel({ name }),
        grade: String(choice.item_grade || '').trim(),
      }];
    });
  }

  function getNuiWantedCatalog(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      throw new Error('누이 구해요 소스 목록이 비어 있습니다.');
    }
    const seen = new Set();
    const catalog = [];
    const sourceIds = new Set();

    (sources || []).forEach((source) => {
      if (!source || !['ordinary', 'secret'].includes(source.kind)
        || !['catalog', 'modal'].includes(source.format)
        || !/^[a-z0-9][a-z0-9-]*$/.test(source.id || '')
        || sourceIds.has(source.id)
        || !Array.isArray(source.cards)
        || !source.cards.length) {
        throw new Error('알 수 없는 누이 구해요 소스 형식입니다.');
      }
      sourceIds.add(source.id);

      const sourceCards = source.format === 'modal'
        ? getNuiModalChoiceCards(source.cards)
        : source.cards;
      const cards = source.kind === 'secret'
        ? getVerifiedSecretNuiCatalog(sourceCards)
        : getOrdinaryNuiCatalog(sourceCards);
      if (cards.length !== source.cards.length) {
        throw new Error(`누이 구해요 소스 ${source.id}에 누락·중복 항목이 있습니다.`);
      }

      cards.forEach((card) => {
        if (isExcludedNuiWantedCard(card) || seen.has(card.key)) return;
        seen.add(card.key);
        catalog.push(card);
      });
    });

    return catalog;
  }

  async function loadNuiWantedCatalog(fetchImpl, baseUrl) {
    const readJson = async (file) => {
      const response = await fetchImpl(new URL(file, baseUrl).href, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`누이 구해요 소스 ${file} 조회 실패 (${response.status})`);
      }
      return response.json();
    };

    const manifest = await readJson('manifest.json');
    if (manifest && manifest.schemaVersion !== 1) {
      throw new Error('지원하지 않는 누이 구해요 목록 버전입니다.');
    }
    if (!manifest || !Array.isArray(manifest.sources)
      || !manifest.sources.length || manifest.sources.length > 50) {
      throw new Error('누이 구해요 소스 목록이 올바르지 않습니다.');
    }

    const sources = await Promise.all(manifest.sources.map(async (entry) => {
      if (!entry || !/^sources\/[a-z0-9-]+\.json$/.test(entry.file || '')) {
        throw new Error('누이 구해요 소스 파일 경로가 올바르지 않습니다.');
      }
      return { ...entry, cards: await readJson(entry.file) };
    }));

    const cards = getNuiWantedCatalog(sources);
    if (!cards.length) {
      throw new Error('누이 구해요 목록이 비어 있습니다.');
    }
    return { sources, cards };
  }
  // END NUI WANTED CORE

  const NUI_WANTED_SOURCE_URL =
    'https://raw.githubusercontent.com/neo5322/inventory-manager-userscript/main/catalog/nui-wanted/';
  const NUI_WANTED_CACHE_KEY = 'manosaba-inventory-manager:nui-wanted-catalog:v1';

  function toQuantity(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function splitItemTypes(value) {
    return String(value ?? '')
      .split(',')
      .map((type) => normalizeItemName(type))
      .filter(Boolean);
  }

  function normalizeHidden(value) {
    return value === true
      || value === 1
      || value === '1'
      || String(value).toLowerCase() === 'true';
  }

  function normalizeFolder(raw) {
    return {
      id: String((raw && (raw.id ?? raw.folder_id)) ?? ''),
      name: normalizeItemName(raw && (raw.name ?? raw.folder_name)),
      isHidden: normalizeHidden(raw && raw.is_hidden),
    };
  }

  function normalizeInventoryRecord(raw, character, folders) {
    const itemId = String((raw && (raw.item_id ?? raw.id)) ?? '');
    const folderId = String((raw && raw.folder_id) ?? '0');

    return {
      key: `${character.characterId}:${itemId}`,
      itemId,
      characterId: String(character.characterId),
      characterName: character.characterName,
      ownerName: character.ownerName || '',
      itemName: normalizeItemName(raw && raw.item_name),
      quantity: toQuantity(raw && raw.quantity),
      types: splitItemTypes(raw && raw.item_type),
      folderId,
      folderName: folders.get(folderId) || '폴더 밖',
      grade: normalizeGrade(raw && (raw.item_grade ?? raw.grade)),
      boxType: String(raw && raw.box_type || 'none'),
      imageUrl: String(raw && (raw.img_url ?? raw.image_url) || ''),
    };
  }

  function normalizeGrade(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return 'unknown';

    const compact = raw.replace(/[\s-]+/g, '_');

    return GRADE_ALIASES[raw]
      || GRADE_ALIASES[compact]
      || (GRADE_DEFINITIONS[compact] ? compact : 'unknown');
  }

  function gradeInfo(value) {
    const key = normalizeGrade(value);

    return {
      key,
      ...(GRADE_DEFINITIONS[key] || GRADE_DEFINITIONS.unknown),
    };
  }

  function chooseType(types, priority) {
    const list = Array.isArray(types) ? types : [];
    const preferred = (priority || []).find((type) => list.includes(type));

    return preferred || list[0] || '';
  }

  function sortInventory(records, rule) {
    const collator = new Intl.Collator('ko', {
      numeric: true,
      sensitivity: 'base',
    });

    const rank = (grade) => {
      const index = GRADE_ORDER.indexOf(normalizeGrade(grade));
      return index < 0 ? GRADE_ORDER.length : index;
    };

    return (records || [])
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        let comparison = 0;

        if (rule === 'quantity') {
          comparison = toQuantity(right.item.quantity) - toQuantity(left.item.quantity);
        } else if (rule === 'grade') {
          comparison = rank(left.item.grade) - rank(right.item.grade);
        } else if (rule === 'type') {
          comparison = collator.compare(
            (left.item.types || [])[0] || '',
            (right.item.types || [])[0] || '',
          );
        } else if (rule === 'compound') {
          comparison =
            collator.compare(left.item.characterName || '', right.item.characterName || '')
            || collator.compare(left.item.folderName || '', right.item.folderName || '')
            || collator.compare(left.item.itemName || '', right.item.itemName || '');
        } else if (rule === 'nui-number') {
          const leftIsNui = isNuiItemName(left.item.itemName);
          const rightIsNui = isNuiItemName(right.item.itemName);

          if (leftIsNui !== rightIsNui) {
            comparison = leftIsNui ? -1 : 1;
          } else if (leftIsNui) {
            comparison = compareNuiImageItems(left.item, right.item);
          } else {
            comparison = collator.compare(
              left.item.itemName || '',
              right.item.itemName || '',
            );
          }
        } else {
          comparison = collator.compare(
            left.item.itemName || '',
            right.item.itemName || '',
          );
        }

        return comparison || left.index - right.index;
      })
      .map(({ item }) => item);
  }

  function filterInventory(records, filters) {
    const query = normalizeItemName(filters && filters.query)
      .toLocaleLowerCase('ko');

    const characterId = String(filters && filters.characterId || 'all');
    const folderId = String(filters && filters.folderId || 'all');
    const type = String(filters && filters.type || 'all');
    const grade = String(filters && filters.grade || 'all');

    return (records || []).filter((record) => {
      if (
        characterId !== 'all'
        && String(record.characterId) !== characterId
      ) {
        return false;
      }

      if (
        folderId !== 'all'
        && String(record.folderId) !== folderId
      ) {
        return false;
      }

      if (
        type !== 'all'
        && !(record.types || []).includes(type)
      ) {
        return false;
      }

      if (
        grade !== 'all'
        && normalizeGrade(record.grade) !== grade
      ) {
        return false;
      }

      if (!query) return true;

      const haystack = [
        record.itemName,
        record.characterName,
        record.folderName,
        ...(record.types || []),
      ]
        .join(' ')
        .toLocaleLowerCase('ko');

      return haystack.includes(query);
    });
  }

  function summarizeSnapshots(snapshots) {
    const successful = (snapshots || [])
      .filter((snapshot) => !snapshot.error);

    const records = successful
      .flatMap((snapshot) => snapshot.records || []);

    const counts = new Map();

    records.forEach((record) => {
      counts.set(
        String(record.itemId),
        (counts.get(String(record.itemId)) || 0) + 1,
      );
    });

    return {
      characterCount: successful.length,
      itemCount: records.length,
      rootItemCount: records.filter(
        (record) => String(record.folderId) === '0',
      ).length,
      duplicateItemIds: [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([itemId]) => itemId),
      errors: (snapshots || [])
        .filter((snapshot) => snapshot.error)
        .map((snapshot) => String(snapshot.error)),
    };
  }

  function countExchangeTickets(records) {
    return (records || [])
      .filter(
        (record) =>
          normalizeItemName(record.itemName).replace(/\s/g, '')
          === '야사:교환권',
      )
      .reduce(
        (total, record) => total + toQuantity(record.quantity),
        0,
      );
  }

  const USERSCRIPT_UPDATE_URL =
    'https://raw.githubusercontent.com/neo5322/inventory-manager-userscript/main/inventory-manager.user.js';
  const USERSCRIPT_UPDATE_INTERVAL = 12 * 60 * 60 * 1000;

  function parseUserscriptVersion(source) {
    const match = String(source || '').match(/^\s*\/\/\s*@version\s+([0-9]+(?:\.[0-9]+)*)\s*$/m);
    return match ? match[1] : '';
  }

  function compareUserscriptVersions(left, right) {
    const parse = (value) => {
      const version = String(value || '').trim();
      if (!/^\d+(?:\.\d+)*$/.test(version)) {
        throw new Error(`잘못된 버전 형식입니다: ${version}`);
      }
      return version.split('.').map((part) => {
        const number = Number(part);
        if (!Number.isSafeInteger(number)) {
          throw new Error(`잘못된 버전 형식입니다: ${version}`);
        }
        return number;
      });
    };
    const leftParts = parse(left);
    const rightParts = parse(right);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function getUserscriptUpdateState(installedVersion, latestVersion) {
    return compareUserscriptVersions(latestVersion, installedVersion) > 0
      ? 'available'
      : 'current';
  }

  function shouldCheckUserscriptUpdate(lastCheckedAt, now = Date.now(), manual = false) {
    if (manual) return true;
    const last = Number(lastCheckedAt);
    const current = Number(now);
    return !Number.isFinite(last)
      || last <= 0
      || !Number.isFinite(current)
      || current - last >= USERSCRIPT_UPDATE_INTERVAL;
  }

  function escapeMarkup(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderUserscriptUpdateStatusMarkup(updateInfo) {
    const info = updateInfo || {};
    const installed = escapeMarkup(info.installedVersion || '확인 불가');
    const button = info.status === 'checking'
      ? '<button class="im2-button" type="button" disabled>업데이트 확인 중…</button>'
      : '<button class="im2-button" type="button" data-action="check-script-update">업데이트 확인</button>';
    let message = `현재 설치 버전 ${installed}`;
    let installLink = '';
    if (info.status === 'checking') {
      message += ' · 업데이트를 확인하고 있습니다.';
    } else if (info.status === 'current') {
      message += ` · 최신 버전입니다${info.latestVersion ? ` (${escapeMarkup(info.latestVersion)})` : ''}.`;
    } else if (info.status === 'available') {
      const latest = escapeMarkup(info.latestVersion || '새 버전');
      message += ` · ${latest} 업데이트를 사용할 수 있습니다.`;
      installLink = `<a class="im2-button im2-button-primary" href="${USERSCRIPT_UPDATE_URL}" target="_blank" rel="noopener">업데이트 설치</a>`;
    } else if (info.status === 'error') {
      message += ` · 확인 실패: ${escapeMarkup(info.error || '잠시 후 다시 시도해 주세요.')}`;
    } else {
      message += ' · 업데이트 확인 전입니다.';
    }
    return `<div class="im2-update-status" role="status"><p>${message}</p><div class="im2-update-actions">${installLink}${button}</div></div>`;
  }

  const TRACKED_QUANTITY_ITEMS = [
    {
      key: 'pumpkin-bronze-trophy',
      label: '호박 동상 트로핖',
      aliases: ['호박 동상 트로핖', '호박 동상 트로피'],
    },
    {
      key: 'ghost-silver-trophy',
      label: '유령 은상 트로핖',
      aliases: ['유령 은상 트로핖', '유령 은상 트로피'],
    },
    {
      key: 'sacrifice-ticket',
      label: '제물 티켓',
      aliases: ['제물 티켓'],
    },
  ].map((item) => ({
    ...item,
    aliasKeys: new Set(item.aliases.map((alias) =>
      normalizeItemName(alias).replace(/\s/g, '').toLocaleLowerCase('ko'),
    )),
  }));

  function summarizeTrackedItemQuantities(snapshots) {
    const list = Array.isArray(snapshots) ? snapshots : [];
    const successful = list.filter((snapshot) => snapshot && !snapshot.error);
    const errors = list.filter((snapshot) => snapshot && snapshot.error).map((snapshot) => ({
      characterId: String(snapshot.characterId ?? ''),
      characterName: String(snapshot.characterName || snapshot.characterId || '캐릭터'),
      error: String(snapshot.error),
    }));
    const byItem = new Map(TRACKED_QUANTITY_ITEMS.map((item) => [item.key, new Map()]));

    successful.forEach((snapshot) => {
      (snapshot.records || []).forEach((record) => {
        const itemName = normalizeItemName(record && record.itemName)
          .replace(/\s/g, '')
          .toLocaleLowerCase('ko');
        const definition = TRACKED_QUANTITY_ITEMS.find((item) => item.aliasKeys.has(itemName));
        if (!definition) return;
        const quantity = toQuantity(record && record.quantity);
        if (!quantity) return;

        const characterId = String(snapshot.characterId ?? record.characterId ?? '');
        const characterName = String(snapshot.characterName || record.characterName || characterId || '캐릭터');
        const characters = byItem.get(definition.key);
        const character = characters.get(characterId) || {
          characterId,
          characterName,
          quantity: 0,
        };
        character.quantity += quantity;
        characters.set(characterId, character);
      });
    });

    const items = TRACKED_QUANTITY_ITEMS.map((definition) => {
      const characters = [...byItem.get(definition.key).values()]
        .sort((left, right) =>
          left.characterName.localeCompare(right.characterName, 'ko')
          || left.characterId.localeCompare(right.characterId, 'ko'),
        );
      return {
        key: definition.key,
        label: definition.label,
        total: characters.reduce((total, character) => total + character.quantity, 0),
        characters,
      };
    });

    return {
      hasData: successful.length > 0,
      hasErrors: errors.length > 0,
      errors,
      items,
    };
  }

  function renderTrackedQuantityMarkup(summary) {
    const data = summary || summarizeTrackedItemQuantities([]);
    if (!data.hasData) {
      const errors = (data.errors || []).map((entry) =>
        `<li><strong>${escapeMarkup(entry.characterName)}</strong>: ${escapeMarkup(entry.error)}</li>`,
      ).join('');
      return `<section class="im2-tracked-quantities" aria-labelledby="im2-tracked-quantity-title"><header class="im2-section-heading"><div><h2 id="im2-tracked-quantity-title">수량 현황</h2><p>캐릭터 인벤토리를 불러오면 아이템별 합계와 캐릭터별 수량을 표시합니다.</p></div></header><div class="im2-empty-state"><p>아직 인벤토리 조회 결과가 없습니다.</p><button class="im2-button im2-button-primary" type="button" data-action="refresh">인벤토리 새로고침</button>${errors ? `<ul class="im2-tracked-errors">${errors}</ul>` : ''}</div></section>`;
    }

    const cards = (data.items || []).map((item) => {
      const characters = (item.characters || []).map((character) =>
        `<li><span>${escapeMarkup(character.characterName)}</span><strong>${new Intl.NumberFormat('ko-KR').format(character.quantity)}개</strong></li>`,
      ).join('');
      return `<article class="im2-tracked-card" data-item-key="${escapeMarkup(item.key)}"><header><h3>${escapeMarkup(item.label)}</h3><strong class="im2-tracked-total">${new Intl.NumberFormat('ko-KR').format(item.total)}개</strong></header>${characters ? `<ul>${characters}</ul>` : '<p class="im2-muted">보유 수량 없음</p>'}</article>`;
    }).join('');
    const errors = data.hasErrors
      ? `<aside class="im2-tracked-partial" role="status"><strong>일부 캐릭터 조회 실패</strong><ul>${(data.errors || []).map((entry) =>
        `<li><strong>${escapeMarkup(entry.characterName)}</strong>: ${escapeMarkup(entry.error)}</li>`,
      ).join('')}</ul><p>표시된 합계는 조회에 성공한 캐릭터만 포함합니다.</p></aside>`
      : '';
    return `<section class="im2-tracked-quantities" aria-labelledby="im2-tracked-quantity-title"><header class="im2-section-heading"><div><h2 id="im2-tracked-quantity-title">수량 현황</h2><p>전체 보유 수량과 캐릭터별 수량</p></div></header><div class="im2-tracked-grid">${cards}</div>${errors}</section>`;
  }

  function isNuiItemName(value) {
    const name = normalizeItemName(value);

    // '스쿨누이' 계열은 No. 번호 표기 없이 등록된 항목도 누이로 인식합니다.
    if (/스쿨\s*누이/.test(name)) return true;

    return /(?:누이|누잏)/.test(name)
      && /No\s*\.\s*\d+/i.test(name);
  }

  function resolveImageUrl(value, baseOrigin) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
      const url = new URL(raw, baseOrigin);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function nuiDuplicateKey(item) {
    const name = normalizeItemName(item.itemName).toLocaleLowerCase('ko');
    const image = resolveImageUrl(item.imageUrl, 'https://prm.dothome.co.kr/');
    return JSON.stringify([name, image]);
  }

  function makeNuiRecords(records, savedStatuses, duplicateMode = false, starredKeys = []) {
    const statuses = savedStatuses || {};
    const starred = new Set(starredKeys);
    const items = (records || [])
      .filter((record) => isNuiItemName(record.itemName))
      .map((record) => ({
        ...record,
        status: NUI_STATUS[statuses[record.key]]
          ? statuses[record.key]
          : 'unclassified',
        starred: starred.has(nuiDuplicateKey(record)),
        tradeQuantity: 0,
      }));

    if (!duplicateMode) {
      items.forEach((item) => {
        item.tradeQuantity = item.status === 'available'
          ? toQuantity(item.quantity) : 0;
      });
      return items;
    }

    const groups = new Map();
    items.forEach((item) => {
      const key = nuiDuplicateKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    groups.forEach((group) => {
      if (group[0].starred) return;
      const protectedCount = group
        .filter((item) => item.status === 'unavailable')
        .reduce((sum, item) => sum + toQuantity(item.quantity), 0);
      let reserve = protectedCount ? 0 : 1;
      const candidates = group.filter((item) => item.status !== 'unavailable')
        .sort((left, right) =>
          Number(left.status === 'available') - Number(right.status === 'available')
          || String(left.key).localeCompare(String(right.key)));
      candidates.forEach((item) => {
        const quantity = toQuantity(item.quantity);
        const kept = Math.min(quantity, reserve);
        item.tradeQuantity = quantity - kept;
        reserve -= kept;
      });
    });
    return items;
  }

  function countStatuses(items) {
    return (items || []).reduce(
      (counts, item) => {
        const key = NUI_STATUS[item.status]
          ? item.status
          : 'unclassified';

        counts[key] += 1;
        return counts;
      },
      {
        available: 0,
        unavailable: 0,
        unclassified: 0,
      },
    );
  }

  function buildAutoOrganizePlan(snapshot, options) {
    const protectedIds = new Set(((options && options.protectedFolderIds) || [])
      .map(String));
    const priority = (options && options.typePriority) || [];
    const rules = (options && options.itemRules) || {};
    const overrides = (options && options.itemOverrides) || {};
    const records = snapshot.records || [];
    const root = records.filter((item) => String(item.folderId) === '0');
    const folders = (snapshot.folders || []).filter((folder) =>
      !protectedIds.has(String(folder.id)));
    const folderById = new Map(folders.map((folder) => [String(folder.id), folder]));
    const foldersByName = new Map();
    folders.forEach((folder) => {
      const matches = foldersByName.get(folder.name) || [];
      matches.push(folder);
      foldersByName.set(folder.name, matches);
    });
    const existing = records.filter((item) => folderById.has(String(item.folderId)));
    const normalized = (value) => normalizeItemName(value).toLocaleLowerCase('ko');
    const exactFoldersByName = new Map();
    const existingByType = new Map();
    existing.forEach((item) => {
      const name = normalized(item.itemName);
      if (!exactFoldersByName.has(name)) exactFoldersByName.set(name, new Set());
      exactFoldersByName.get(name).add(String(item.folderId));
      (item.types || []).forEach((type) => {
        if (!existingByType.has(type)) existingByType.set(type, new Set());
        existingByType.get(type).add(item);
      });
    });
    const protectedNames = new Set(records
      .filter((item) => protectedIds.has(String(item.folderId)))
      .map((item) => normalized(item.itemName)));
    const tokens = (value) => normalized(value)
      .replace(/no\s*\.\s*\d+/gi, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4);
    const typeCounts = new Map();
    root.forEach((item) => {
      const type = chooseType(item.types, priority);
      if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });
    const decisions = root.map((item) => {
      const itemId = String(item.itemId);
      const itemName = item.itemName;
      const explicit = Object.hasOwn(overrides, itemId)
        ? overrides[itemId]
        : rules[normalized(itemName)];
      let target = '';
      let suggestion = '';
      let tier = 'stay';
      let reason = '';
      if (explicit === 'skip') {
        reason = '직접 보류';
      } else if (explicit) {
        if (folderById.has(String(explicit))) {
          target = String(explicit);
          tier = 'ready';
          reason = Object.hasOwn(overrides, itemId)
            ? '이번 정리에서 지정' : '기억한 규칙';
        } else if (String(explicit).startsWith('new:')) {
          const name = String(explicit).slice(4);
          const matches = foldersByName.get(name) || [];
          if (matches.length === 1) target = String(matches[0].id);
          else if (!(snapshot.folders || []).some((folder) => folder.name === name)) {
            target = String(explicit);
          }
          if (target) {
            tier = 'ready';
            reason = '새 폴더를 직접 선택';
          } else reason = '지정한 폴더가 없거나 보호됨';
        } else {
          reason = '지정한 폴더가 없거나 보호됨';
        }
      } else {
        const protectedMatch = protectedNames.has(normalized(itemName));
        const exact = exactFoldersByName.get(normalized(itemName)) || new Set();
        const itemTokens = new Set(tokens(itemName));
        const candidates = new Set((item.types || []).flatMap((type) =>
          [...(existingByType.get(type) || [])]));
        const similar = new Set([...candidates]
          .filter((entry) => tokens(entry.itemName).some((token) => itemTokens.has(token)))
          .map((entry) => String(entry.folderId)));
        if (protectedMatch) {
          reason = '같은 아이템이 보호 폴더에 있음';
        } else if (exact.size === 1) {
          target = [...exact][0];
          tier = 'ready';
          reason = '같은 아이템이 있는 폴더';
        } else if (exact.size > 1) {
          reason = '같은 아이템이 여러 폴더에 있음';
        } else if (similar.size === 1) {
          suggestion = [...similar][0];
          tier = 'review';
          reason = '같은 종류·이름 특징의 아이템';
        } else if (similar.size > 1) {
          reason = '비슷한 아이템이 여러 폴더에 있음';
        } else {
          const type = chooseType(item.types, priority);
          const matches = foldersByName.get(type) || [];
          if (!type) reason = '분류 정보 없음';
          else if (matches.length === 1) {
            suggestion = String(matches[0].id);
            tier = 'review';
            reason = '아이템 종류와 폴더 이름 일치';
          } else if (matches.length > 1) {
            reason = '같은 이름의 폴더가 여러 개';
          } else if ((snapshot.folders || []).some((folder) => folder.name === type)) {
            reason = '종류와 같은 이름의 보호 폴더';
          } else if (typeCounts.get(type) >= 3) {
            suggestion = `new:${type}`;
            tier = 'review';
            reason = '같은 종류의 폴더 밖 아이템이 3개 이상';
          } else {
            reason = '맞는 폴더를 찾지 못함';
          }
        }
      }
      return { itemId, itemName, target, suggestion, tier, reason };
    });
    const buckets = new Map();
    decisions.filter((decision) => decision.target).forEach((decision) => {
      if (!buckets.has(decision.target)) buckets.set(decision.target, []);
      buckets.get(decision.target).push(decision.itemId);
    });
    const moves = [...buckets.entries()].map(([destination, itemIds]) => ({
      destination,
      folderName: destination.startsWith('new:')
        ? destination.slice(4) : folderById.get(destination).name,
      itemIds,
    }));
    return {
      characterId: String(snapshot.characterId),
      characterName: snapshot.characterName || String(snapshot.characterId),
      createFolders: moves.filter((move) => move.destination.startsWith('new:'))
        .map((move) => move.folderName),
      moves,
      skipped: decisions.filter((decision) => !decision.target),
      decisions,
    };
  }

  function getNuiTradeImageItems(items) {
    const eligibleItems = (items || [])
      .filter((item) => item.tradeQuantity > 0)
      .map((item) => ({ ...item, quantity: item.tradeQuantity }));
    return mergeNuiTradeImageItems(eligibleItems);
  }

  function mergeNuiTradeImageItems(items) {
    const groups = new Map();
    (items || []).forEach((item) => {
      const key = nuiDuplicateKey(item);
      if (!groups.has(key)) {
        groups.set(key, {
          ...item,
          key: `trade:${key}`,
          quantity: 0,
          characterNames: new Set(),
          folderNames: new Set(),
          ownerNames: new Set(),
        });
      }
      const merged = groups.get(key);
      merged.quantity += toQuantity(item.quantity);
      if (item.characterName) merged.characterNames.add(item.characterName);
      if (item.folderName) merged.folderNames.add(item.folderName);
      if (item.ownerName) merged.ownerNames.add(item.ownerName);
    });
    return [...groups.values()].map((item) => ({
      ...item,
      characterName: [...item.characterNames].sort((a, b) => a.localeCompare(b, 'ko')).join(', '),
      folderName: [...item.folderNames].sort((a, b) => a.localeCompare(b, 'ko')).join(', '),
      ownerName: [...item.ownerNames].sort((a, b) => a.localeCompare(b, 'ko')).join(', '),
      characterNames: [...item.characterNames].sort((a, b) => a.localeCompare(b, 'ko')),
      folderNames: [...item.folderNames].sort((a, b) => a.localeCompare(b, 'ko')),
      ownerNames: [...item.ownerNames].sort((a, b) => a.localeCompare(b, 'ko')),
    }));
  }

  function createInventoryApi(fetchImpl, origin) {
    const request = async (path, fields) => {
      const body = new URLSearchParams();

      Object.entries(fields || {})
        .forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach((entry) =>
              body.append(`${key}[]`, String(entry)),
            );
          } else {
            body.set(key, String(value));
          }
        });

      const response = await fetchImpl(
        new URL(path, origin).href,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type':
              'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: body.toString(),
        },
      );

      let data;

      try {
        data = await response.json();
      } catch (_) {
        throw new Error(
          `HTTP ${response.status}: JSON 응답이 아닙니다.`,
        );
      }

      if (
        !response.ok
        || !data
        || data.result !== 'success'
      ) {
        throw new Error(
          data && data.msg
          || `HTTP ${response.status}`,
        );
      }

      return data;
    };

    return {
      async getInventory(characterId) {
        const response = await fetchImpl(
          new URL(
            `/inventory_proc.php?mode=get_inven&char_id=${encodeURIComponent(characterId)}`,
            origin,
          ).href,
          {
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          },
        );

        let data;

        try {
          data = await response.json();
        } catch (_) {
          throw new Error(
            `HTTP ${response.status}: JSON 응답이 아닙니다.`,
          );
        }

        if (
          !response.ok
          || !data
          || data.result !== 'success'
        ) {
          throw new Error(
            data && data.msg
            || `HTTP ${response.status}`,
          );
        }

        return data;
      },

      assignFolder: (
        characterId,
        itemIds,
        folderId,
      ) =>
        request(
          '/assign_item_folder.php',
          {
            char_id: characterId,
            itemIds,
            folder_id: folderId,
          },
        ),

      createFolder: (
        characterId,
        name,
      ) =>
        request(
          '/manage_item_folder.php',
          {
            mode: 'add',
            char_id: characterId,
            name,
          },
        ),

      manageFolder: (
        mode,
        fields,
      ) =>
        request(
          '/manage_item_folder.php',
          {
            mode,
            ...fields,
          },
        ),

      reorderItems: (
        characterId,
        itemIds,
      ) =>
        request(
          '/reorder_inventory.php',
          {
            char_id: characterId,
            itemIds,
          },
        ),

      discardItems: (
        characterId,
        itemIds,
        qtys,
      ) =>
        request(
          '/discard_item_proc.php',
          {
            char_id: characterId,
            itemIds,
            qtys,
          },
        ),

      useItem: (fields) =>
        request(
          '/use_item_proc.php',
          fields,
        ),
    };
  }

  if (win.__INVENTORY_MANAGER_TEST__) {
    win.__INVENTORY_MANAGER_INTERNALS__ = {
      normalizeItemName,
      toQuantity,
      splitItemTypes,
      normalizeFolder,
      normalizeInventoryRecord,
      normalizeGrade,
      gradeInfo,
      chooseType,
      sortInventory,
      filterInventory,
      summarizeSnapshots,
      countExchangeTickets,
      parseUserscriptVersion,
      compareUserscriptVersions,
      getUserscriptUpdateState,
      shouldCheckUserscriptUpdate,
      renderUserscriptUpdateStatusMarkup,
      summarizeTrackedItemQuantities,
      renderTrackedQuantityMarkup,
      isNuiItemName,
      makeNuiRecords,
      nuiDuplicateKey,
      getNuiTradeImageItems,
      mergeNuiTradeImageItems,
      countStatuses,
      buildAutoOrganizePlan,
      createInventoryApi,
      resolveImageUrl,
    };
    return;
  }

  const doc = win.document;

  if (!doc || doc.getElementById('im2-root')) {
    return;
  }

  const origin = win.location.origin;

  const api = createInventoryApi(
    win.fetch.bind(win),
    origin,
  );

  const STORAGE_KEY =
    'manosaba-inventory-manager:v2';

  const OLD_MANAGER_KEY =
    'manosaba-inventory-manager:v1';

  const OLD_NUI_KEY =
    'nui-trade-image:classification:v1';

  const safeParse = (
    value,
    fallback = {},
  ) => {
    try {
      const parsed = JSON.parse(value || '');

      return parsed
        && typeof parsed === 'object'
        ? parsed
        : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const safeStorage = () => {
    try {
      return win.localStorage;
    } catch (_) {
      return null;
    }
  };

  const storage = safeStorage();

  let cachedWantedCards = [];
  if (storage) {
    try {
      const cached = JSON.parse(storage.getItem(NUI_WANTED_CACHE_KEY) || 'null');
      if (cached && cached.schemaVersion === 1) {
        cachedWantedCards = getNuiWantedCatalog(cached.sources);
      }
    } catch (_) {
      // 손상된 캐시는 무시하고 원격 소스를 다시 받습니다.
    }
  }

  const currentSaved = storage
    ? safeParse(storage.getItem(STORAGE_KEY), {})
    : {};

  const oldManager = storage
    ? safeParse(storage.getItem(OLD_MANAGER_KEY), {})
    : {};

  const oldNuiRaw = storage
    ? safeParse(storage.getItem(OLD_NUI_KEY), {})
    : {};

  const oldNuiStatuses =
    oldNuiRaw.statuses
    && typeof oldNuiRaw.statuses === 'object'
      ? oldNuiRaw.statuses
      : oldNuiRaw;

  const state = {
    open: false,
    view: 'dashboard',
    snapshots: [],
    loading: false,
    loadingProgress: null,
    message: null,
    lastFetchedAt: null,
    selectedKeys: new Set(),
    query: '',
    sort: 'name',

    filters: {
      characterId: 'all',
      folderId: 'all',
      type: 'all',
      grade: 'all',
    },

    protectedFolders:
      currentSaved.protectedFolders
      || oldManager.protectedFolders
      || {},

    typePriority:
      currentSaved.typePriority
      || oldManager.typePriority
      || [],

    organizeRules: currentSaved.organizeRules || {},
    organizeOverrides: {},

    organizePlans: null,
    dialog: null,

    theme:
      currentSaved.theme === 'dark'
        ? 'dark'
        : oldNuiRaw.theme === 'dark'
          ? 'dark'
          : 'light',

    nuiStatuses:
      currentSaved.nuiStatuses
      || oldNuiStatuses
      || {},
    nuiDuplicateMode: Boolean(currentSaved.nuiDuplicateMode),
    nuiStarred: new Set(Array.isArray(currentSaved.nuiStarred)
      ? currentSaved.nuiStarred : []),

    nuiSelected: new Set(),
    nuiQuery: '',
    nuiFilter: 'all',
    nuiWantedCatalog: cachedWantedCards,
    nuiWantedSortedCatalog: sortNuiImageItems(cachedWantedCards),
    nuiWantedCategories: [...new Set(
      cachedWantedCards.map((card) => card.category),
    )].sort((a, b) => a.localeCompare(b, 'ko')),
    nuiWantedLoading: false,
    nuiWantedError: null,
    nuiWantedSelected: new Set(
      Array.isArray(currentSaved.nuiWantedSelected)
        ? currentSaved.nuiWantedSelected
        : [],
    ),
    nuiWantedQuery: '',
    nuiWantedCategory: 'all',
    nuiWantedPreview: null,
    nuiCompactMode: Boolean(currentSaved.nuiCompactMode),
    nuiAutoPaginate: currentSaved.nuiAutoPaginate !== false,
    nuiPageSaveEnabled: Boolean(currentSaved.nuiPageSaveEnabled),
    nuiDownloadMode: normalizeNuiDownloadMode(currentSaved.nuiDownloadMode),
    preview: null,
    busy: false,
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(
        /[&<>'"]/g,
        (character) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;',
          })[character],
      );

  const formatNumber = (value) =>
    new Intl.NumberFormat('ko-KR')
      .format(Number(value) || 0);

  const formatDate = (value) =>
    value
      ? new Intl.DateTimeFormat(
          'ko-KR',
          {
            dateStyle: 'medium',
            timeStyle: 'short',
          },
        ).format(value)
      : '';

  const encodeKey = (value) =>
    encodeURIComponent(String(value ?? ''));

  const decodeKey = (value) => {
    try {
      return decodeURIComponent(value || '');
    } catch (_) {
      return value || '';
    }
  };

  function persistSettings() {
    if (!storage) return;

    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          protectedFolders:
            state.protectedFolders,

          typePriority:
            state.typePriority,

          organizeRules:
            state.organizeRules,

          theme:
            state.theme,

          nuiStatuses:
            state.nuiStatuses,
          nuiDuplicateMode:
            state.nuiDuplicateMode,
          nuiStarred:
            [...state.nuiStarred],

          nuiWantedSelected:
            [...state.nuiWantedSelected],

          nuiCompactMode:
            state.nuiCompactMode,

          nuiAutoPaginate:
            state.nuiAutoPaginate,

          nuiPageSaveEnabled:
            state.nuiPageSaveEnabled,

          nuiDownloadMode:
            state.nuiDownloadMode,
        }),
      );
    } catch (_) {
      // 저장 실패는 인벤토리 작업을 막지 않습니다.
    }
  }

  let wantedCatalogRequest = null;
  let wantedCatalogRequested = false;

  function applyNuiWantedCatalog(cards) {
    state.nuiWantedCatalog = cards;
    state.nuiWantedSortedCatalog = sortNuiImageItems(cards);
    state.nuiWantedCategories = [...new Set(
      cards.map((card) => card.category),
    )].sort((left, right) => left.localeCompare(right, 'ko'));
    if (state.nuiWantedCategory !== 'all'
      && !state.nuiWantedCategories.includes(state.nuiWantedCategory)) {
      state.nuiWantedCategory = 'all';
    }
  }

  function refreshNuiWantedCatalog() {
    if (wantedCatalogRequest) return wantedCatalogRequest;

    wantedCatalogRequested = true;
    state.nuiWantedLoading = true;
    state.nuiWantedError = null;
    renderApp();

    const controller = new AbortController();
    const timeout = win.setTimeout(() => controller.abort(), 15000);
    wantedCatalogRequest = loadNuiWantedCatalog(
      (url, options) => win.fetch(url, { ...options, signal: controller.signal }),
      NUI_WANTED_SOURCE_URL,
    ).then(({ sources, cards }) => {
      applyNuiWantedCatalog(cards);
      try {
        storage && storage.setItem(NUI_WANTED_CACHE_KEY, JSON.stringify({
          schemaVersion: 1,
          sources,
          fetchedAt: Date.now(),
        }));
      } catch (_) {
        // 캐시 저장에 실패해도 현재 목록은 사용할 수 있습니다.
      }
    }).catch((error) => {
      state.nuiWantedError = error && error.message || '목록을 불러오지 못했습니다.';
    }).finally(() => {
      win.clearTimeout(timeout);
      state.nuiWantedLoading = false;
      wantedCatalogRequest = null;
      renderApp();
    });

    return wantedCatalogRequest;
  }

  function allRecords() {
    return state.snapshots
      .filter((snapshot) => !snapshot.error)
      .flatMap(
        (snapshot) =>
          snapshot.records || [],
      );
  }

  function snapshotFor(characterId) {
    return state.snapshots.find(
      (snapshot) =>
        String(snapshot.characterId)
        === String(characterId),
    );
  }

  function recordFor(key) {
    return allRecords()
      .find(
        (record) =>
          record.key === key,
      );
  }

  function readCharacterMeta(card) {
    const characterId =
      card
      && (
        (card.dataset && card.dataset.id)
        || card.getAttribute('data-id')
      );

    const characterName =
      normalizeItemName(
        card
        && card.querySelector('.char-name')
        && card.querySelector('.char-name').textContent,
      );

    const rawOwner =
      normalizeItemName(
        card
        && card.querySelector('.char-owner')
        && card.querySelector('.char-owner').textContent,
      );

    return {
      characterId:
        String(characterId || ''),

      characterName:
        characterName
        || `캐릭터 ${characterId || ''}`,

      ownerName:
        rawOwner
          .replace(/^Owner\.\s*/i, '')
          .trim(),
    };
  }

  function getCharacterMetas() {
    return Array.from(
      doc.querySelectorAll(
        '#myCharList .char-card',
      ),
    )
      .map(readCharacterMeta)
      .filter(
        (meta) =>
          meta.characterId,
      );
  }

  function folderMap(folders) {
    return new Map(
      (folders || []).map(
        (folder) => [
          String(folder.id),
          folder.name,
        ],
      ),
    );
  }

  function setMessage(
    text,
    tone = 'info',
  ) {
    state.message =
      text
        ? { text, tone }
        : null;
  }

  function injectStyles() {
    const style =
      doc.createElement('style');

    style.id = 'im2-style';

    style.textContent = `
      #im2-root{
        --bg:#f6f7fb;
        --panel:#fff;
        --panel-2:#f9fafc;
        --text:#1b2434;
        --muted:#6d7788;
        --border:#e1e5ec;
        --border-strong:#cfd6e0;
        --accent:#4f46e5;
        --accent-soft:#eef2ff;
        --danger:#c2414b;
        --danger-soft:#fff1f2;
        --success:#15803d;
        --success-soft:#f0fdf4;
        --warning:#a16207;
        --warning-soft:#fffbeb;
        --shadow:0 26px 72px rgba(15,23,42,.17);
        --overlay:rgba(15,23,42,.46);
        font:14px/1.45 Pretendard,"Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif;
        color:var(--text);
        -webkit-text-size-adjust:100%
      }

      #im2-root[data-theme="dark"]{
        --bg:#111318;
        --panel:#181b22;
        --panel-2:#20242c;
        --text:#f0f2f6;
        --muted:#9ca5b3;
        --border:#2d323c;
        --border-strong:#3b424f;
        --accent:#8b8cf8;
        --accent-soft:#27284a;
        --danger:#fb7185;
        --danger-soft:#3a1720;
        --success:#4ade80;
        --success-soft:#12301f;
        --warning:#facc15;
        --warning-soft:#362b0d;
        --shadow:0 28px 78px rgba(0,0,0,.45);
        --overlay:rgba(0,0,0,.62)
      }

      #im2-root *,
      #im2-root *::before,
      #im2-root *::after{
        box-sizing:border-box
      }

      #im2-root button,
      #im2-root input,
      #im2-root select{
        font:inherit
      }

      #im2-root button{
        color:inherit
      }

      #im2-launch{
        position:fixed;
        right:22px;
        bottom:22px;
        bottom:calc(22px + env(safe-area-inset-bottom,0px) + var(--im2-launch-lift,0px));
        z-index:2147483000;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        height:42px;
        padding:0 16px;
        border:1px solid #4338ca;
        border-radius:12px;
        background:#4f46e5;
        color:#fff!important;
        font:700 13px/1 Pretendard,"Noto Sans KR",system-ui;
        box-shadow:0 10px 26px rgba(79,70,229,.25);
        cursor:pointer;
        visibility:visible;
        opacity:1;
        touch-action:manipulation;
        -webkit-tap-highlight-color:transparent;
        -webkit-user-select:none;
        user-select:none
      }

      #im2-launch:hover{
        background:#4338ca
      }

      .im2-overlay{
        position:fixed;
        top:0;
        left:0;
        right:0;
        height:100vh;
        height:100dvh;
        z-index:2147483001;
        display:grid;
        place-items:center;
        padding:20px;
        padding-bottom:calc(20px + env(safe-area-inset-bottom,0px));
        background:var(--overlay);
        -webkit-backdrop-filter:blur(4px);
        backdrop-filter:blur(4px)
      }

      .im2-overlay[hidden]{
        display:none
      }

      .im2-shell{
        display:grid;
        grid-template-columns:210px minmax(0,1fr);
        width:min(1320px,calc(100vw - 40px));
        height:min(880px,calc(100vh - 40px));
        height:min(880px,calc(100dvh - 40px));
        overflow:hidden;
        border:1px solid var(--border);
        border-radius:18px;
        background:var(--panel);
        box-shadow:var(--shadow)
      }

      .im2-sidebar{
        display:flex;
        min-height:0;
        flex-direction:column;
        padding:18px 12px;
        background:var(--panel-2);
        border-right:1px solid var(--border)
      }

      .im2-brand{
        display:flex;
        align-items:center;
        gap:10px;
        padding:4px 10px 20px
      }

      .im2-brand-mark{
        width:30px;
        height:30px;
        display:grid;
        place-items:center;
        border-radius:9px;
        background:var(--accent);
        color:#fff;
        font-size:13px;
        font-weight:850;
        box-shadow:0 6px 14px color-mix(in srgb,var(--accent) 22%,transparent)
      }

      .im2-brand-copy{
        min-width:0
      }

      .im2-brand-title{
        font-weight:800;
        letter-spacing:-.025em
      }

      .im2-brand-sub{
        margin-top:2px;
        color:var(--muted);
        font-size:10px
      }

      .im2-nav{
        display:grid;
        gap:3px
      }

      .im2-nav button{
        display:flex;
        align-items:center;
        gap:9px;
        width:100%;
        padding:10px 11px;
        border:0;
        border-radius:8px;
        background:transparent;
        color:var(--muted);
        cursor:pointer;
        text-align:left;
        font-size:13px;
        font-weight:650
      }

      .im2-nav button:hover{
        background:var(--panel);
        color:var(--text)
      }

      .im2-nav button.is-active{
        background:var(--accent-soft);
        color:var(--accent)
      }

      .im2-nav-mark{
        width:3px;
        height:18px;
        border-radius:999px;
        background:var(--accent);
        opacity:0;
        transform:scaleY(.6);
        transition:opacity .14s ease,transform .14s ease
      }

      .im2-nav button.is-active .im2-nav-mark{
        opacity:1;
        transform:scaleY(1)
      }

      .im2-sidebar-foot{
        margin-top:auto;
        padding:10px
      }

      .im2-mini-status{
        color:var(--muted);
        font-size:11px;
        line-height:1.6
      }

      .im2-main{
        display:flex;
        min-width:0;
        min-height:0;
        flex-direction:column;
        background:var(--panel)
      }

      .im2-header{
        display:flex;
        align-items:center;
        gap:14px;
        padding:18px 24px;
        border-bottom:1px solid var(--border)
      }

      .im2-heading{
        min-width:0;
        flex:1
      }

      .im2-heading h1{
        margin:0;
        font-size:20px;
        letter-spacing:-.03em
      }

      .im2-heading p{
        margin:3px 0 0;
        color:var(--muted);
        font-size:12px
      }

      .im2-header-actions{
        display:flex;
        gap:7px
      }

      .im2-icon-btn,
      .im2-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:6px;
        min-height:36px;
        padding:7px 11px;
        border:1px solid var(--border-strong);
        border-radius:8px;
        background:var(--panel);
        color:var(--text);
        cursor:pointer;
        font-size:12px;
        font-weight:650
      }

      .im2-btn[hidden]{
        display:none
      }

      .im2-icon-btn{
        width:36px;
        padding:0
      }

      .im2-btn:hover,
      .im2-icon-btn:hover{
        border-color:var(--accent);
        color:var(--accent)
      }

      .im2-btn.primary{
        border-color:var(--accent);
        background:var(--accent);
        color:#fff!important
      }

      .im2-btn.primary:hover{
        filter:brightness(.96);
        color:#fff
      }

      .im2-btn.danger{
        border-color:var(--danger);
        background:var(--danger);
        color:#fff!important
      }

      .im2-btn.ghost{
        border-color:transparent;
        background:transparent;
        color:var(--muted)
      }

      .im2-btn:disabled,
      .im2-icon-btn:disabled{
        opacity:.45;
        cursor:not-allowed
      }

      .im2-progress{
        height:2px;
        background:transparent
      }

      .im2-progress>span{
        display:block;
        height:100%;
        background:var(--accent);
        transition:width .2s ease
      }

      .im2-content{
        min-height:0;
        flex:1;
        overflow:auto;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        padding:22px 24px 90px;
        background:var(--bg)
      }

      .im2-banner{
        display:flex;
        align-items:flex-start;
        gap:10px;
        margin-bottom:16px;
        padding:11px 13px;
        border:1px solid var(--border);
        border-radius:9px;
        background:var(--panel);
        color:var(--muted);
        font-size:12px
      }

      .im2-banner.is-error{
        border-color:color-mix(in srgb,var(--danger) 38%,var(--border));
        background:var(--danger-soft);
        color:var(--danger)
      }

      .im2-banner.is-success{
        border-color:color-mix(in srgb,var(--success) 32%,var(--border));
        background:var(--success-soft);
        color:var(--success)
      }

      .im2-grid{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:12px
      }

      .im2-stat{
        padding:17px;
        border:1px solid var(--border);
        border-radius:12px;
        background:var(--panel);
        box-shadow:0 1px 2px rgba(15,23,42,.025)
      }

      .im2-stat-label{
        color:var(--muted);
        font-size:11px;
        font-weight:650
      }

      .im2-stat-value{
        margin-top:5px;
        font-size:26px;
        font-weight:800;
        letter-spacing:-.04em
      }

      .im2-stat-note{
        margin-top:5px;
        color:var(--muted);
        font-size:11px
      }

      .im2-section{
        margin-top:16px;
        border:1px solid var(--border);
        border-radius:11px;
        background:var(--panel)
      }

      .im2-section-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:14px;
        padding:15px 16px;
        border-bottom:1px solid var(--border)
      }

      .im2-section-title{
        font-size:14px;
        font-weight:750
      }

      .im2-section-desc{
        margin-top:2px;
        color:var(--muted);
        font-size:11px
      }

      .im2-section-body{
        padding:16px
      }

      .im2-action-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:10px
      }

      .im2-action-card{
        position:relative;
        padding:15px 38px 15px 15px;
        border:1px solid var(--border);
        border-radius:11px;
        background:var(--panel);
        cursor:pointer;
        text-align:left;
        transition:border-color .14s ease,background .14s ease,transform .14s ease
      }

      .im2-action-card::after{
        content:'→';
        position:absolute;
        right:14px;
        top:50%;
        transform:translateY(-50%);
        color:var(--muted);
        font-size:16px
      }

      .im2-action-card:hover{
        border-color:color-mix(in srgb,var(--accent) 45%,var(--border));
        background:var(--accent-soft);
        transform:translateY(-1px)
      }

      .im2-action-card:hover::after{
        color:var(--accent)
      }

      .im2-action-card strong{
        display:block
      }

      .im2-action-card span{
        display:block;
        margin-top:4px;
        color:var(--muted);
        font-size:11px
      }

      .im2-toolbar{
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:8px;
        margin-bottom:12px
      }

      .im2-compact-toggle{
        display:inline-flex;
        min-height:36px;
        align-items:center;
        gap:7px;
        padding:0 11px;
        border:1px solid var(--border-strong);
        border-radius:8px;
        background:var(--panel);
        color:var(--text);
        font-size:12px;
        font-weight:700;
        cursor:pointer
      }

      .im2-compact-toggle input{
        accent-color:var(--accent)
      }

      .im2-preview-pager{
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        justify-content:center;
        gap:10px
      }

      .im2-preview-pager strong{
        min-width:58px;
        color:var(--muted);
        text-align:center;
        font-size:12px
      }

      .im2-search{
        min-width:230px;
        flex:1
      }

      .im2-input,
      .im2-select{
        height:36px;
        padding:0 10px;
        border:1px solid var(--border-strong);
        border-radius:8px;
        outline:none;
        background:var(--panel);
        color:var(--text);
        font-size:12px
      }

      .im2-input:focus,
      .im2-select:focus{
        border-color:var(--accent);
        box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 13%,transparent)
      }

      .im2-table-wrap{
        overflow:auto;
        border:1px solid var(--border);
        border-radius:10px;
        background:var(--panel)
      }

      .im2-table{
        width:100%;
        border-collapse:collapse;
        font-size:12px
      }

      .im2-table th{
        position:sticky;
        top:0;
        z-index:1;
        padding:9px 10px;
        border-bottom:1px solid var(--border);
        background:var(--panel-2);
        color:var(--muted);
        font-size:10px;
        font-weight:750;
        letter-spacing:.02em;
        text-align:left;
        white-space:nowrap
      }

      .im2-table td{
        padding:9px 10px;
        border-bottom:1px solid var(--border);
        vertical-align:middle
      }

      .im2-table tr:last-child td{
        border-bottom:0
      }

      .im2-table tbody tr:hover{
        background:var(--panel-2)
      }

      .im2-item-name{
        max-width:310px;
        font-weight:700
      }

      .im2-item-sub{
        margin-top:2px;
        color:var(--muted);
        font-size:10px
      }

      .im2-chips{
        display:flex;
        flex-wrap:wrap;
        gap:4px
      }

      .im2-chip{
        display:inline-flex;
        align-items:center;
        min-height:20px;
        padding:2px 6px;
        border:1px solid var(--border);
        border-radius:5px;
        background:var(--panel-2);
        color:var(--muted);
        font-size:10px
      }

      .im2-grade{
        font-weight:700
      }

      .im2-menu{
        position:relative
      }

      .im2-menu summary{
        width:30px;
        height:30px;
        display:grid;
        place-items:center;
        border:1px solid var(--border);
        border-radius:7px;
        cursor:pointer;
        list-style:none
      }

      .im2-menu summary::-webkit-details-marker{
        display:none
      }

      .im2-menu[open] summary{
        border-color:var(--accent);
        color:var(--accent)
      }

      .im2-menu-pop{
        position:absolute;
        right:0;
        z-index:8;
        min-width:130px;
        margin-top:5px;
        padding:5px;
        border:1px solid var(--border);
        border-radius:9px;
        background:var(--panel);
        box-shadow:0 12px 32px rgba(15,23,42,.16)
      }

      .im2-menu-pop button{
        display:block;
        width:100%;
        padding:7px 8px;
        border:0;
        border-radius:6px;
        background:transparent;
        text-align:left;
        cursor:pointer;
        font-size:11px
      }

      .im2-menu-pop button:hover{
        background:var(--panel-2)
      }

      .im2-menu-pop button.is-danger{
        color:var(--danger)
      }

      .im2-empty{
        padding:44px 20px;
        color:var(--muted);
        text-align:center
      }

      .im2-filter-note{
        margin:-3px 0 12px;
        color:var(--muted);
        font-size:11px
      }

      .im2-bulkbar{
        position:sticky;
        bottom:12px;
        z-index:7;
        display:flex;
        align-items:center;
        gap:8px;
        width:max-content;
        max-width:100%;
        margin:16px auto 0;
        padding:8px;
        border:1px solid var(--border-strong);
        border-radius:10px;
        background:var(--panel);
        box-shadow:0 12px 32px rgba(15,23,42,.14)
      }

      .im2-bulkbar strong{
        padding:0 7px;
        font-size:11px
      }

      .im2-settings-grid{
        display:grid;
        grid-template-columns:minmax(280px,.8fr) minmax(0,1.2fr);
        gap:14px
      }

      .im2-field{
        display:grid;
        gap:6px;
        margin-bottom:13px
      }

      .im2-field label{
        font-size:11px;
        font-weight:700
      }

      .im2-help{
        color:var(--muted);
        font-size:11px
      }

      .im2-character-protect{
        padding:12px 0;
        border-top:1px solid var(--border)
      }

      .im2-character-protect:first-child{
        border-top:0
      }

      .im2-checkbox-grid{
        display:flex;
        flex-wrap:wrap;
        gap:7px;
        margin-top:8px
      }

      .im2-check-pill{
        display:flex;
        align-items:center;
        gap:6px;
        padding:6px 8px;
        border:1px solid var(--border);
        border-radius:7px;
        font-size:11px
      }

      .im2-plan-summary{
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:8px;
        margin-bottom:12px
      }

      .im2-plan-stat{
        padding:11px;
        border:1px solid var(--border);
        border-radius:8px;
        background:var(--panel-2)
      }

      .im2-plan-stat span{
        display:block;
        color:var(--muted);
        font-size:10px
      }

      .im2-plan-stat strong{
        display:block;
        margin-top:3px;
        font-size:17px
      }

      .im2-plan-char{
        padding:12px 0;
        border-top:1px solid var(--border)
      }

      .im2-plan-char:first-child{
        border-top:0
      }

      .im2-plan-list{
        margin:7px 0 0;
        padding-left:17px;
        color:var(--muted);
        font-size:11px
      }

      .im2-plan-group{
        margin-top:10px;
        border-top:1px solid var(--border)
      }

      .im2-plan-group summary{
        padding:10px 0;
        cursor:pointer;
        font-weight:600
      }

      .im2-plan-destination{
        padding:8px 0 4px;
        font-size:11px
      }

      .im2-plan-destination button{
        float:right;
        padding:4px 8px;
        font-size:11px
      }

      .im2-plan-item{
        display:grid;
        grid-template-columns:minmax(0,1fr) minmax(160px,190px);
        align-items:center;
        gap:12px;
        padding:8px 0 8px 12px;
        border-top:1px solid var(--border);
        font-size:11px
      }

      .im2-plan-item-controls{
        display:grid;
        gap:5px;
        min-width:0
      }

      .im2-plan-item-controls select{
        width:100%;min-width:0
      }

      .im2-plan-item-controls label{
        display:flex;align-items:center;gap:5px
      }

      @media(max-width:650px){
        .im2-plan-item{grid-template-columns:minmax(0,1fr)}
      }

      .im2-nui-stats{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        margin-bottom:12px
      }

      .im2-status-chip{
        padding:6px 9px;
        border:1px solid var(--border);
        border-radius:7px;
        background:var(--panel);
        font-size:11px
      }

      .im2-status-chip.success{
        color:var(--success)
      }

      .im2-status-chip.danger{
        color:var(--danger)
      }

      .im2-status-chip.warning{
        color:var(--warning)
      }

      .im2-nui-list{
        display:grid;
        gap:8px
      }

      .im2-nui-row{
        display:grid;
        grid-template-columns:26px 48px minmax(0,1fr) auto;
        align-items:center;
        gap:10px;
        padding:9px;
        border:1px solid var(--border);
        border-radius:9px;
        background:var(--panel)
      }

      .im2-nui-row.is-selected{
        border-color:var(--accent);
        background:var(--accent-soft)
      }

      .im2-nui-name-line{
        display:flex;
        align-items:center;
        gap:6px;
        min-width:0
      }

      .im2-nui-star{
        flex:none;
        width:24px;
        height:24px;
        padding:0;
        border:0;
        background:transparent;
        color:var(--muted);
        cursor:pointer;
        font-size:20px
      }

      .im2-nui-star[aria-pressed="true"]{
        color:#d18b16
      }

      .im2-toolbar [data-action="toggle-nui-duplicate-mode"][aria-pressed="true"]{
        border-color:var(--success);
        color:var(--success);
        background:var(--success-soft)
      }

      .im2-thumb{
        width:48px;
        height:48px;
        object-fit:cover;
        border:1px solid var(--border);
        border-radius:7px;
        background:var(--panel-2)
      }

      .im2-nui-actions{
        display:flex;
        gap:5px
      }

      .im2-wanted-tag{
        justify-self:end;
        color:var(--muted);
        font-size:10px;
        font-weight:700;
        white-space:nowrap
      }

      .im2-status-btn{
        padding:6px 8px;
        border:1px solid var(--border);
        border-radius:7px;
        background:var(--panel);
        cursor:pointer;
        font-size:10px;
        font-weight:700
      }

      .im2-status-btn.is-active.success{
        border-color:var(--success);
        color:var(--success);
        background:var(--success-soft)
      }

      .im2-status-btn.is-active.danger{
        border-color:var(--danger);
        color:var(--danger);
        background:var(--danger-soft)
      }

      .im2-status-btn.is-active:not(.success):not(.danger){
        border-color:var(--warning);
        color:var(--warning);
        background:var(--warning-soft)
      }

      .im2-preview{
        display:grid;
        justify-items:center;
        gap:12px
      }

      .im2-preview img{
        display:block;
        width:min(100%,780px);
        height:auto;
        border:1px solid var(--border);
        border-radius:10px;
        box-shadow:0 12px 36px rgba(15,23,42,.16)
      }

      .im2-dialog-layer{
        position:absolute;
        inset:0;
        z-index:20;
        display:grid;
        place-items:center;
        padding:18px;
        padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));
        background:rgba(15,23,42,.32);
        -webkit-backdrop-filter:blur(2px);
        backdrop-filter:blur(2px)
      }

      .im2-dialog-layer[hidden]{
        display:none
      }

      .im2-dialog{
        width:min(560px,calc(100vw - 36px));
        max-height:min(760px,calc(100vh - 36px));
        max-height:min(760px,calc(100dvh - 36px));
        display:flex;
        flex-direction:column;
        overflow:hidden;
        border:1px solid var(--border);
        border-radius:13px;
        background:var(--panel);
        box-shadow:var(--shadow)
      }

      .im2-dialog.wide{
        width:min(760px,calc(100vw - 36px))
      }

      .im2-dialog-head{
        display:flex;
        align-items:center;
        gap:12px;
        padding:15px 16px;
        border-bottom:1px solid var(--border)
      }

      .im2-dialog-head strong{
        flex:1
      }

      .im2-dialog-body{
        min-height:0;
        overflow:auto;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        padding:16px
      }

      .im2-dialog-foot{
        display:flex;
        justify-content:flex-end;
        gap:7px;
        padding:12px 16px;
        border-top:1px solid var(--border);
        background:var(--panel-2)
      }

      .im2-danger-box{
        padding:11px;
        border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));
        border-radius:8px;
        background:var(--danger-soft);
        color:var(--danger);
        font-size:11px
      }

      .im2-folder-list,
      .im2-order-list{
        display:grid;
        gap:6px;
        margin-top:12px
      }

      .im2-folder-row,
      .im2-order-row{
        display:flex;
        align-items:center;
        gap:8px;
        padding:9px;
        border:1px solid var(--border);
        border-radius:8px;
        background:var(--panel)
      }

      .im2-folder-row.is-dragging,
      .im2-order-row.is-dragging{
        opacity:.45
      }

      .im2-drag{
        cursor:grab;
        color:var(--muted);
        font-weight:800
      }

      .im2-folder-name,
      .im2-order-name{
        min-width:0;
        flex:1
      }

      .im2-folder-meta{
        color:var(--muted);
        font-size:10px
      }

      .im2-folder-actions{
        display:flex;
        gap:5px
      }

      .im2-link{
        padding:4px 6px;
        border:0;
        background:transparent;
        color:var(--muted);
        cursor:pointer;
        font-size:10px
      }

      .im2-link:hover{
        color:var(--accent)
      }

      .im2-link.danger:hover{
        color:var(--danger)
      }

      @media(max-width:900px){
        .im2-nav-mark{
          display:none
        }

        .im2-nav button.is-active{
          box-shadow:inset 0 -2px 0 var(--accent)
        }

        .im2-shell{
          grid-template-columns:1fr;
          width:100%;
          height:100%;
          border-radius:0
        }

        .im2-overlay{
          padding:0;
          padding-left:env(safe-area-inset-left,0px);
          padding-right:env(safe-area-inset-right,0px)
        }

        .im2-sidebar{
          padding:8px 10px;
          padding-top:calc(8px + env(safe-area-inset-top,0px));
          border-right:0;
          border-bottom:1px solid var(--border)
        }

        .im2-brand,
        .im2-sidebar-foot{
          display:none
        }

        .im2-nav{
          display:flex;
          overflow:auto;
          overscroll-behavior-x:contain;
          -webkit-overflow-scrolling:touch
        }

        .im2-nav button{
          flex:0 0 auto;
          width:auto;
          white-space:nowrap
        }

        .im2-main{
          min-height:0
        }

        .im2-content{
          padding-bottom:calc(90px + env(safe-area-inset-bottom,0px))
        }

        .im2-grid{
          grid-template-columns:repeat(2,minmax(0,1fr))
        }

        .im2-settings-grid{
          grid-template-columns:1fr
        }

        .im2-action-grid{
          grid-template-columns:1fr
        }
      }

      @media(max-width:650px){
        #im2-launch{
          right:14px;
          bottom:14px;
          bottom:calc(14px + env(safe-area-inset-bottom,0px) + var(--im2-launch-lift,0px));
          height:44px;
          padding:0 18px
        }

        #im2-root .im2-input,
        #im2-root .im2-select,
        #im2-root textarea{
          font-size:16px
        }

        .im2-header{
          padding:14px
        }

        .im2-heading p{
          display:none
        }

        .im2-content{
          padding:14px 12px 84px;
          padding-bottom:calc(84px + env(safe-area-inset-bottom,0px))
        }

        .im2-grid{
          grid-template-columns:1fr 1fr;
          gap:8px
        }

        .im2-stat{
          padding:13px
        }

        .im2-stat-value{
          font-size:22px
        }

        .im2-toolbar{
          align-items:stretch
        }

        .im2-search{
          min-width:100%;
          flex-basis:100%
        }

        .im2-select{
          flex:1;
          min-width:120px
        }

        .im2-table th:nth-child(4),
        .im2-table td:nth-child(4),
        .im2-table th:nth-child(5),
        .im2-table td:nth-child(5){
          display:none
        }

        .im2-item-name{
          max-width:180px
        }

        .im2-nui-row{
          grid-template-columns:24px 42px minmax(0,1fr)
        }

        .im2-thumb{
          width:42px;
          height:42px
        }

        .im2-nui-actions{
          grid-column:3;
          flex-wrap:wrap
        }

        .im2-wanted-tag{
          grid-column:3;
          justify-self:start;
          margin-top:-5px
        }

        .im2-dialog-layer{
          padding:0;
          align-items:end
        }

        .im2-dialog,
        .im2-dialog.wide{
          width:100%;
          max-height:88vh;
          max-height:88dvh;
          padding-bottom:env(safe-area-inset-bottom,0px);
          border-radius:14px 14px 0 0
        }

        .im2-plan-summary{
          grid-template-columns:1fr 1fr 1fr
        }
      }
    `;

    doc.head.appendChild(style);
  }

  const launch =
    doc.createElement('button');

  launch.id = 'im2-launch';
  launch.type = 'button';
  launch.textContent = '인벤토리';

  const root =
    doc.createElement('div');

  root.id = 'im2-root';
  root.dataset.theme = state.theme;

  root.innerHTML =
    '<div class="im2-overlay" data-overlay hidden></div>';

  injectStyles();

  doc.body.append(
    launch,
    root,
  );

  const overlay =
    root.querySelector('[data-overlay]');

  // IME(한글 등) 조합 상태. 조합 중에는 DOM을 통째로 갈아끼우지 않습니다.
  let composingField = null;
  let composingSettleTimer = 0;
  let composingRenderPending = false;

  function viewCopy() {
    return {
      dashboard: [
        '개요',
        '보유 현황과 필요한 작업을 빠르게 확인합니다.',
      ],
      inventory: [
        '인벤토리',
        '전체 캐릭터의 아이템을 검색하고 관리합니다.',
      ],
      organize: [
        '자동 정리',
        '아이템 내용과 기존 폴더를 살펴 목적지를 제안합니다.',
      ],
      nui: [
        '누이 교환',
        '누이 보유 현황을 분류하고 교환 목록 PNG를 만듭니다.',
      ],
      'nui-wanted': [
        '누이 구해요',
        '구해요 목록에서 원하는 누이를 고르고 PNG를 만듭니다.',
      ],
    };
  }

  function renderApp() {
    if (!state.open) return;

    if (composingField) {
      // 조합 중에 DOM을 교체하면 조합이 끊겨 자모가 따로 입력됩니다.
      composingRenderPending = true;

      return;
    }

    if (composingSettleTimer) {
      win.clearTimeout(composingSettleTimer);
      composingSettleTimer = 0;
    }

    const active =
      doc.activeElement;
    const oldContent = overlay.querySelector('.im2-content');
    const contentScroll = oldContent ? oldContent.scrollTop : 0;
    const oldGroups = overlay.querySelectorAll('[data-plan-group]');
    const openGroups = new Set([...oldGroups]
      .filter((group) => group.open)
      .map((group) => group.dataset.planGroup));

    const focusKey =
      active
      && active.dataset
      && active.dataset.focusKey;

    const selection =
      active
      && typeof active.selectionStart === 'number'
        ? [
            active.selectionStart,
            active.selectionEnd,
          ]
        : null;

    const views = viewCopy();

    const [title, subtitle] =
      views[state.view];

    const progress =
      state.loadingProgress
      && state.loadingProgress.total
        ? Math.round(
            state.loadingProgress.done
            / state.loadingProgress.total
            * 100,
          )
        : state.loading
          ? 12
          : 0;

    overlay.innerHTML = `
      <div
        class="im2-shell"
        role="dialog"
        aria-modal="true"
        aria-label="인벤토리 매니저"
      >
        <aside class="im2-sidebar">
          <div class="im2-brand">
            <div class="im2-brand-mark">I</div>
            <div class="im2-brand-copy">
              <div class="im2-brand-title">
                인벤토리 매니저
              </div>
              <div class="im2-brand-sub">
                통합 관리 도구
              </div>
            </div>
          </div>

          <nav class="im2-nav">
            ${Object.entries(views)
              .map(
                ([key, value]) => `
                  <button
                    type="button"
                    data-view="${key}"
                    class="${state.view === key ? 'is-active' : ''}"
                  >
                    <span class="im2-nav-mark"></span>
                    ${escapeHtml(value[0])}
                  </button>
                `,
              )
              .join('')}
          </nav>

          <div class="im2-sidebar-foot">
            <div class="im2-mini-status">
              ${
                state.lastFetchedAt
                  ? `마지막 조회<br>${escapeHtml(formatDate(state.lastFetchedAt))}`
                  : '아직 조회하지 않았습니다.'
              }
            </div>
          </div>
        </aside>

        <main class="im2-main">
          <header class="im2-header">
            <div class="im2-heading">
              <h1>${escapeHtml(title)}</h1>
              <p>${escapeHtml(subtitle)}</p>
            </div>

            <div class="im2-header-actions">
              <button
                type="button"
                class="im2-icon-btn"
                data-action="refresh"
                title="새로고침"
                ${state.loading || state.busy ? 'disabled' : ''}
              >
                ↻
              </button>

              <button
                type="button"
                class="im2-icon-btn"
                data-action="toggle-theme"
                title="테마 전환"
              >
                ${state.theme === 'dark' ? '☀' : '◐'}
              </button>

              <button
                type="button"
                class="im2-icon-btn"
                data-action="close"
                title="닫기"
              >
                ×
              </button>
            </div>
          </header>

          <div class="im2-progress">
            ${
              state.loading || state.busy
                ? `<span style="width:${
                    state.busy && !state.loading
                      ? 100
                      : progress
                  }%"></span>`
                : ''
            }
          </div>

          <div class="im2-content">
            ${renderMessage()}
            ${renderView()}
          </div>
        </main>

        <div
          class="im2-dialog-layer"
          data-dialog-layer
          ${state.dialog ? '' : 'hidden'}
        >
          ${state.dialog ? renderDialog() : ''}
        </div>
      </div>
    `;

    const newContent = overlay.querySelector('.im2-content');
    if (newContent) newContent.scrollTop = contentScroll;
    if (oldGroups.length) {
      overlay.querySelectorAll('[data-plan-group]').forEach((group) => {
        group.open = openGroups.has(group.dataset.planGroup);
      });
    }

    if (focusKey) {
      const target =
        overlay.querySelector(
          `[data-focus-key="${CSS.escape(focusKey)}"]`,
        );

      if (target) {
        target.focus();

        if (
          selection
          && typeof target.setSelectionRange === 'function'
        ) {
          target.setSelectionRange(
            selection[0],
            selection[1],
          );
        }
      }
    }
  }

  function renderMessage() {
    if (!state.message) return '';

    const cls =
      state.message.tone === 'error'
        ? ' is-error'
        : state.message.tone === 'success'
          ? ' is-success'
          : '';

    return `
      <div
        class="im2-banner${cls}"
        role="status"
      >
        ${escapeHtml(state.message.text)}
      </div>
    `;
  }

  function renderView() {
    if (state.view === 'dashboard') {
      return renderDashboard();
    }

    if (state.view === 'inventory') {
      return renderInventory();
    }

    if (state.view === 'organize') {
      return renderOrganize();
    }

    if (state.view === 'nui') {
      return renderNui();
    }

    if (state.view === 'nui-wanted') {
      return renderNuiWanted();
    }

    return '';
  }

  function renderDashboard() {
    const summary =
      summarizeSnapshots(state.snapshots);

    const records =
      allRecords();

    const tickets =
      countExchangeTickets(records);

    const nuiCount =
      records.filter(
        (item) =>
          isNuiItemName(item.itemName),
      ).length;

    return `
      <div class="im2-grid">
        <div class="im2-stat">
          <div class="im2-stat-label">
            조회 캐릭터
          </div>
          <div class="im2-stat-value">
            ${formatNumber(summary.characterCount)}
          </div>
          <div class="im2-stat-note">
            ${
              state.snapshots.length
                ? `전체 ${formatNumber(state.snapshots.length)}명`
                : '페이지의 캐릭터를 조회합니다.'
            }
          </div>
        </div>

        <div class="im2-stat">
          <div class="im2-stat-label">
            보유 아이템
          </div>
          <div class="im2-stat-value">
            ${formatNumber(summary.itemCount)}
          </div>
          <div class="im2-stat-note">
            전체 인벤토리 항목
          </div>
        </div>

        <div class="im2-stat">
          <div class="im2-stat-label">
            정리 대기
          </div>
          <div class="im2-stat-value">
            ${formatNumber(summary.rootItemCount)}
          </div>
          <div class="im2-stat-note">
            폴더 밖 아이템
          </div>
        </div>

        <div class="im2-stat">
          <div class="im2-stat-label">
            교환권
          </div>
          <div class="im2-stat-value">
            ${formatNumber(tickets)}
          </div>
          <div class="im2-stat-note">
            ${formatNumber(Math.floor(tickets / 10))}회 교환 ·
            ${formatNumber(tickets % 10)}장 남음
          </div>
        </div>
      </div>

      <section class="im2-section">
        <div class="im2-section-head">
          <div>
            <div class="im2-section-title">
              바로가기
            </div>
            <div class="im2-section-desc">
              현재 데이터에서 이어서 작업합니다.
            </div>
          </div>

          ${
            !state.snapshots.length
              ? `
                <button
                  class="im2-btn primary"
                  data-action="refresh"
                >
                  인벤토리 불러오기
                </button>
              `
              : ''
          }
        </div>

        <div class="im2-section-body">
          <div class="im2-action-grid">
            <button
              class="im2-action-card"
              data-view="inventory"
            >
              <strong>아이템 찾기</strong>
              <span>
                검색·필터·폴더 이동·사용·버리기
              </span>
            </button>

            <button
              class="im2-action-card"
              data-view="organize"
            >
              <strong>자동 정리</strong>
              <span>
                ${formatNumber(summary.rootItemCount)}개 항목의 정리 계획 확인
              </span>
            </button>

            <button
              class="im2-action-card"
              data-view="nui"
            >
              <strong>누이 교환 목록</strong>
              <span>
                누이 ${formatNumber(nuiCount)}개 분류 및 PNG 생성
              </span>
            </button>

            <button
              class="im2-action-card"
              data-view="nui-wanted"
            >
              <strong>누이 구해요 이미지</strong>
              <span>
                구해요 누이를 선택하고 PNG를 생성
              </span>
            </button>
          </div>
        </div>
      </section>

      ${
        summary.errors.length
          ? `
            <section class="im2-section">
              <div class="im2-section-head">
                <div>
                  <div class="im2-section-title">
                    조회 실패
                  </div>
                  <div class="im2-section-desc">
                    나머지 캐릭터 결과는 사용할 수 있습니다.
                  </div>
                </div>
              </div>

              <div class="im2-section-body">
                ${summary.errors
                  .map(
                    (error) => `
                      <div class="im2-banner is-error">
                        ${escapeHtml(error)}
                      </div>
                    `,
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }
    `;
  }

  function inventoryFilterOptions(records) {
    const chars =
      state.snapshots
        .filter((s) => !s.error)
        .map((s) => ({
          id: String(s.characterId),
          name: s.characterName,
        }));

    const folderIds =
      new Map();

    records.forEach((r) =>
      folderIds.set(
        String(r.folderId),
        r.folderName,
      ),
    );

    const types = [
      ...new Set(
        records.flatMap(
          (r) => r.types || [],
        ),
      ),
    ].sort(
      (a, b) =>
        a.localeCompare(b, 'ko'),
    );

    const grades = [
      ...new Set(
        records.map(
          (r) => normalizeGrade(r.grade),
        ),
      ),
    ].sort(
      (a, b) =>
        GRADE_ORDER.indexOf(a)
        - GRADE_ORDER.indexOf(b),
    );

    return {
      chars,
      folders: [...folderIds.entries()],
      types,
      grades,
    };
  }

  function renderInventory() {
    const records =
      allRecords();

    const options =
      inventoryFilterOptions(records);

    return `
      <div class="im2-toolbar">
        <input
          class="im2-input im2-search"
          data-input="inventory-query"
          data-focus-key="inventory-query"
          type="search"
          value="${escapeHtml(state.query)}"
          placeholder="아이템·캐릭터·폴더 검색"
        >

        <select
          class="im2-select"
          data-input="filter-character"
        >
          <option value="all">
            모든 캐릭터
          </option>

          ${options.chars
            .map(
              (c) => `
                <option
                  value="${escapeHtml(c.id)}"
                  ${
                    state.filters.characterId === c.id
                      ? 'selected'
                      : ''
                  }
                >
                  ${escapeHtml(c.name)}
                </option>
              `,
            )
            .join('')}
        </select>

        <select
          class="im2-select"
          data-input="filter-folder"
        >
          <option value="all">
            모든 폴더
          </option>

          ${options.folders
            .map(
              ([id, name]) => `
                <option
                  value="${escapeHtml(id)}"
                  ${
                    state.filters.folderId === id
                      ? 'selected'
                      : ''
                  }
                >
                  ${escapeHtml(name)}
                </option>
              `,
            )
            .join('')}
        </select>

        <select
          class="im2-select"
          data-input="filter-type"
        >
          <option value="all">
            모든 종류
          </option>

          ${options.types
            .map(
              (type) => `
                <option
                  value="${escapeHtml(type)}"
                  ${
                    state.filters.type === type
                      ? 'selected'
                      : ''
                  }
                >
                  ${escapeHtml(type)}
                </option>
              `,
            )
            .join('')}
        </select>

        <select
          class="im2-select"
          data-input="filter-grade"
        >
          <option value="all">
            모든 등급
          </option>

          ${options.grades
            .map(
              (grade) => `
                <option
                  value="${escapeHtml(grade)}"
                  ${
                    state.filters.grade === grade
                      ? 'selected'
                      : ''
                  }
                >
                  ${escapeHtml(gradeInfo(grade).label)}
                </option>
              `,
            )
            .join('')}
        </select>

        <select
          class="im2-select"
          data-input="sort"
        >
          <option
            value="name"
            ${state.sort === 'name' ? 'selected' : ''}
          >
            이름순
          </option>

          <option
            value="quantity"
            ${state.sort === 'quantity' ? 'selected' : ''}
          >
            수량순
          </option>

          <option
            value="grade"
            ${state.sort === 'grade' ? 'selected' : ''}
          >
            등급순
          </option>

          <option
            value="type"
            ${state.sort === 'type' ? 'selected' : ''}
          >
            종류순
          </option>

          <option
            value="compound"
            ${state.sort === 'compound' ? 'selected' : ''}
          >
            캐릭터·폴더·이름
          </option>

          <option
            value="nui-number"
            ${state.sort === 'nui-number' ? 'selected' : ''}
          >
            자동 번호순 정렬 (누이)
          </option>
        </select>

        ${
          state.filters.characterId !== 'all'
            ? `
              <button
                class="im2-btn"
                data-action="open-folder-manager"
                data-character="${escapeHtml(state.filters.characterId)}"
              >
                폴더 관리
              </button>
            `
            : ''
        }
      </div>

      <div data-region="inventory-results">
        ${renderInventoryResults()}
      </div>
    `;
  }

  function renderInventoryResults() {
    const records =
      allRecords();

    const filtered =
      sortInventory(
        filterInventory(
          records,
          {
            ...state.filters,
            query: state.query,
          },
        ),
        state.sort,
      );

    const selectedVisible =
      filtered.filter(
        (item) =>
          state.selectedKeys.has(item.key),
      ).length;

    const allVisibleSelected =
      filtered.length > 0
      && selectedVisible === filtered.length;

    return `
      <div class="im2-filter-note">
        ${formatNumber(filtered.length)}개 표시 ·
        ${formatNumber(state.selectedKeys.size)}개 선택
        ${
          state.filters.characterId === 'all'
            ? ' · 폴더 관리는 캐릭터를 선택하면 표시됩니다.'
            : ''
        }
      </div>

      <div class="im2-table-wrap">
        <table class="im2-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  data-action="select-visible-inventory"
                  ${allVisibleSelected ? 'checked' : ''}
                >
              </th>
              <th>아이템</th>
              <th>캐릭터</th>
              <th>수량</th>
              <th>종류</th>
              <th>폴더</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${
              filtered.length
                ? filtered.map(renderInventoryRow).join('')
                : `
                  <tr>
                    <td colspan="7">
                      <div class="im2-empty">
                        조건에 맞는 아이템이 없습니다.
                      </div>
                    </td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>

      ${
        state.selectedKeys.size
          ? `
            <div class="im2-bulkbar">
              <strong>
                ${formatNumber(state.selectedKeys.size)}개 선택
              </strong>

              <button
                class="im2-btn"
                data-action="bulk-move"
              >
                폴더 이동
              </button>

              <button
                class="im2-btn danger"
                data-action="bulk-discard"
              >
                선택 버리기
              </button>

              <button
                class="im2-btn ghost"
                data-action="clear-inventory-selection"
              >
                선택 해제
              </button>
            </div>
          `
          : ''
      }
    `;
  }

  function renderInventoryRow(item) {
    const grade =
      gradeInfo(item.grade);

    return `
      <tr>
        <td>
          <input
            type="checkbox"
            data-action="toggle-inventory-select"
            data-key="${encodeKey(item.key)}"
            ${state.selectedKeys.has(item.key) ? 'checked' : ''}
          >
        </td>

        <td>
          <div class="im2-item-name">
            ${escapeHtml(item.itemName || '(이름 없음)')}
          </div>

          <div class="im2-item-sub">
            <span
              class="im2-grade"
              style="color:${grade.color}"
            >
              ${escapeHtml(grade.label)}
            </span>
            · #${escapeHtml(item.itemId)}
          </div>
        </td>

        <td>
          ${escapeHtml(item.characterName)}
        </td>

        <td>
          ${formatNumber(item.quantity)}
        </td>

        <td>
          <div class="im2-chips">
            ${
              item.types.length
                ? item.types
                    .map(
                      (type) => `
                        <span class="im2-chip">
                          ${escapeHtml(type)}
                        </span>
                      `,
                    )
                    .join('')
                : `
                  <span class="im2-item-sub">
                    -
                  </span>
                `
            }
          </div>
        </td>

        <td>
          ${escapeHtml(item.folderName)}
        </td>

        <td>
          <details class="im2-menu">
            <summary aria-label="작업 메뉴">
              •••
            </summary>

            <div class="im2-menu-pop">
              <button
                data-action="move-item"
                data-key="${encodeKey(item.key)}"
              >
                폴더 이동
              </button>

              ${
                item.boxType !== 'none'
                  ? `
                    <button
                      data-action="use-item"
                      data-key="${encodeKey(item.key)}"
                    >
                      사용
                    </button>
                  `
                  : ''
              }

              <button
                class="is-danger"
                data-action="discard-item"
                data-key="${encodeKey(item.key)}"
              >
                버리기
              </button>
            </div>
          </details>
        </td>
      </tr>
    `;
  }

  function renderOrganize() {
    const available =
      state.snapshots.filter(
        (snapshot) => !snapshot.error,
      );

    const plans =
      state.organizePlans;

    const totals =
      plans
        ? {
            creates: plans.reduce(
              (n, p) =>
                n + p.createFolders.length,
              0,
            ),

            moves: plans.reduce(
              (n, p) =>
                n
                + p.moves.reduce(
                  (m, move) =>
                    m + move.itemIds.length,
                  0,
                ),
              0,
            ),

            review: plans.reduce((n, p) => n + p.decisions.filter(
              (decision) => decision.tier === 'review').length, 0),
            stays: plans.reduce((n, p) => n + p.decisions.filter(
              (decision) => decision.tier === 'stay').length, 0),
          }
        : null;

    return `
      <div class="im2-settings-grid">
        <section
          class="im2-section"
          style="margin-top:0"
        >
          <div class="im2-section-head">
            <div>
              <div class="im2-section-title">
                정리 규칙
              </div>

              <div class="im2-section-desc">
                폴더 밖 아이템만 대상으로 합니다.
              </div>
            </div>
          </div>

          <div class="im2-section-body">
            <div class="im2-field">
              <label>
                종류 우선순위
              </label>

              <input
                class="im2-input"
                style="width:100%"
                data-input="type-priority"
                value="${escapeHtml(state.typePriority.join(', '))}"
                placeholder="예: 소모품, 재료, 선물"
              >

              <div class="im2-help">
                기존 폴더와 직접 지정한 규칙으로 판단할 수 없을 때
                사용할 종류 순서입니다. 쉼표로 구분합니다.
              </div>
            </div>

            <div class="im2-field">
              <label>
                보호 폴더
              </label>

              <div class="im2-help">
                선택한 폴더는 자동 정리 목적지로 사용하지 않습니다.
              </div>
            </div>

            ${
              available.length
                ? available
                    .map(
                      (snapshot) => `
                        <div class="im2-character-protect">
                          <strong>
                            ${escapeHtml(snapshot.characterName)}
                          </strong>

                          <div class="im2-checkbox-grid">
                            ${
                              (snapshot.folders || []).length
                                ? snapshot.folders
                                    .map(
                                      (folder) => `
                                        <label class="im2-check-pill">
                                          <input
                                            type="checkbox"
                                            data-action="toggle-protected-folder"
                                            data-character="${escapeHtml(snapshot.characterId)}"
                                            data-folder="${escapeHtml(folder.id)}"
                                            ${
                                              (
                                                state.protectedFolders[
                                                  snapshot.characterId
                                                ] || []
                                              ).includes(String(folder.id))
                                                ? 'checked'
                                                : ''
                                            }
                                          >
                                          ${escapeHtml(folder.name)}
                                        </label>
                                      `,
                                    )
                                    .join('')
                                : `
                                  <span class="im2-help">
                                    폴더 없음
                                  </span>
                                `
                            }
                          </div>
                        </div>
                      `,
                    )
                    .join('')
                : `
                  <div class="im2-empty">
                    먼저 인벤토리를 불러오세요.
                  </div>
                `
            }

            <button
              class="im2-btn primary"
              style="width:100%;margin-top:12px"
              data-action="plan-organize"
              ${available.length ? '' : 'disabled'}
            >
              변경 내용 미리보기
            </button>
          </div>
        </section>

        <section
          class="im2-section"
          style="margin-top:0"
        >
          <div class="im2-section-head">
            <div>
              <div class="im2-section-title">
                미리보기
              </div>

              <div class="im2-section-desc">
                확실한 이동만 기본 선택합니다. 나머지는 확인 후 추가할 수 있습니다.
              </div>
            </div>
          </div>

          <div class="im2-section-body">
            ${
              plans
                ? `
                  <div class="im2-plan-summary">
                    <div class="im2-plan-stat">
                      <span>새 폴더</span>
                      <strong>
                        ${formatNumber(totals.creates)}
                      </strong>
                    </div>

                    <div class="im2-plan-stat">
                      <span>이동 예정</span>
                      <strong>
                        ${formatNumber(totals.moves)}
                      </strong>
                    </div>

                    <div class="im2-plan-stat">
                      <span>확인 필요</span>
                      <strong>
                        ${formatNumber(totals.review)}
                      </strong>
                    </div>

                    <div class="im2-plan-stat">
                      <span>그대로 두기</span>
                      <strong>
                        ${formatNumber(totals.stays)}
                      </strong>
                    </div>
                  </div>

                  ${plans.map(renderPlanCharacter).join('')}

                  <button
                    class="im2-btn primary"
                    style="width:100%;margin-top:12px"
                    data-action="apply-organize"
                    ${
                      totals.creates || totals.moves
                        ? ''
                        : 'disabled'
                    }
                  >
                    이 계획 적용
                  </button>
                `
                : `
                  <div class="im2-empty">
                    규칙을 설정한 뒤 미리보기를 만드세요.
                  </div>
                `
            }
          </div>
        </section>
      </div>
    `;
  }

  function renderPlanCharacter(plan) {
    const snapshot = snapshotFor(plan.characterId);
    const folders = (snapshot && snapshot.folders || []).filter((folder) =>
      !(state.protectedFolders[plan.characterId] || []).includes(String(folder.id)));
    const folderNameCounts = new Map();
    folders.forEach((folder) => folderNameCounts.set(folder.name,
      (folderNameCounts.get(folder.name) || 0) + 1));
    const folderLabel = (folder) => folderNameCounts.get(folder.name) > 1
      ? `${folder.name} (ID ${folder.id})` : folder.name;
    const destinationName = (value) => value.startsWith('new:')
      ? `${value.slice(4)} (새 폴더)`
      : (() => {
        const folder = folders.find((entry) => String(entry.id) === value);
        return folder ? folderLabel(folder) : '목적지 없음';
      })();
    const renderDecision = (decision) => {
      const rule = (state.organizeRules[plan.characterId] || {})[
        normalizeItemName(decision.itemName).toLocaleLowerCase('ko')];
      const selected = decision.target || (decision.reason === '직접 보류' ? 'skip' : 'auto');
      const remembered = rule && (rule === (decision.target || 'skip')
        || (String(rule).startsWith('new:') && decision.target
          && destinationName(decision.target) === String(rule).slice(4)));
      const newDestination = [decision.target, decision.suggestion]
        .find((value) => value.startsWith('new:'));
      return `
        <div class="im2-plan-item">
          <div><strong>${escapeHtml(decision.itemName)}</strong>
            <span class="im2-help"> · ${escapeHtml(decision.reason)}</span></div>
          <div class="im2-plan-item-controls">
            <select class="im2-input" aria-label="${escapeHtml(decision.itemName)} 목적지"
              data-input="organize-destination"
              data-character="${escapeHtml(plan.characterId)}"
              data-item="${escapeHtml(decision.itemId)}">
              <option value="auto" ${selected === 'auto' ? 'selected' : ''}>자동 판단</option>
              <option value="skip" ${selected === 'skip' ? 'selected' : ''}>이동하지 않음</option>
              ${folders.map((folder) => `
                <option value="${escapeHtml(folder.id)}"
                  ${selected === String(folder.id) ? 'selected' : ''}>
                  ${escapeHtml(folderLabel(folder))}
                </option>`).join('')}
              ${newDestination ? `<option value="${escapeHtml(newDestination)}"
                ${selected === newDestination ? 'selected' : ''}>
                ${escapeHtml(destinationName(newDestination))}</option>` : ''}
            </select>
            <label class="im2-help">
              <input type="checkbox" data-input="organize-remember"
                data-character="${escapeHtml(plan.characterId)}"
                data-item="${escapeHtml(decision.itemId)}"
                ${remembered ? 'checked' : ''}
                ${selected === 'auto' ? 'disabled' : ''}>
              앞으로 같은 이름에도 적용
            </label>
            ${rule && !remembered ? `<span class="im2-help">
              이번만 변경 · 기억한 규칙은 ${escapeHtml(rule === 'skip'
                ? '이동하지 않음' : destinationName(String(rule)))}
            </span>` : ''}
          </div>
        </div>`;
    };
    const renderGroup = (title, decisions, key, open = false) => {
      if (!decisions.length) return '';
      const byDestination = new Map();
      decisions.forEach((decision) => {
        const destination = decision.target || decision.suggestion || '';
        if (!byDestination.has(destination)) byDestination.set(destination, []);
        byDestination.get(destination).push(decision);
      });
      return `
        <details class="im2-plan-group" data-plan-group="${escapeHtml(plan.characterId + ':' + key)}"
          ${open ? 'open' : ''}>
          <summary>${title} · ${formatNumber(decisions.length)}</summary>
          ${[...byDestination.entries()].map(([destination, items]) => `
            <div class="im2-plan-destination">
              <strong>${destination ? escapeHtml(destinationName(destination)) : '목적지 미정'}</strong>
              <span class="im2-help"> · ${formatNumber(items.length)}개</span>
              ${key === 'review' && destination ? `
                <button class="im2-btn" type="button"
                  data-action="accept-organize-suggestions"
                  data-character="${escapeHtml(plan.characterId)}"
                  data-destination="${escapeHtml(destination)}">
                  추천 모두 선택
                </button>` : ''}
            </div>
            ${items.map(renderDecision).join('')}
          `).join('')}
        </details>`;
    };
    return `
      <div class="im2-plan-char">
        <strong>${escapeHtml(plan.characterName)}</strong>
        ${renderGroup('이동 예정', plan.decisions.filter((d) => d.tier === 'ready'), 'ready')}
        ${renderGroup('확인 필요', plan.decisions.filter((d) => d.tier === 'review'), 'review', true)}
        ${renderGroup('그대로 두기', plan.decisions.filter((d) => d.tier === 'stay'), 'stay')}
      </div>`;
  }

  function currentNuiRecords() {
    return makeNuiRecords(
      allRecords(),
      state.nuiStatuses,
      state.nuiDuplicateMode,
      state.nuiStarred,
    );
  }

  function visibleNuiRecords() {
    const query =
      normalizeItemName(state.nuiQuery)
        .toLocaleLowerCase('ko');

    return sortNuiImageItems(
      currentNuiRecords()
        .filter((item) => {
        if (
          state.nuiFilter !== 'all'
          && (state.nuiDuplicateMode
            ? (item.tradeQuantity > 0 ? 'available'
              : item.status === 'unavailable' ? 'unavailable' : 'unclassified')
            : item.status) !== state.nuiFilter
        ) {
          return false;
        }

        if (!query) return true;

        return [
          item.itemName,
          item.characterName,
          item.folderName,
        ]
          .join(' ')
          .toLocaleLowerCase('ko')
          .includes(query);
        }),
    );
  }

  function renderNui() {
    if (state.preview) {
      return renderNuiPreview();
    }

    const records =
      currentNuiRecords();

    const counts =
      countStatuses(records);
    const tradeCopies = records.reduce((sum, item) =>
      sum + item.tradeQuantity, 0);
    const starredKinds = new Set(records.filter((item) => item.starred)
      .map(nuiDuplicateKey)).size;

    const tickets =
      countExchangeTickets(allRecords());

    return `
      <div class="im2-nui-stats">
        <span class="im2-status-chip">
          교환권
          <strong>${formatNumber(tickets)}</strong>장 ·
          ${formatNumber(Math.floor(tickets / 10))}회
        </span>

        <span class="im2-status-chip success">
          교환 가능
          <strong>${formatNumber(state.nuiDuplicateMode ? tradeCopies : counts.available)}</strong>
        </span>

        <span class="im2-status-chip danger">
          ${state.nuiDuplicateMode ? '전량 보관' : '교환 불가'}
          <strong>${formatNumber(counts.unavailable)}</strong>
        </span>

        <span class="im2-status-chip warning">
          ${state.nuiDuplicateMode ? '기본 상태' : '미분류'}
          <strong>${formatNumber(counts.unclassified)}</strong>
        </span>

        <span class="im2-status-chip">
          별표 보관 <strong>${formatNumber(starredKinds)}</strong>종
        </span>
      </div>

      <div class="im2-toolbar">
        <button class="im2-btn" type="button"
          data-action="toggle-nui-duplicate-mode"
          aria-pressed="${state.nuiDuplicateMode}"
          ${records.length || state.nuiDuplicateMode ? '' : 'disabled'}>
          ${state.nuiDuplicateMode ? '중복 자동 설정 끄기' : '중복 자동 설정'}
        </button>

        <label class="im2-compact-toggle">
          <input
            type="checkbox"
            data-input="nui-compact-mode"
            ${state.busy ? 'disabled' : ''}
            ${state.nuiCompactMode ? 'checked' : ''}
          >
          간략화 모드
        </label>

        <label class="im2-compact-toggle">
          <input
            type="checkbox"
            data-input="nui-auto-paginate"
            ${state.busy ? 'disabled' : ''}
            ${state.nuiAutoPaginate ? 'checked' : ''}
          >
          페이지 자동 분할
        </label>

        <input
          class="im2-input im2-search"
          data-input="nui-query"
          data-focus-key="nui-query"
          type="search"
          value="${escapeHtml(state.nuiQuery)}"
          placeholder="누이 이름·캐릭터·폴더 검색"
        >

        <select
          class="im2-select"
          data-input="nui-filter"
        >
          <option
            value="all"
            ${state.nuiFilter === 'all' ? 'selected' : ''}
          >
            전체 상태
          </option>

          <option
            value="unclassified"
            ${state.nuiFilter === 'unclassified' ? 'selected' : ''}
          >
            ${state.nuiDuplicateMode ? '교환 가능 수량 없음' : '미분류'}
          </option>

          <option
            value="available"
            ${state.nuiFilter === 'available' ? 'selected' : ''}
          >
            ${state.nuiDuplicateMode ? '교환 가능 수량 있음' : '교환 가능'}
          </option>

          <option
            value="unavailable"
            ${state.nuiFilter === 'unavailable' ? 'selected' : ''}
          >
            ${state.nuiDuplicateMode ? '전량 보관' : '교환 불가'}
          </option>
        </select>

        <button
          class="im2-btn"
          data-action="select-visible-nui"
        >
          현재 목록 선택
        </button>

        <button
          class="im2-btn primary"
          data-action="make-nui-image"
          ${tradeCopies ? '' : 'disabled'}
        >
          PNG 미리보기
        </button>
      </div>

      <div data-region="nui-results">
        ${renderNuiResults()}
      </div>
    `;
  }

  function renderNuiResults() {
    const records =
      currentNuiRecords();

    const visible =
      visibleNuiRecords();

    const counts =
      countStatuses(records);

    return `
      <div class="im2-filter-note">
        ${formatNumber(visible.length)}개 표시 ·
        ${formatNumber(state.nuiSelected.size)}개 선택 ·
        자동 정렬: 누이 종류 → No. 숫자 → 캐릭터 별칭
        ${state.nuiDuplicateMode ? ' · 전체 캐릭터 기준 1개 보관 · 전량 보관 항목 제외' : ''}
        ${
          counts.unclassified && !state.nuiDuplicateMode
            ? ` · 미분류 ${formatNumber(counts.unclassified)}개는 PNG에서 제외됩니다.`
            : ''
        }
      </div>

      <div class="im2-nui-list">
        ${
          visible.length
            ? visible.map(renderNuiRow).join('')
            : `
              <div class="im2-empty">
                조건에 맞는 누이 아이템이 없습니다.
              </div>
            `
        }
      </div>

      ${
        state.nuiSelected.size
          ? `
            <div class="im2-bulkbar">
              <strong>
                ${formatNumber(state.nuiSelected.size)}개 선택
              </strong>

              <button
                class="im2-btn"
                data-action="mark-nui"
                data-status="available"
              >
                ${state.nuiDuplicateMode ? '교환 우선' : '교환 가능'}
              </button>

              <button
                class="im2-btn"
                data-action="mark-nui"
                data-status="unavailable"
              >
                ${state.nuiDuplicateMode ? '전량 보관' : '교환 불가'}
              </button>

              <button
                class="im2-btn ghost"
                data-action="clear-nui-selection"
              >
                선택 해제
              </button>
            </div>
          `
          : ''
      }
    `;
  }

  function renderNuiRow(item) {
    const grade =
      gradeInfo(item.grade);

    const resolvedImage =
      resolveImageUrl(
        item.imageUrl,
        origin,
      );

    const image =
      resolvedImage
        ? `
          <img
            class="im2-thumb"
            src="${escapeHtml(resolvedImage)}"
            alt=""
            loading="lazy"
          >
        `
        : '<div class="im2-thumb"></div>';

    return `
      <div
        class="im2-nui-row ${
          state.nuiSelected.has(item.key)
            ? 'is-selected'
            : ''
        }"
      >
        <input
          type="checkbox"
          data-action="toggle-nui-select"
          data-key="${encodeKey(item.key)}"
          ${state.nuiSelected.has(item.key) ? 'checked' : ''}
        >

        ${image}

        <div>
          <div class="im2-nui-name-line">
            <button class="im2-nui-star" type="button"
              data-action="toggle-nui-star" data-key="${encodeKey(item.key)}"
              aria-pressed="${item.starred}"
              aria-label="${item.starred ? '소장 예외 해제' : '소장 예외 표시'}"
              title="${item.starred ? '소장 예외 해제' : '모든 캐릭터의 동일 누이 전량 보관'}">
              ${item.starred ? '★' : '☆'}
            </button>
            <div class="im2-item-name">
              ${escapeHtml(item.itemName)}
            </div>
          </div>

          <div class="im2-item-sub">
            ${escapeHtml(item.characterName)}
            · ${escapeHtml(item.folderName)}
            ·
            <span style="color:${grade.color}">
              ${escapeHtml(grade.label)}
            </span>
            · ×${formatNumber(item.quantity)}
            ${state.nuiDuplicateMode ? item.starred
              ? ' · 별표 보관'
              : ` · 교환 가능 ×${formatNumber(item.tradeQuantity)}` : ''}
          </div>
        </div>

        <div class="im2-nui-actions">
          <button
            class="im2-status-btn success ${
              item.status === 'available'
                ? 'is-active'
                : ''
            }"
            data-action="set-nui-status"
            data-key="${encodeKey(item.key)}"
            data-status="available"
          >
            ${state.nuiDuplicateMode ? '교환 우선' : '가능'}
          </button>

          <button
            class="im2-status-btn danger ${
              item.status === 'unavailable'
                ? 'is-active'
                : ''
            }"
            data-action="set-nui-status"
            data-key="${encodeKey(item.key)}"
            data-status="unavailable"
          >
            ${state.nuiDuplicateMode ? '전량 보관' : '불가'}
          </button>

          <button
            class="im2-status-btn ${
              item.status === 'unclassified'
                ? 'is-active'
                : ''
            }"
            data-action="set-nui-status"
            data-key="${encodeKey(item.key)}"
            data-status="unclassified"
          >
            ${state.nuiDuplicateMode ? '기본' : '미분류'}
          </button>
        </div>
      </div>
    `;
  }

  function renderNuiPreview() {
    const preview = state.preview;
    const availableCount =
      currentNuiRecords()
        .reduce((sum, item) => sum + item.tradeQuantity, 0);

    return `
      <div class="im2-preview">
        <div class="im2-toolbar">
          <button
            class="im2-btn"
            data-action="close-preview"
          >
            ← 분류로 돌아가기
          </button>

          <button
            class="im2-btn"
            data-action="rebuild-preview"
          >
            현재 테마로 다시 만들기
          </button>

          <button
            class="im2-btn primary"
            data-action="download-preview"
            ${state.nuiPageSaveEnabled ? '' : 'hidden'}
            ${state.busy ? 'disabled' : ''}
          >
            현재 페이지 저장
          </button>

          ${canDownloadAllNuiPages(preview, state.nuiAutoPaginate) ? `
            <select
              class="im2-select"
              data-input="nui-download-mode"
              aria-label="전체 페이지 저장 방식"
              ${state.busy ? 'disabled' : ''}
            >
              <option value="individual" ${state.nuiDownloadMode === 'individual' ? 'selected' : ''}>
                개별 PNG 다운로드 (기본)
              </option>
              <option value="zip" ${state.nuiDownloadMode === 'zip' ? 'selected' : ''}>
                ZIP 파일
              </option>
            </select>

            <button
              class="im2-btn primary"
              data-action="download-all-preview-pages"
              ${state.busy ? 'disabled' : ''}
            >
              전체 페이지 저장
            </button>
          ` : ''}

          <label class="im2-compact-toggle">
            <input
              type="checkbox"
              data-input="nui-page-save-mode"
              ${state.busy ? 'disabled' : ''}
              ${state.nuiPageSaveEnabled ? 'checked' : ''}
            >
            페이지별 저장
          </label>

          <label class="im2-compact-toggle">
            <input
              type="checkbox"
              data-input="nui-compact-mode"
              ${state.busy ? 'disabled' : ''}
              ${state.nuiCompactMode ? 'checked' : ''}
            >
            간략화 모드
          </label>

          <label class="im2-compact-toggle">
            <input
              type="checkbox"
              data-input="nui-auto-paginate"
              ${state.busy ? 'disabled' : ''}
              ${state.nuiAutoPaginate ? 'checked' : ''}
            >
            페이지 자동 분할
          </label>
        </div>

        <div class="im2-filter-note">
          교환 가능 ${formatNumber(availableCount)}개 ·
          페이지 ${formatNumber(preview.pageIndex + 1)}/${formatNumber(preview.pages.length)} ·
          ${formatNumber(preview.width)} × ${formatNumber(preview.height)}px
        </div>

        <div class="im2-preview-pager">
          <button
            class="im2-btn"
            data-action="previous-preview-page"
            ${preview.pageIndex <= 0 ? 'disabled' : ''}
          >
            ← 이전 페이지
          </button>
          <strong>${formatNumber(preview.pageIndex + 1)} / ${formatNumber(preview.pages.length)}</strong>
          <button
            class="im2-btn"
            data-action="next-preview-page"
            ${preview.pageIndex >= preview.pages.length - 1 ? 'disabled' : ''}
          >
            다음 페이지 →
          </button>
        </div>

        <img
          src="${escapeHtml(preview.url)}"
          alt="누이 교환 가능 목록 미리보기"
        >
      </div>
    `;
  }

  function selectedNuiWantedCards() {
    return getSelectedNuiWantedCards(
      state.nuiWantedCatalog,
      state.nuiWantedSelected,
    );
  }

  function visibleNuiWantedCards() {
    return filterNuiWantedCatalog(
      state.nuiWantedSortedCatalog,
      state.nuiWantedQuery,
      state.nuiWantedCategory,
    );
  }

  function renderNuiWanted() {
    if (state.nuiWantedPreview) {
      return renderNuiWantedPreview();
    }

    if (!state.nuiWantedCatalog.length) {
      return `
        <div class="im2-empty">
          ${state.nuiWantedLoading
            ? '누이 구해요 목록을 불러오는 중입니다.'
            : escapeHtml(state.nuiWantedError || '누이 구해요 목록을 아직 불러오지 않았습니다.')}
          ${state.nuiWantedLoading ? '' : `
            <button class="im2-btn" data-action="refresh-nui-wanted-catalog">
              다시 불러오기
            </button>
          `}
        </div>
      `;
    }

    const visible = visibleNuiWantedCards();
    const selected = selectedNuiWantedCards();
    const categories = state.nuiWantedCategories;

    return `
      <div class="im2-nui-stats">
        <span class="im2-status-chip">
          구해요 누이
          <strong>${formatNumber(state.nuiWantedCatalog.length)}</strong>종
        </span>

        <span class="im2-status-chip success">
          구할 누이
          <strong>${formatNumber(selected.length)}</strong>개 선택
        </span>

        <span class="im2-status-chip">
          GitHub 공개 목록 · 선택 결과는 이 브라우저에 저장
        </span>
      </div>

      ${state.nuiWantedError ? `
        <div class="im2-filter-note">
          마지막 저장 목록을 표시합니다. 갱신 실패: ${escapeHtml(state.nuiWantedError)}
        </div>
      ` : ''}

      <div class="im2-toolbar">
        <button
          class="im2-btn"
          data-action="refresh-nui-wanted-catalog"
          ${state.nuiWantedLoading ? 'disabled' : ''}
        >
          ${state.nuiWantedLoading ? '목록 갱신 중' : '목록 업데이트'}
        </button>

        <label class="im2-compact-toggle">
          <input
            type="checkbox"
            data-input="nui-compact-mode"
            ${state.busy ? 'disabled' : ''}
            ${state.nuiCompactMode ? 'checked' : ''}
          >
          간략화 모드
        </label>

        <label class="im2-compact-toggle">
          <input
            type="checkbox"
            data-input="nui-auto-paginate"
            ${state.busy ? 'disabled' : ''}
            ${state.nuiAutoPaginate ? 'checked' : ''}
          >
          페이지 자동 분할
        </label>

        <input
          class="im2-input im2-search"
          data-input="nui-wanted-query"
          data-focus-key="nui-wanted-query"
          type="search"
          value="${escapeHtml(state.nuiWantedQuery)}"
          placeholder="누이 이름 검색"
        >

        <select
          class="im2-select"
          data-input="nui-wanted-category"
        >
          <option value="all" ${state.nuiWantedCategory === 'all' ? 'selected' : ''}>
            전체 분류
          </option>
          ${categories.map((category) => `
            <option
              value="${escapeHtml(category)}"
              ${state.nuiWantedCategory === category ? 'selected' : ''}
            >
              ${escapeHtml(category)}
            </option>
          `).join('')}
        </select>

        <button
          class="im2-btn"
          data-action="select-visible-nui-wanted"
          ${visible.length ? '' : 'disabled'}
        >
          현재 목록 선택
        </button>

        <button
          class="im2-btn primary"
          data-action="make-nui-wanted-image"
          ${selected.length && !state.busy ? '' : 'disabled'}
        >
          구해요 PNG 미리보기
        </button>
      </div>

      <div data-region="nui-wanted-results">
        ${renderNuiWantedResults()}
      </div>
    `;
  }

  function renderNuiWantedResults() {
    const visible = visibleNuiWantedCards();
    const selected = selectedNuiWantedCards();

    return `
      <div class="im2-filter-note">
        ${formatNumber(visible.length)}개 표시 ·
        ${formatNumber(selected.length)}개 선택 ·
        자동 정렬: 누이 종류 → No. 숫자 → 캐릭터 별칭 ·
        그림은 서버 원본 URL 사용
      </div>

      <div class="im2-nui-list">
        ${visible.length
          ? visible.map(renderNuiWantedRow).join('')
          : `
            <div class="im2-empty">
              조건에 맞는 누이가 없습니다.
            </div>
          `
        }
      </div>

      ${selected.length
        ? `
          <div class="im2-bulkbar">
            <strong>${formatNumber(selected.length)}개 선택</strong>
            <button
              class="im2-btn ghost"
              data-action="clear-nui-wanted-selection"
            >
              선택 해제
            </button>
            <button
              class="im2-btn primary"
              data-action="make-nui-wanted-image"
              ${state.busy ? 'disabled' : ''}
            >
              구해요 PNG 만들기
            </button>
          </div>
        `
        : ''
      }
    `;
  }

  function renderNuiWantedRow(item) {
    const imageUrl = resolveImageUrl(item.image, origin);
    const selected = state.nuiWantedSelected.has(item.key);

    return `
      <label class="im2-nui-row ${selected ? 'is-selected' : ''}">
        <input
          type="checkbox"
          data-action="toggle-nui-wanted-select"
          data-key="${encodeKey(item.key)}"
          ${selected ? 'checked' : ''}
        >

        ${imageUrl
          ? `
            <img
              class="im2-thumb"
              src="${escapeHtml(imageUrl)}"
              alt="${escapeHtml(item.name)} 그림"
              loading="lazy"
            >
          `
          : '<div class="im2-thumb"></div>'
        }

        <span class="im2-item-name">
          ${escapeHtml(item.name)}
        </span>

        <span class="im2-wanted-tag">
          ${escapeHtml(item.category)} · ${escapeHtml(gradeInfo(item.grade).label)}
        </span>
      </label>
    `;
  }

  function renderNuiWantedPreview() {
    const preview = state.nuiWantedPreview;
    const count = selectedNuiWantedCards().length;

    return `
      <div class="im2-preview">
        <div class="im2-toolbar">
          <button
            class="im2-btn"
            data-action="close-nui-wanted-preview"
          >
            ← 누이 선택으로 돌아가기
          </button>

          <button
            class="im2-btn"
            data-action="rebuild-nui-wanted-preview"
          >
            현재 테마로 다시 만들기
          </button>

          <button
            class="im2-btn primary"
            data-action="download-nui-wanted-preview"
            ${state.nuiPageSaveEnabled ? '' : 'hidden'}
            ${state.busy ? 'disabled' : ''}
          >
            현재 페이지 저장
          </button>

          ${canDownloadAllNuiPages(preview, state.nuiAutoPaginate) ? `
            <select
              class="im2-select"
              data-input="nui-download-mode"
              aria-label="전체 페이지 저장 방식"
              ${state.busy ? 'disabled' : ''}
            >
              <option value="individual" ${state.nuiDownloadMode === 'individual' ? 'selected' : ''}>
                개별 PNG 다운로드 (기본)
              </option>
              <option value="zip" ${state.nuiDownloadMode === 'zip' ? 'selected' : ''}>
                ZIP 파일
              </option>
            </select>

            <button
              class="im2-btn primary"
              data-action="download-all-nui-wanted-pages"
              ${state.busy ? 'disabled' : ''}
            >
              전체 페이지 저장
            </button>
          ` : ''}

          <label class="im2-compact-toggle">
            <input
              type="checkbox"
              data-input="nui-page-save-mode"
              ${state.busy ? 'disabled' : ''}
              ${state.nuiPageSaveEnabled ? 'checked' : ''}
            >
            페이지별 저장
          </label>

          <label class="im2-compact-toggle">
            <input
              type="checkbox"
              data-input="nui-compact-mode"
              ${state.busy ? 'disabled' : ''}
              ${state.nuiCompactMode ? 'checked' : ''}
            >
            간략화 모드
          </label>

          <label class="im2-compact-toggle">
            <input
              type="checkbox"
              data-input="nui-auto-paginate"
              ${state.busy ? 'disabled' : ''}
              ${state.nuiAutoPaginate ? 'checked' : ''}
            >
            페이지 자동 분할
          </label>
        </div>

        <div class="im2-filter-note">
          구해요 ${formatNumber(count)}개 ·
          페이지 ${formatNumber(preview.pageIndex + 1)}/${formatNumber(preview.pages.length)} ·
          ${formatNumber(preview.width)} × ${formatNumber(preview.height)}px
        </div>

        <div class="im2-preview-pager">
          <button
            class="im2-btn"
            data-action="previous-preview-page"
            ${preview.pageIndex <= 0 ? 'disabled' : ''}
          >
            ← 이전 페이지
          </button>
          <strong>${formatNumber(preview.pageIndex + 1)} / ${formatNumber(preview.pages.length)}</strong>
          <button
            class="im2-btn"
            data-action="next-preview-page"
            ${preview.pageIndex >= preview.pages.length - 1 ? 'disabled' : ''}
          >
            다음 페이지 →
          </button>
        </div>

        <img
          src="${escapeHtml(preview.url)}"
          alt="이 누이 구해요 이미지 미리보기"
        >
      </div>
    `;
  }

  function renderDialog() {
    const dialog =
      state.dialog;

    if (!dialog) return '';

    if (dialog.type === 'move-item') {
      return renderMoveItemDialog(dialog);
    }

    if (dialog.type === 'discard-item') {
      return renderDiscardDialog(dialog);
    }

    if (dialog.type === 'use-item') {
      return renderUseDialog(dialog);
    }

    if (dialog.type === 'folder-manager') {
      return renderFolderManager(dialog);
    }

    if (dialog.type === 'rename-folder') {
      return renderRenameFolder(dialog);
    }

    if (dialog.type === 'delete-folder') {
      return renderDeleteFolder(dialog);
    }

    if (dialog.type === 'item-order') {
      return renderItemOrder(dialog);
    }

    if (dialog.type === 'bulk-move') {
      return renderBulkMove(dialog);
    }

    if (dialog.type === 'bulk-discard') {
      return renderBulkDiscard(dialog);
    }

    if (dialog.type === 'apply-organize') {
      return renderApplyOrganize(dialog);
    }

    return '';
  }

  function dialogFrame(
    title,
    body,
    footer,
    wide = false,
  ) {
    return `
      <div class="im2-dialog ${wide ? 'wide' : ''}">
        <div class="im2-dialog-head">
          <strong>
            ${escapeHtml(title)}
          </strong>

          <button
            class="im2-icon-btn"
            data-action="close-dialog"
          >
            ×
          </button>
        </div>

        <div class="im2-dialog-body">
          ${body}
        </div>

        <div class="im2-dialog-foot">
          ${footer}
        </div>
      </div>
    `;
  }

  function folderOptions(
    snapshot,
    selectedId = '0',
  ) {
    return `
      <option
        value="0"
        ${String(selectedId) === '0' ? 'selected' : ''}
      >
        폴더 밖
      </option>

      ${(snapshot && snapshot.folders || [])
        .map(
          (folder) => `
            <option
              value="${escapeHtml(folder.id)}"
              ${
                String(selectedId) === String(folder.id)
                  ? 'selected'
                  : ''
              }
            >
              ${escapeHtml(folder.name)}
              ${folder.isHidden ? ' (숨김)' : ''}
            </option>
          `,
        )
        .join('')}
    `;
  }

  function renderMoveItemDialog(dialog) {
    const item =
      recordFor(dialog.key);

    if (!item) {
      return dialogFrame(
        '폴더 이동',
        `
          <div class="im2-empty">
            아이템을 찾을 수 없습니다.
          </div>
        `,
        `
          <button
            class="im2-btn"
            data-action="close-dialog"
          >
            닫기
          </button>
        `,
      );
    }

    const snapshot =
      snapshotFor(item.characterId);

    return dialogFrame(
      '폴더 이동',
      `
        <div class="im2-field">
          <label>
            ${escapeHtml(item.itemName)}
          </label>

          <div class="im2-help">
            ${escapeHtml(item.characterName)}
            · 현재 ${escapeHtml(item.folderName)}
          </div>
        </div>

        <div class="im2-field">
          <label>
            이동할 폴더
          </label>

          <select
            class="im2-select"
            style="width:100%"
            data-dialog-input="folder-id"
          >
            ${folderOptions(snapshot, item.folderId)}
          </select>
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="close-dialog"
        >
          취소
        </button>

        <button
          class="im2-btn primary"
          data-action="submit-move-item"
        >
          이동
        </button>
      `,
    );
  }

  function renderDiscardDialog(dialog) {
    const item =
      recordFor(dialog.key);

    if (!item) return '';

    return dialogFrame(
      '아이템 버리기',
      `
        <div class="im2-danger-box">
          <strong>
            ${escapeHtml(item.itemName)}
          </strong>을(를) 버리면 되돌릴 수 없습니다.
        </div>

        <div
          class="im2-field"
          style="margin-top:14px"
        >
          <label>
            버릴 수량 · 최대 ${formatNumber(item.quantity)}
          </label>

          <input
            class="im2-input"
            style="width:100%"
            type="number"
            min="1"
            max="${item.quantity}"
            value="${item.quantity}"
            data-dialog-input="quantity"
          >
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="close-dialog"
        >
          취소
        </button>

        <button
          class="im2-btn danger"
          data-action="submit-discard-item"
        >
          버리기
        </button>
      `,
    );
  }

  function renderUseDialog(dialog) {
    const item =
      recordFor(dialog.key);

    if (!item) return '';

    const needsSelection =
      [
        'select',
        'enc_slot',
        'member_slot',
      ].includes(item.boxType);

    return dialogFrame(
      '아이템 사용',
      `
        <div class="im2-field">
          <label>
            ${escapeHtml(item.itemName)}
          </label>

          <div class="im2-help">
            사용 결과는 서버에 즉시 반영됩니다.
          </div>
        </div>

        ${
          needsSelection
            ? `
              <div class="im2-field">
                <label>
                  선택지 번호
                </label>

                <input
                  class="im2-input"
                  style="width:100%"
                  type="number"
                  min="0"
                  data-dialog-input="sel-idx"
                  placeholder="sel_idx"
                >
              </div>
            `
            : ''
        }
      `,
      `
        <button
          class="im2-btn"
          data-action="close-dialog"
        >
          취소
        </button>

        <button
          class="im2-btn primary"
          data-action="submit-use-item"
        >
          사용
        </button>
      `,
    );
  }

  function renderFolderManager(dialog) {
    const snapshot =
      snapshotFor(dialog.characterId);

    if (!snapshot) return '';

    return dialogFrame(
      `${snapshot.characterName} · 폴더 관리`,
      `
        <div class="im2-field">
          <label>
            새 폴더
          </label>

          <div style="display:flex;gap:7px">
            <input
              class="im2-input"
              style="flex:1"
              data-dialog-input="new-folder-name"
              placeholder="폴더 이름"
            >

            <button
              class="im2-btn primary"
              data-action="add-folder"
            >
              추가
            </button>
          </div>
        </div>

        <div class="im2-help">
          드래그해서 순서를 바꾼 뒤 저장할 수 있습니다.
        </div>

        <div
          class="im2-folder-list"
          data-folder-order="${escapeHtml(snapshot.characterId)}"
        >
          ${
            (snapshot.folders || []).length
              ? snapshot.folders
                  .map(
                    (folder) => `
                      <div
                        class="im2-folder-row"
                        draggable="true"
                        data-folder-id="${escapeHtml(folder.id)}"
                      >
                        <span class="im2-drag">
                          ⋮⋮
                        </span>

                        <div class="im2-folder-name">
                          <strong>
                            ${escapeHtml(folder.name)}
                          </strong>

                          <div class="im2-folder-meta">
                            ${
                              folder.isHidden
                                ? '숨김 폴더'
                                : '표시 중'
                            }
                          </div>
                        </div>

                        <div class="im2-folder-actions">
                          <button
                            class="im2-link"
                            data-action="rename-folder"
                            data-folder="${escapeHtml(folder.id)}"
                          >
                            이름 변경
                          </button>

                          <button
                            class="im2-link"
                            data-action="toggle-folder-hidden"
                            data-folder="${escapeHtml(folder.id)}"
                          >
                            ${
                              folder.isHidden
                                ? '표시'
                                : '숨김'
                            }
                          </button>

                          <button
                            class="im2-link danger"
                            data-action="delete-folder"
                            data-folder="${escapeHtml(folder.id)}"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    `,
                  )
                  .join('')
              : `
                <div class="im2-empty">
                  폴더가 없습니다.
                </div>
              `
          }
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="open-item-order"
        >
          아이템 순서
        </button>

        <button
          class="im2-btn"
          data-action="save-folder-order"
        >
          폴더 순서 저장
        </button>

        <button
          class="im2-btn primary"
          data-action="close-dialog"
        >
          닫기
        </button>
      `,
      true,
    );
  }

  function renderRenameFolder(dialog) {
    const snapshot =
      snapshotFor(dialog.characterId);

    const folder =
      snapshot
      && snapshot.folders.find(
        (f) =>
          String(f.id)
          === String(dialog.folderId),
      );

    if (!folder) return '';

    return dialogFrame(
      '폴더 이름 변경',
      `
        <div class="im2-field">
          <label>
            새 이름
          </label>

          <input
            class="im2-input"
            style="width:100%"
            value="${escapeHtml(folder.name)}"
            data-dialog-input="folder-name"
          >
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="back-folder-manager"
        >
          취소
        </button>

        <button
          class="im2-btn primary"
          data-action="submit-rename-folder"
        >
          변경
        </button>
      `,
    );
  }

  function renderDeleteFolder(dialog) {
    const snapshot =
      snapshotFor(dialog.characterId);

    const folder =
      snapshot
      && snapshot.folders.find(
        (f) =>
          String(f.id)
          === String(dialog.folderId),
      );

    if (!folder) return '';

    return dialogFrame(
      '폴더 삭제',
      `
        <div class="im2-danger-box">
          <strong>
            ${escapeHtml(folder.name)}
          </strong>
          폴더를 삭제합니다. 이 작업은 되돌릴 수 없습니다.
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="back-folder-manager"
        >
          취소
        </button>

        <button
          class="im2-btn danger"
          data-action="submit-delete-folder"
        >
          삭제
        </button>
      `,
    );
  }

  function renderItemOrder(dialog) {
    const snapshot =
      snapshotFor(dialog.characterId);

    if (!snapshot) return '';

    return dialogFrame(
      `${snapshot.characterName} · 아이템 순서`,
      `
        <div class="im2-help">
          드래그해서 원하는 순서로 정렬한 뒤 저장하세요.
        </div>

        <div
          class="im2-order-list"
          data-item-order="${escapeHtml(snapshot.characterId)}"
        >
          ${(snapshot.records || [])
            .map(
              (item) => `
                <div
                  class="im2-order-row"
                  draggable="true"
                  data-item-id="${escapeHtml(item.itemId)}"
                >
                  <span class="im2-drag">
                    ⋮⋮
                  </span>

                  <div class="im2-order-name">
                    ${escapeHtml(item.itemName)}

                    <div class="im2-folder-meta">
                      ${escapeHtml(item.folderName)}
                      · #${escapeHtml(item.itemId)}
                    </div>
                  </div>
                </div>
              `,
            )
            .join('')}
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="back-folder-manager"
        >
          취소
        </button>

        <button
          class="im2-btn primary"
          data-action="save-item-order"
        >
          순서 저장
        </button>
      `,
      true,
    );
  }

  function selectedRecords() {
    return allRecords()
      .filter(
        (record) =>
          state.selectedKeys.has(record.key),
      );
  }

  function groupRecordsByCharacter(records) {
    const map = new Map();

    (records || []).forEach((record) => {
      if (!map.has(record.characterId)) {
        map.set(record.characterId, []);
      }

      map.get(record.characterId)
        .push(record);
    });

    return [...map.entries()];
  }

  function renderBulkMove() {
    const groups =
      groupRecordsByCharacter(
        selectedRecords(),
      );

    return dialogFrame(
      '선택 항목 폴더 이동',
      `
        <div class="im2-help">
          캐릭터마다 이동할 폴더를 선택합니다.
        </div>

        ${groups
          .map(
            ([charId, items]) => {
              const snapshot =
                snapshotFor(charId);

              return `
                <div class="im2-character-protect">
                  <strong>
                    ${
                      escapeHtml(
                        snapshot
                          ? snapshot.characterName
                          : charId,
                      )
                    }
                    · ${formatNumber(items.length)}개
                  </strong>

                  <select
                    class="im2-select"
                    style="width:100%;margin-top:8px"
                    data-bulk-folder="${escapeHtml(charId)}"
                  >
                    ${folderOptions(snapshot, '0')}
                  </select>
                </div>
              `;
            },
          )
          .join('')}
      `,
      `
        <button
          class="im2-btn"
          data-action="close-dialog"
        >
          취소
        </button>

        <button
          class="im2-btn primary"
          data-action="submit-bulk-move"
        >
          이동
        </button>
      `,
    );
  }

  function renderBulkDiscard() {
    const items =
      selectedRecords();

    return dialogFrame(
      '선택 항목 버리기',
      `
        <div class="im2-danger-box">
          선택한 ${formatNumber(items.length)}개 항목의
          <strong>전체 수량</strong>을 버립니다.
          계속하려면 아래에 <strong>버리기</strong>를 입력하세요.
        </div>

        <div
          class="im2-field"
          style="margin-top:14px"
        >
          <input
            class="im2-input"
            style="width:100%"
            data-dialog-input="literal"
            placeholder="버리기"
          >
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="close-dialog"
        >
          취소
        </button>

        <button
          class="im2-btn danger"
          data-action="submit-bulk-discard"
        >
          전체 수량 버리기
        </button>
      `,
    );
  }

  function renderApplyOrganize() {
    const plans =
      state.organizePlans || [];

    const creates =
      plans.reduce(
        (n, p) =>
          n + p.createFolders.length,
        0,
      );

    const moves =
      plans.reduce(
        (n, p) =>
          n
          + p.moves.reduce(
            (m, move) =>
              m + move.itemIds.length,
            0,
          ),
        0,
      );

    return dialogFrame(
      '자동 정리 적용',
      `
        <div class="im2-field">
          <strong>
            새 폴더 ${formatNumber(creates)}개 ·
            아이템 ${formatNumber(moves)}개 이동
          </strong>

          <div class="im2-help">
            적용 직전에 각 캐릭터의 인벤토리를 다시 조회하고,
            같은 규칙으로 새 계획을 만든 뒤 처리합니다.
          </div>
        </div>
      `,
      `
        <button
          class="im2-btn"
          data-action="close-dialog"
        >
          취소
        </button>

        <button
          class="im2-btn primary"
          data-action="confirm-apply-organize"
        >
          적용
        </button>
      `,
    );
  }

  async function refresh(options = {}) {
    const characters =
      getCharacterMetas();

    if (!characters.length) {
      setMessage(
        '이 페이지에서 캐릭터 목록을 찾지 못했습니다.',
        'error',
      );
      renderApp();
      return;
    }

    state.loading = true;

    state.loadingProgress = {
      done: 0,
      total: characters.length,
    };

    setMessage(
      `${characters.length}개 캐릭터의 인벤토리를 불러오는 중입니다.`,
    );

    renderApp();

    const snapshots = [];

    for (const character of characters) {
      try {
        const data =
          await api.getInventory(
            character.characterId,
          );

        const folders =
          (data.folders || [])
            .map(normalizeFolder);

        const meta = {
          ...character,
          characterName:
            character.characterName
            || normalizeItemName(data.char_name),
        };

        snapshots.push({
          characterId:
            character.characterId,

          characterName:
            meta.characterName,

          ownerName:
            meta.ownerName,

          folders,

          records:
            (data.items || [])
              .map(
                (item) =>
                  normalizeInventoryRecord(
                    item,
                    meta,
                    folderMap(folders),
                  ),
              ),

          fetchedAt:
            Date.now(),
        });
      } catch (error) {
        snapshots.push({
          ...character,
          error:
            `${character.characterName}: ${
              error && error.message
              || '조회 실패'
            }`,
        });
      }

      state.loadingProgress.done += 1;
      renderApp();
    }

    state.snapshots =
      snapshots;

    state.loading =
      false;

    state.loadingProgress =
      null;

    state.lastFetchedAt =
      new Date();

    state.selectedKeys.clear();
    state.nuiSelected.clear();

    state.organizePlans =
      null;
    state.organizeOverrides = {};

    const summary =
      summarizeSnapshots(snapshots);

    const defaultText =
      `${formatNumber(summary.characterCount)}개 캐릭터 조회 완료${
        summary.errors.length
          ? ` · ${formatNumber(summary.errors.length)}개 실패`
          : ''
      }`;

    setMessage(
      options.message || defaultText,
      options.tone
      || (
        summary.errors.length
          ? 'info'
          : 'success'
      ),
    );

    renderApp();
  }

  async function runMutation(
    description,
    operation,
    options = {},
  ) {
    state.busy = true;
    state.dialog = null;

    setMessage(
      `${description} 처리 중입니다.`,
    );

    renderApp();

    try {
      await operation();

      if (options.noRefresh) {
        state.busy = false;

        setMessage(
          `${description} 완료`,
          'success',
        );

        renderApp();
      } else {
        state.busy = false;

        await refresh({
          message: `${description} 완료`,
          tone: 'success',
        });
      }
    } catch (error) {
      state.busy = false;

      setMessage(
        `${description} 실패: ${
          error && error.message
          || '알 수 없는 오류'
        }`,
        'error',
      );

      renderApp();
    }
  }

  function planOrganize() {
    state.organizePlans =
      state.snapshots
        .filter(
          (snapshot) =>
            !snapshot.error,
        )
        .map(
          (snapshot) =>
            buildAutoOrganizePlan(
              snapshot,
              {
                protectedFolderIds:
                  state.protectedFolders[
                    snapshot.characterId
                  ] || [],

                typePriority:
                  state.typePriority,
                itemRules: state.organizeRules[snapshot.characterId] || {},
                itemOverrides: state.organizeOverrides[snapshot.characterId] || {},
              },
            ),
        );

    renderApp();
  }

  async function applyOrganize() {
    const planned =
      state.organizePlans || [];

    state.busy = true;
    state.dialog = null;

    setMessage(
      '최신 데이터를 확인하고 자동 정리를 적용하는 중입니다.',
    );

    renderApp();

    const results = [];
    const prepared = [];

    for (const oldPlan of planned) {
      try {
        const oldSnapshot =
          snapshotFor(
            oldPlan.characterId,
          );

        const data =
          await api.getInventory(
            oldPlan.characterId,
          );

        const folders =
          (data.folders || [])
            .map(normalizeFolder);

        const meta = {
          characterId:
            oldPlan.characterId,

          characterName:
            oldSnapshot
              ? oldSnapshot.characterName
              : String(oldPlan.characterId),

          ownerName:
            oldSnapshot
              ? oldSnapshot.ownerName
              : '',
        };

        const fresh = {
          characterId:
            oldPlan.characterId,

          characterName:
            meta.characterName,

          folders,

          records:
            (data.items || [])
              .map(
                (item) =>
                  normalizeInventoryRecord(
                    item,
                    meta,
                    folderMap(folders),
                  ),
              ),
        };

        const plan =
          buildAutoOrganizePlan(
            fresh,
            {
              protectedFolderIds:
                state.protectedFolders[
                  oldPlan.characterId
                ] || [],

              typePriority:
                state.typePriority,
              itemRules: state.organizeRules[oldPlan.characterId] || {},
              itemOverrides: state.organizeOverrides[oldPlan.characterId] || {},
            },
          );

        const signature = (entry) => JSON.stringify((entry.decisions || [])
          .map((decision) => [decision.itemId, decision.target, decision.suggestion, decision.tier])
          .sort((left, right) => left[0].localeCompare(right[0])));
        const destinations = (entry) => JSON.stringify(entry.moves.map((move) =>
          [move.destination, move.folderName]).sort((left, right) => left[0].localeCompare(right[0])));
        if (signature(plan) !== signature(oldPlan)
          || destinations(plan) !== destinations(oldPlan)) {
          throw new Error('인벤토리 또는 폴더가 바뀌었습니다. 미리보기를 다시 만드세요.');
        }

        prepared.push({ plan, meta });
      } catch (error) {
        results.push(`${oldPlan.characterName || oldPlan.characterId} 확인 실패: ${
          error && error.message || '오류'}`);
      }
    }

    if (results.length) {
      state.busy = false;
      setMessage(results.join(' / '), 'error');
      renderApp();
      return;
    }

    for (const { plan, meta } of prepared) {
      try {
        for (const name of plan.createFolders) {
          await api.createFolder(
            plan.characterId,
            name,
          );
        }

        const resolvedData =
          await api.getInventory(
            plan.characterId,
          );

        const resolvedFolders =
          (resolvedData.folders || [])
            .map(normalizeFolder);

        for (const move of plan.moves) {
          const matchingFolders = resolvedFolders.filter((folder) =>
            move.destination.startsWith('new:')
              ? folder.name === move.folderName
              : String(folder.id) === move.destination && folder.name === move.folderName);
          const folderId = matchingFolders.length === 1
            ? String(matchingFolders[0].id) : '';

          if (!folderId) {
            throw new Error(
              `대상 폴더가 없거나 중복됩니다: ${move.folderName}`,
            );
          }

          await api.assignFolder(
            plan.characterId,
            move.itemIds,
            folderId,
          );
        }

        results.push(
          `${meta.characterName} 완료`,
        );
      } catch (error) {
        results.push(
          `${
            meta.characterName
          } 실패: ${
            error && error.message
            || '오류'
          }`,
        );
      }
    }

    state.busy = false;

    const resultText =
      `자동 정리 처리 결과 · ${results.join(' / ')}`;

    await refresh({
      message: resultText,
      tone:
        results.some(
          (x) => x.includes('실패'),
        )
          ? 'error'
          : 'success',
    });
  }

  function setNuiStatus(
    keys,
    status,
  ) {
    for (const key of keys) {
      if (status === 'unclassified') {
        delete state.nuiStatuses[key];
      } else {
        state.nuiStatuses[key] = status;
      }
    }

    persistSettings();
  }

  function revokePreviewBundle(preview) {
    if (!preview) return;

    const pages = Array.isArray(preview.pages)
      ? preview.pages
      : [preview];
    const urls = new Set(
      pages.map((page) => page && page.url).filter(Boolean),
    );

    urls.forEach((url) => URL.revokeObjectURL(url));
  }

  function cleanupPreview() {
    revokePreviewBundle(state.preview);
    state.preview = null;
  }

  function cleanupNuiWantedPreview() {
    revokePreviewBundle(state.nuiWantedPreview);
    state.nuiWantedPreview = null;
  }

  function movePreviewPage(delta) {
    const preview = state.view === 'nui-wanted'
      ? state.nuiWantedPreview
      : state.preview;
    if (!preview || !Array.isArray(preview.pages)) return;

    const nextIndex = Math.max(
      0,
      Math.min(preview.pages.length - 1, preview.pageIndex + delta),
    );
    if (nextIndex === preview.pageIndex) return;

    Object.assign(preview, preview.pages[nextIndex], {
      pageIndex: nextIndex,
    });
    renderApp();
  }

  function getCanvasPalette(theme) {
    return theme === 'dark'
      ? {
          background: '#11151b',
          eyebrow: '#93c5fd',
          title: '#f8fafc',
          body: '#f8fafc',
          muted: '#9aa7b7',
          divider: '#334155',
          sectionTitle: '#93c5fd',
          card: '#171c23',
          imageBackground: '#0f141a',
          missing: '#7c8998',
          missingItemName: '#cbd5e1',
          quantity: '#93c5fd',
        }
      : {
          background: '#f5f7fa',
          eyebrow: '#2563eb',
          title: '#172033',
          body: '#172033',
          muted: '#687386',
          divider: '#dbe2ea',
          sectionTitle: '#1d4ed8',
          card: '#ffffff',
          imageBackground: '#f1f5f9',
          missing: '#7c8998',
          missingItemName: '#475569',
          quantity: '#2563eb',
        };
  }

  function roundedRect(
    ctx,
    x,
    y,
    width,
    height,
    radius,
  ) {
    const r =
      Math.min(
        radius,
        width / 2,
        height / 2,
      );

    ctx.beginPath();
    ctx.moveTo(x + r, y);

    ctx.arcTo(
      x + width,
      y,
      x + width,
      y + height,
      r,
    );

    ctx.arcTo(
      x + width,
      y + height,
      x,
      y + height,
      r,
    );

    ctx.arcTo(
      x,
      y + height,
      x,
      y,
      r,
    );

    ctx.arcTo(
      x,
      y,
      x + width,
      y,
      r,
    );

    ctx.closePath();
  }

  function wrapText(
    ctx,
    text,
    maxWidth,
    maxLines = 2,
  ) {
    const source =
      String(text ?? '');

    const lines = [];
    let line = '';

    for (const character of source) {
      const next =
        line + character;

      if (
        ctx.measureText(next).width > maxWidth
        && line
      ) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }

    if (
      line
      || !lines.length
    ) {
      lines.push(line);
    }

    if (lines.length <= maxLines) {
      return lines;
    }

    const clipped =
      lines.slice(0, maxLines);

    let last =
      clipped[maxLines - 1];

    while (
      ctx.measureText(`${last}…`).width > maxWidth
      && last.length > 1
    ) {
      last =
        last.slice(0, -1);
    }

    clipped[maxLines - 1] =
      `${last}…`;

    return clipped;
  }

  function drawWrappedText(
    ctx,
    text,
    x,
    y,
    maxWidth,
    lineHeight,
    maxLines = 2,
  ) {
    const lines =
      wrapText(
        ctx,
        text,
        maxWidth,
        maxLines,
      );

    lines.forEach(
      (line, index) =>
        ctx.fillText(
          line,
          x,
          y + index * lineHeight,
        ),
    );

    return y
      + lines.length * lineHeight;
  }

  function drawContainedImage(
    ctx,
    image,
    x,
    y,
    width,
    height,
  ) {
    if (
      !image
      || !image.naturalWidth
      || !image.naturalHeight
    ) {
      return false;
    }

    const scale =
      Math.min(
        width / image.naturalWidth,
        height / image.naturalHeight,
      );

    const dw =
      image.naturalWidth * scale;

    const dh =
      image.naturalHeight * scale;

    ctx.drawImage(
      image,
      x + (width - dw) / 2,
      y + (height - dh) / 2,
      dw,
      dh,
    );

    return true;
  }

  function loadImageSafe(imageUrl) {
    if (!imageUrl) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const image = new Image();

      let settled = false;

      const finish = (value) => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer =
        setTimeout(
          () => finish(null),
          7000,
        );

      image.onload =
        () => finish(image);

      image.onerror =
        () => finish(null);

      const resolved =
        resolveImageUrl(
          imageUrl,
          origin,
        );

      if (!resolved) {
        finish(null);
        return;
      }

      image.src = resolved;
    });
  }

  async function buildPreviewImage(
    items,
    theme = state.theme,
    mode = 'trade',
    compact = false,
    pageIndex = 0,
    pageCount = 1,
    splitPages = true,
  ) {
    const palette =
      getCanvasPalette(theme);

    const tileHeight = compact
      ? CANVAS.compactTileHeight
      : CANVAS.tileHeight;

    const groups =
      groupNuiWantedImageRecords(items, true);

    const contentWidth =
      CANVAS.width
      - CANVAS.margin * 2;

    const tileWidth =
      (
        contentWidth
        - CANVAS.gap * (CANVAS.columns - 1)
      )
      / CANVAS.columns;

    const loadedImages =
      new Map();

    if (!compact) {
      await Promise.all(
        items.map(async (item) => {
          loadedImages.set(
            item.key,
            await loadImageSafe(
              item.imageUrl,
            ),
          );
        }),
      );
    }

    let height =
      CANVAS.headerHeight;

    groups.forEach((group) => {
      height +=
        CANVAS.sectionHeaderHeight
        + Math.ceil(
          group.items.length
          / CANVAS.columns,
        ) * tileHeight
        + CANVAS.sectionGap;
    });

    height =
      Math.max(height, 440);

    const maxImageHeight = splitPages
      ? CANVAS.maxImageHeight
      : CANVAS.maxUnsplitHeight;

    if (height > maxImageHeight) {
      throw new Error(
        splitPages
          ? '분할된 PNG 한 페이지가 최대 높이를 초과했습니다.'
          : '단일 PNG가 32,000px 높이 제한을 넘었습니다. 페이지 자동 분할을 켜거나 간략화 모드를 사용하세요.',
      );
    }

    const canvas =
      doc.createElement('canvas');

    canvas.width =
      CANVAS.width;

    canvas.height =
      height;

    const ctx =
      canvas.getContext('2d');

    ctx.fillStyle =
      palette.background;

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    ctx.fillStyle =
      palette.eyebrow;

    ctx.font =
      '800 16px "Noto Sans KR", sans-serif';

    ctx.fillText(
      mode === 'wanted'
        ? 'NUI WANTED LIST'
        : 'NUI TRADE LIST',
      CANVAS.margin,
      48,
    );

    ctx.fillStyle =
      palette.title;

    ctx.font =
      '900 34px "Noto Sans KR", sans-serif';

    ctx.fillText(
      mode === 'wanted'
        ? '이 누이 구해요'
        : '누이 교환 가능 목록',
      CANVAS.margin,
      88,
    );

    ctx.fillStyle =
      palette.muted;

    ctx.font =
      '500 15px "Noto Sans KR", sans-serif';

    ctx.fillText(
      `${mode === 'wanted'
        ? `생성 ${formatDate(new Date())} · 구하는 누이 ${formatNumber(items.length)}개`
        : `생성 ${formatDate(new Date())} · 누이 종류 ${groups.length}개 · 교환 가능 ${formatNumber(items.reduce((sum, item) => sum + toQuantity(item.quantity), 0))}개`
      } · 페이지 ${pageIndex + 1}/${pageCount}`,
      CANVAS.margin,
      119,
    );

    ctx.fillStyle =
      palette.divider;

    ctx.fillRect(
      CANVAS.margin,
      139,
      contentWidth,
      2,
    );

    let y =
      CANVAS.headerHeight;

    groups.forEach((group) => {
      ctx.fillStyle =
        palette.sectionTitle;

      ctx.font =
        '900 20px "Noto Sans KR", sans-serif';

      ctx.fillText(
        mode === 'wanted'
          ? `구하는 누이 · ${group.characterName}`
          : `누이 종류 · ${group.characterName}`,
        CANVAS.margin,
        y + 31,
      );

      ctx.fillStyle =
        palette.muted;

      ctx.font =
        '500 13px "Noto Sans KR", sans-serif';

      ctx.fillText(
        mode === 'wanted'
          ? `${formatNumber(group.items.length)}개`
          : `${
              group.ownerName
                ? `오너 · ${group.ownerName} · `
                : ''
            }교환 가능 ${formatNumber(group.items.reduce((sum, item) => sum + toQuantity(item.quantity), 0))}개`,
        CANVAS.margin,
        y + 55,
      );

      y +=
        CANVAS.sectionHeaderHeight;

      group.items.forEach(
        (item, index) => {
          const grade =
            gradeInfo(item.grade);

          const row =
            Math.floor(
              index / CANVAS.columns,
            );

          const column =
            index % CANVAS.columns;

          const x =
            CANVAS.margin
            + column
              * (
                tileWidth
                + CANVAS.gap
              );

          const tileY =
            y
            + row
              * tileHeight;

          if (compact) {
            ctx.fillStyle = palette.card;
            roundedRect(
              ctx,
              x,
              tileY,
              tileWidth,
              tileHeight - 14,
              10,
            );
            ctx.fill();

            ctx.strokeStyle = palette.divider;
            ctx.lineWidth = 1;
            roundedRect(
              ctx,
              x + .5,
              tileY + .5,
              tileWidth - 1,
              tileHeight - 15,
              10,
            );
            ctx.stroke();

            ctx.fillStyle = palette.muted;
            ctx.font = '700 10px "Noto Sans KR", sans-serif';
            ctx.fillText(
              getNuiTypeLabel(item),
              x + 11,
              tileY + 17,
            );

            ctx.fillStyle = palette.body;
            ctx.font = '800 12px "Noto Sans KR", sans-serif';
            drawWrappedText(
              ctx,
              item.itemName,
              x + 11,
              tileY + 37,
              tileWidth - 22,
              13,
              2,
            );

            if (mode === 'trade') {
              const holderNames = item.characterNames && item.characterNames.length
                ? item.characterNames.join(', ')
                : item.characterName;

              ctx.fillStyle = palette.muted;
              ctx.font = '600 9px "Noto Sans KR", sans-serif';
              drawWrappedText(
                ctx,
                `보유: ${holderNames}`,
                x + 11,
                tileY + 72,
                tileWidth - 70,
                10,
                1,
              );

              ctx.fillStyle = palette.quantity;
              ctx.font = '900 11px "Noto Sans KR", sans-serif';
              ctx.textAlign = 'right';
              ctx.fillText(
                `×${formatNumber(item.quantity)}`,
                x + tileWidth - 11,
                tileY + 72,
              );
              ctx.textAlign = 'left';
            }
            return;
          }

          ctx.fillStyle =
            palette.card;

          roundedRect(
            ctx,
            x,
            tileY,
            tileWidth,
            tileHeight - 14,
            14,
          );

          ctx.fill();

          ctx.save();

          ctx.strokeStyle =
            grade.color;

          ctx.globalAlpha =
            grade.key === 'ultra_rare'
              ? .9
              : .35;

          ctx.lineWidth =
            grade.key === 'ultra_rare'
              ? 2
              : 1;

          roundedRect(
            ctx,
            x + .5,
            tileY + .5,
            tileWidth - 1,
            tileHeight - 15,
            14,
          );

          ctx.stroke();
          ctx.restore();

          ctx.fillStyle =
            palette.imageBackground;

          roundedRect(
            ctx,
            x + 12,
            tileY + 12,
            tileWidth - 24,
            158,
            10,
          );

          ctx.fill();

          ctx.save();

          roundedRect(
            ctx,
            x + 12,
            tileY + 12,
            tileWidth - 24,
            158,
            10,
          );

          ctx.clip();

          if (
            !drawContainedImage(
              ctx,
              loadedImages.get(item.key),
              x + 18,
              tileY + 18,
              tileWidth - 36,
              146,
            )
          ) {
            ctx.fillStyle =
              palette.missing;

            ctx.font =
              '600 12px "Noto Sans KR", sans-serif';

            ctx.textAlign =
              'center';

            ctx.fillText(
              '이미지 없음',
              x + tileWidth / 2,
              tileY + 82,
            );

            ctx.fillStyle =
              palette.missingItemName;

            ctx.font =
              '500 10px "Noto Sans KR", sans-serif';

            drawWrappedText(
              ctx,
              item.itemName,
              x + tileWidth / 2,
              tileY + 106,
              tileWidth - 54,
              13,
              2,
            );

            ctx.textAlign =
              'left';
          }

          ctx.restore();

          ctx.fillStyle =
            grade.color;

          ctx.globalAlpha =
            .75;

          roundedRect(
            ctx,
            x + 12,
            tileY + 12,
            4,
            158,
            2,
          );

          ctx.fill();

          ctx.globalAlpha =
            1;

          ctx.fillStyle =
            palette.muted;

          ctx.font =
            '600 11px "Noto Sans KR", sans-serif';

          const holderNames = item.characterNames && item.characterNames.length
            ? item.characterNames.join(', ')
            : item.characterName;
          const metadataY = drawWrappedText(
            ctx,
            mode === 'wanted' ? '구함' : `보유: ${holderNames}`,
            x + 14,
            tileY + 190,
            tileWidth - 28,
            12,
            2,
          );

          drawWrappedText(
            ctx,
            mode === 'wanted'
              ? `분류: ${item.folderName}`
              : `폴더: ${item.folderName}`,
            x + 14,
            metadataY + 3,
            tileWidth - 28,
            12,
            1,
          );

          ctx.fillStyle =
            grade.color;

          ctx.font =
            '700 11px "Noto Sans KR", sans-serif';

          ctx.fillText(
            grade.label,
            x + 14,
            metadataY + 21,
          );

          ctx.fillStyle =
            palette.body;

          ctx.font =
            '800 14px "Noto Sans KR", sans-serif';

          drawWrappedText(
            ctx,
            item.itemName,
            x + 14,
            metadataY + 42,
            tileWidth - 88,
            16,
            2,
          );

          ctx.fillStyle =
            palette.quantity;

          ctx.font =
            '900 15px "Noto Sans KR", sans-serif';

          ctx.textAlign =
            'right';

          ctx.fillText(
            mode === 'wanted'
              ? '구해요'
              : `×${formatNumber(item.quantity)}`,
            x + tileWidth - 14,
            metadataY + 70,
          );

          ctx.textAlign =
            'left';
        },
      );

      y +=
        Math.ceil(
          group.items.length
          / CANVAS.columns,
        )
        * tileHeight
        + CANVAS.sectionGap;
    });

    const blob =
      await new Promise(
        (resolve) =>
          canvas.toBlob(
            resolve,
            'image/png',
          ),
      );

    if (!blob) {
      throw new Error(
        'PNG 이미지를 생성하지 못했습니다.',
      );
    }

    return {
      blob,
      url: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
    };
  }

  async function buildPreviewPages(
    items,
    theme,
    mode,
    compact,
    splitPages,
  ) {
    const orderedItems = sortNuiImageItems(items);
    const itemPages = paginateNuiImageItems(
      orderedItems,
      mode,
      compact,
      CANVAS,
      splitPages,
    );
    const pages = [];

    try {
      for (let index = 0; index < itemPages.length; index += 1) {
        pages.push(
          await buildPreviewImage(
            itemPages[index],
            theme,
            mode,
            compact,
            index,
            itemPages.length,
            splitPages,
          ),
        );
      }
    } catch (error) {
      revokePreviewBundle({ pages });
      throw error;
    }

    if (!pages.length) {
      throw new Error('이미지에 넣을 누이 항목이 없습니다.');
    }

    return {
      pages,
      pageIndex: 0,
      compact: Boolean(compact),
      ...pages[0],
    };
  }

  async function downloadPreviewPagesAsZip(preview, baseName) {
    if (!preview || !preview.pages || !preview.pages.length || state.busy) return;

    state.busy = true;
    setMessage('전체 페이지 ZIP을 준비하는 중입니다.');
    renderApp();

    try {
      const date = new Date().toISOString().slice(0, 10);
      const total = String(preview.pages.length).padStart(2, '0');
      const entries = [];

      for (let index = 0; index < preview.pages.length; index += 1) {
        const pageNumber = String(index + 1).padStart(2, '0');
        const bytes = await preview.pages[index].blob.arrayBuffer();
        entries.push({
          name: `${baseName}-${date}-page-${pageNumber}-of-${total}.png`,
          data: new Uint8Array(bytes),
        });
      }

      const zipBytes = buildStoredZipBytes(entries);
      const zipUrl = URL.createObjectURL(
        new Blob([zipBytes], { type: 'application/zip' }),
      );
      const link = doc.createElement('a');
      link.href = zipUrl;
      link.download = `${baseName}-${date}-all-pages.zip`;
      doc.body.appendChild(link);
      link.click();
      link.remove();
      win.setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);
      setMessage(`${preview.pages.length}개 PNG를 ZIP으로 저장합니다.`, 'success');
    } catch (error) {
      setMessage(
        `일괄 저장 실패: ${error && error.message || '오류'}`,
        'error',
      );
    } finally {
      state.busy = false;
      renderApp();
    }
  }

  function downloadPreviewPagesIndividually(preview, baseName) {
    if (
      !canDownloadAllNuiPages(preview, state.nuiAutoPaginate)
      || state.busy
    ) return;

    const date = new Date().toISOString().slice(0, 10);
    const total = preview.pages.length;

    preview.pages.forEach((page, index) => {
      const link = doc.createElement('a');
      link.href = page.url;
      link.download = getNuiPageFilename(baseName, date, index, total);
      doc.body.appendChild(link);
      link.click();
      link.remove();
    });

    setMessage(`${total}개 PNG 개별 저장을 시작했습니다.`, 'success');
    renderApp();
  }

  function downloadAllPreviewPages(preview, baseName) {
    if (!canDownloadAllNuiPages(preview, state.nuiAutoPaginate)) return;

    if (state.nuiDownloadMode === 'zip') {
      downloadPreviewPagesAsZip(preview, baseName);
    } else {
      downloadPreviewPagesIndividually(preview, baseName);
    }
  }

  async function makeNuiImage() {
    const available = sortNuiImageItems(
      getNuiTradeImageItems(currentNuiRecords()),
    );

    if (!available.length || state.busy) return;

    cleanupPreview();

    state.busy = true;

    setMessage(
      'PNG 미리보기를 만드는 중입니다.',
    );

    renderApp();

    try {
      state.preview = await buildPreviewPages(
        available,
        state.theme,
        'trade',
        state.nuiCompactMode,
        state.nuiAutoPaginate,
      );

      state.busy = false;
      setMessage(null);
      renderApp();
    } catch (error) {
      state.busy = false;

      setMessage(
        `PNG 생성 실패: ${
          error && error.message
          || '오류'
        }`,
        'error',
      );

      renderApp();
    }
  }

  async function makeNuiWantedImage() {
    const selected = selectedNuiWantedCards();
    if (!selected.length || state.busy) return;

    cleanupPreview();
    cleanupNuiWantedPreview();
    state.busy = true;

    setMessage(
      '구해요 PNG 미리보기를 만드는 중입니다.',
    );

    renderApp();

    try {
      state.nuiWantedPreview = await buildPreviewPages(
        toNuiWantedImageRecords(selected),
        state.theme,
        'wanted',
        state.nuiCompactMode,
        state.nuiAutoPaginate,
      );

      state.busy = false;
      setMessage(null);
      renderApp();
    } catch (error) {
      state.busy = false;

      setMessage(
        `구해요 PNG 생성 실패: ${
          error && error.message
          || '오류'
        }`,
        'error',
      );

      renderApp();
    }
  }

  function closeApp() {
    state.open = false;
    overlay.hidden = true;
    state.dialog = null;

    doc.documentElement.style.overflow =
      '';

    cleanupPreview();
    cleanupNuiWantedPreview();
  }

  function openApp() {
    state.open = true;
    overlay.hidden = false;

    doc.documentElement.style.overflow =
      'hidden';

    renderApp();

    if (
      !state.snapshots.length
      && !state.loading
    ) {
      refresh();
    }
  }

  function dialogValue(name) {
    const input =
      overlay.querySelector(
        `[data-dialog-input="${name}"]`,
      );

    return input
      ? input.value
      : '';
  }

  function closeOpenDetails(target) {
    const details =
      target.closest('details');

    if (details && !details.dataset.planGroup) {
      details.removeAttribute('open');
    }
  }

  async function handleClick(event) {
    const target =
      event.target.closest(
        '[data-action],[data-view]',
      );

    if (
      !target
      || !overlay.contains(target)
    ) {
      return;
    }

    if (target.dataset.view) {
      state.view =
        target.dataset.view;

      state.dialog =
        null;

      setMessage(null);
      renderApp();
      if (state.view === 'nui-wanted' && !wantedCatalogRequested) {
        refreshNuiWantedCatalog();
      }
      return;
    }

    const action =
      target.dataset.action;

    if (!action) return;

    closeOpenDetails(target);

    if (action === 'close') {
      closeApp();
      return;
    }

    if (action === 'refresh') {
      refresh();
      return;
    }

    if (action === 'refresh-nui-wanted-catalog') {
      refreshNuiWantedCatalog();
      return;
    }

    if (action === 'toggle-theme') {
      state.theme =
        state.theme === 'dark'
          ? 'light'
          : 'dark';

      root.dataset.theme =
        state.theme;

      persistSettings();
      renderApp();
      return;
    }

    if (action === 'close-dialog') {
      state.dialog = null;
      renderApp();
      return;
    }

    if (action === 'clear-inventory-selection') {
      state.selectedKeys.clear();
      renderApp();
      return;
    }

    if (action === 'toggle-inventory-select') {
      const key =
        decodeKey(
          target.dataset.key,
        );

      if (target.checked) {
        state.selectedKeys.add(key);
      } else {
        state.selectedKeys.delete(key);
      }

      renderApp();
      return;
    }

    if (action === 'select-visible-inventory') {
      const visible =
        sortInventory(
          filterInventory(
            allRecords(),
            {
              ...state.filters,
              query: state.query,
            },
          ),
          state.sort,
        );

      if (target.checked) {
        visible.forEach(
          (item) =>
            state.selectedKeys.add(item.key),
        );
      } else {
        visible.forEach(
          (item) =>
            state.selectedKeys.delete(item.key),
        );
      }

      renderApp();
      return;
    }

    if (action === 'move-item') {
      state.dialog = {
        type: 'move-item',
        key: decodeKey(target.dataset.key),
      };

      renderApp();
      return;
    }

    if (action === 'discard-item') {
      state.dialog = {
        type: 'discard-item',
        key: decodeKey(target.dataset.key),
      };

      renderApp();
      return;
    }

    if (action === 'use-item') {
      state.dialog = {
        type: 'use-item',
        key: decodeKey(target.dataset.key),
      };

      renderApp();
      return;
    }

    if (action === 'bulk-move') {
      state.dialog = {
        type: 'bulk-move',
      };

      renderApp();
      return;
    }

    if (action === 'bulk-discard') {
      state.dialog = {
        type: 'bulk-discard',
      };

      renderApp();
      return;
    }

    if (action === 'open-folder-manager') {
      state.dialog = {
        type: 'folder-manager',
        characterId:
          target.dataset.character,
      };

      renderApp();
      return;
    }

    if (action === 'rename-folder') {
      state.dialog = {
        type: 'rename-folder',
        characterId:
          state.dialog.characterId,
        folderId:
          target.dataset.folder,
      };

      renderApp();
      return;
    }

    if (action === 'delete-folder') {
      state.dialog = {
        type: 'delete-folder',
        characterId:
          state.dialog.characterId,
        folderId:
          target.dataset.folder,
      };

      renderApp();
      return;
    }

    if (action === 'back-folder-manager') {
      state.dialog = {
        type: 'folder-manager',
        characterId:
          state.dialog.characterId,
      };

      renderApp();
      return;
    }

    if (action === 'open-item-order') {
      state.dialog = {
        type: 'item-order',
        characterId:
          state.dialog.characterId,
      };

      renderApp();
      return;
    }

    if (action === 'add-folder') {
      const charId =
        state.dialog.characterId;

      const name =
        normalizeItemName(
          dialogValue('new-folder-name'),
        );

      if (!name) return;

      runMutation(
        `폴더 “${name}” 추가`,
        () =>
          api.createFolder(
            charId,
            name,
          ),
      );

      return;
    }

    if (action === 'toggle-folder-hidden') {
      const charId =
        state.dialog.characterId;

      const snapshot =
        snapshotFor(charId);

      const folder =
        snapshot
        && snapshot.folders.find(
          (f) =>
            String(f.id)
            === String(target.dataset.folder),
        );

      if (!folder) return;

      runMutation(
        `폴더 “${folder.name}” ${
          folder.isHidden
            ? '표시'
            : '숨김'
        }`,
        () =>
          api.manageFolder(
            'toggle_hidden',
            {
              id: folder.id,
              hidden:
                folder.isHidden
                  ? 0
                  : 1,
            },
          ),
      );

      return;
    }

    if (action === 'submit-move-item') {
      const item =
        recordFor(state.dialog.key);

      const folderId =
        dialogValue('folder-id');

      if (item) {
        runMutation(
          '아이템 폴더 이동',
          () =>
            api.assignFolder(
              item.characterId,
              [item.itemId],
              folderId,
            ),
        );
      }

      return;
    }

    if (action === 'submit-discard-item') {
      const item =
        recordFor(state.dialog.key);

      const quantity =
        Number(
          dialogValue('quantity'),
        );

      if (
        !item
        || !Number.isInteger(quantity)
        || quantity < 1
        || quantity > item.quantity
      ) {
        setMessage(
          '버릴 수량을 확인하세요.',
          'error',
        );

        renderApp();
        return;
      }

      runMutation(
        `아이템 ${formatNumber(quantity)}개 버리기`,
        () =>
          api.discardItems(
            item.characterId,
            [item.itemId],
            [quantity],
          ),
      );

      return;
    }

    if (action === 'submit-use-item') {
      const item =
        recordFor(state.dialog.key);

      if (!item) return;

      const fields = {
        char_id: item.characterId,
        item_id: item.itemId,
      };

      if (
        [
          'select',
          'enc_slot',
          'member_slot',
        ].includes(item.boxType)
      ) {
        const selected =
          dialogValue('sel-idx');

        if (selected === '') {
          setMessage(
            '선택지 번호를 입력하세요.',
            'error',
          );

          renderApp();
          return;
        }

        fields.sel_idx =
          selected;
      }

      runMutation(
        '아이템 사용',
        () => api.useItem(fields),
      );

      return;
    }

    if (action === 'submit-rename-folder') {
      const {
        folderId,
      } = state.dialog;

      const name =
        normalizeItemName(
          dialogValue('folder-name'),
        );

      if (!name) return;

      runMutation(
        '폴더 이름 변경',
        () =>
          api.manageFolder(
            'rename',
            {
              id: folderId,
              name,
            },
          ),
      );

      return;
    }

    if (action === 'submit-delete-folder') {
      const {
        folderId,
      } = state.dialog;

      runMutation(
        '폴더 삭제',
        () =>
          api.manageFolder(
            'delete',
            {
              id: folderId,
            },
          ),
      );

      return;
    }

    if (action === 'save-folder-order') {
      const charId =
        state.dialog.characterId;

      const list =
        overlay.querySelector(
          '[data-folder-order]',
        );

      const order =
        list
          ? Array.from(
              list.querySelectorAll(
                '[data-folder-id]',
              ),
            ).map(
              (node) =>
                node.dataset.folderId,
            )
          : [];

      if (order.length) {
        runMutation(
          '폴더 순서 저장',
          () =>
            api.manageFolder(
              'reorder',
              {
                char_id: charId,
                order,
              },
            ),
        );
      }

      return;
    }

    if (action === 'save-item-order') {
      const charId =
        state.dialog.characterId;

      const list =
        overlay.querySelector(
          '[data-item-order]',
        );

      const order =
        list
          ? Array.from(
              list.querySelectorAll(
                '[data-item-id]',
              ),
            ).map(
              (node) =>
                node.dataset.itemId,
            )
          : [];

      if (order.length) {
        runMutation(
          '아이템 순서 저장',
          () =>
            api.reorderItems(
              charId,
              order,
            ),
        );
      }

      return;
    }

    if (action === 'submit-bulk-move') {
      const groups =
        groupRecordsByCharacter(
          selectedRecords(),
        );

      const operations =
        groups.map(
          ([charId, items]) => {
            const select =
              overlay.querySelector(
                `[data-bulk-folder="${CSS.escape(charId)}"]`,
              );

            const folderId =
              select
                ? select.value
                : '0';

            return () =>
              api.assignFolder(
                charId,
                items.map(
                  (i) => i.itemId,
                ),
                folderId,
              );
          },
        );

      runMutation(
        `${formatNumber(state.selectedKeys.size)}개 아이템 폴더 이동`,
        async () => {
          for (const operation of operations) {
            await operation();
          }
        },
      );

      return;
    }

    if (action === 'submit-bulk-discard') {
      if (
        normalizeItemName(
          dialogValue('literal'),
        ) !== '버리기'
      ) {
        setMessage(
          '계속하려면 “버리기”를 정확히 입력하세요.',
          'error',
        );

        renderApp();
        return;
      }

      const groups =
        groupRecordsByCharacter(
          selectedRecords(),
        );

      runMutation(
        `${formatNumber(state.selectedKeys.size)}개 항목 버리기`,
        async () => {
          for (
            const [charId, items]
            of groups
          ) {
            await api.discardItems(
              charId,
              items.map(
                (i) => i.itemId,
              ),
              items.map(
                (i) => i.quantity,
              ),
            );
          }
        },
      );

      return;
    }

    if (action === 'accept-organize-suggestions') {
      const charId = target.dataset.character;
      const destination = target.dataset.destination;
      const plan = (state.organizePlans || []).find((entry) => entry.characterId === charId);
      if (!plan) return;
      state.organizeOverrides[charId] = state.organizeOverrides[charId] || {};
      plan.decisions.filter((decision) =>
        decision.tier === 'review' && decision.suggestion === destination)
        .forEach((decision) => {
          state.organizeOverrides[charId][decision.itemId] = destination;
        });
      planOrganize();
      return;
    }

    if (action === 'plan-organize') {
      planOrganize();
      return;
    }

    if (action === 'apply-organize') {
      state.dialog = {
        type: 'apply-organize',
      };

      renderApp();
      return;
    }

    if (action === 'confirm-apply-organize') {
      applyOrganize();
      return;
    }

    if (action === 'toggle-protected-folder') {
      const charId =
        target.dataset.character;

      const folderId =
        target.dataset.folder;

      const set =
        new Set(
          state.protectedFolders[charId]
          || [],
        );

      if (target.checked) {
        set.add(folderId);
      } else {
        set.delete(folderId);
      }

      state.protectedFolders[charId] =
        [...set];

      state.organizePlans =
        null;

      persistSettings();
      renderApp();
      return;
    }

    if (action === 'toggle-nui-select') {
      const key =
        decodeKey(target.dataset.key);

      if (target.checked) {
        state.nuiSelected.add(key);
      } else {
        state.nuiSelected.delete(key);
      }

      renderApp();
      return;
    }

    if (action === 'toggle-nui-wanted-select') {
      const key = decodeKey(target.dataset.key);

      if (target.checked) {
        state.nuiWantedSelected.add(key);
      } else {
        state.nuiWantedSelected.delete(key);
      }

      persistSettings();
      renderApp();
      return;
    }

    if (action === 'select-visible-nui-wanted') {
      visibleNuiWantedCards().forEach((item) => {
        state.nuiWantedSelected.add(item.key);
      });

      persistSettings();
      renderApp();
      return;
    }

    if (action === 'clear-nui-wanted-selection') {
      state.nuiWantedSelected.clear();
      persistSettings();
      renderApp();
      return;
    }

    if (action === 'select-visible-nui') {
      visibleNuiRecords()
        .forEach(
          (item) =>
            state.nuiSelected.add(item.key),
        );

      renderApp();
      return;
    }

    if (action === 'clear-nui-selection') {
      state.nuiSelected.clear();
      renderApp();
      return;
    }

    if (action === 'toggle-nui-duplicate-mode') {
      state.nuiDuplicateMode = !state.nuiDuplicateMode;
      persistSettings();
      if (state.nuiDuplicateMode) {
        const records = currentNuiRecords();
        const copies = records.reduce((sum, item) => sum + item.tradeQuantity, 0);
        setMessage(`중복 자동 설정 적용 · 전체 캐릭터에서 1개씩 보관 · 교환 가능 ${formatNumber(copies)}개`, 'success');
      } else {
        setMessage('중복 자동 설정을 해제했습니다.', 'info');
      }
      renderApp();
      return;
    }

    if (action === 'toggle-nui-star') {
      const record = allRecords().find((item) => item.key === decodeKey(target.dataset.key));
      if (!record) return;
      const key = nuiDuplicateKey(record);
      if (state.nuiStarred.has(key)) state.nuiStarred.delete(key);
      else state.nuiStarred.add(key);
      persistSettings();
      renderApp();
      return;
    }

    if (action === 'set-nui-status') {
      setNuiStatus(
        [
          decodeKey(
            target.dataset.key,
          ),
        ],
        target.dataset.status,
      );

      renderApp();
      return;
    }

    if (action === 'mark-nui') {
      setNuiStatus(
        [...state.nuiSelected],
        target.dataset.status,
      );

      state.nuiSelected.clear();

      renderApp();
      return;
    }

    if (action === 'make-nui-image') {
      makeNuiImage();
      return;
    }

    if (action === 'make-nui-wanted-image') {
      makeNuiWantedImage();
      return;
    }

    if (action === 'previous-preview-page') {
      movePreviewPage(-1);
      return;
    }

    if (action === 'next-preview-page') {
      movePreviewPage(1);
      return;
    }

    if (action === 'close-preview') {
      cleanupPreview();
      renderApp();
      return;
    }

    if (action === 'rebuild-preview') {
      cleanupPreview();
      makeNuiImage();
      return;
    }

    if (action === 'download-preview') {
      if (!state.preview) return;

      const link =
        doc.createElement('a');

      link.href =
        state.preview.url;

      link.download = getNuiPageFilename(
        'nui-trade-list',
        new Date().toISOString().slice(0, 10),
        state.preview.pageIndex,
        state.preview.pages.length,
      );

      doc.body.appendChild(link);
      link.click();
      link.remove();

      return;
    }

    if (action === 'download-all-preview-pages') {
      downloadAllPreviewPages(state.preview, 'nui-trade-list');
      return;
    }

    if (action === 'close-nui-wanted-preview') {
      cleanupNuiWantedPreview();
      renderApp();
      return;
    }

    if (action === 'rebuild-nui-wanted-preview') {
      cleanupNuiWantedPreview();
      makeNuiWantedImage();
      return;
    }

    if (action === 'download-nui-wanted-preview') {
      if (!state.nuiWantedPreview) return;

      const link = doc.createElement('a');
      link.href = state.nuiWantedPreview.url;
      link.download = getNuiPageFilename(
        'nui-wanted-list',
        new Date().toISOString().slice(0, 10),
        state.nuiWantedPreview.pageIndex,
        state.nuiWantedPreview.pages.length,
      );
      doc.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    if (action === 'download-all-nui-wanted-pages') {
      downloadAllPreviewPages(state.nuiWantedPreview, 'nui-wanted-list');
      return;
    }
  }

  // 한글 IME 등 조합 입력 중에는 DOM을 갈아끼우는 순간 조합이 끊겨
  // 자모가 따로 들어갑니다. 조합 중에는 목록 영역만 갱신합니다.
  function inputKeyOf(target) {
    return target
      && target.dataset
      ? target.dataset.input || ''
      : '';
  }

  function applyInputValue(target) {
    const key =
      inputKeyOf(target);

    if (key === 'inventory-query') {
      state.query =
        target.value;
    } else if (key === 'type-priority') {
      state.typePriority =
        target.value
          .split(',')
          .map(normalizeItemName)
          .filter(Boolean);

      state.organizePlans =
        null;

      persistSettings();
    } else if (key === 'nui-query') {
      state.nuiQuery =
        target.value;
    } else if (key === 'nui-wanted-query') {
      state.nuiWantedQuery =
        target.value;
    } else {
      return false;
    }

    return true;
  }

  function refreshRegion(name, render) {
    const host =
      overlay.querySelector(
        `[data-region="${name}"]`,
      );

    if (!host) return;

    host.innerHTML = render();
  }

  function refreshInputRegion(target) {
    const key =
      inputKeyOf(target);

    if (key === 'inventory-query') {
      refreshRegion('inventory-results', renderInventoryResults);
    } else if (key === 'nui-query') {
      refreshRegion('nui-results', renderNuiResults);
    } else if (key === 'nui-wanted-query') {
      refreshRegion('nui-wanted-results', renderNuiWantedResults);
    }
  }

  function scheduleComposingSettle() {
    if (composingSettleTimer) return;

    composingSettleTimer =
      win.setTimeout(
        () => {
          composingSettleTimer = 0;
          renderApp();
        },
        0,
      );
  }

  function handleInput(event) {
    const target =
      event.target;

    if (
      !target
      || !applyInputValue(target)
    ) {
      return;
    }

    if (
      event.isComposing
      || composingField === target
    ) {
      refreshInputRegion(target);

      return;
    }

    renderApp();
  }

  function handleChange(event) {
    const target =
      event.target;

    if (
      !target
      || !target.dataset.input
    ) {
      return;
    }

    if (target.dataset.input === 'organize-destination'
      || target.dataset.input === 'organize-remember') {
      const charId = target.dataset.character;
      const plan = (state.organizePlans || []).find((entry) => entry.characterId === charId);
      const decision = plan && plan.decisions.find((entry) => entry.itemId === target.dataset.item);
      if (!decision) return;
      state.organizeRules[charId] = state.organizeRules[charId] || {};
      state.organizeOverrides[charId] = state.organizeOverrides[charId] || {};
      const key = normalizeItemName(decision.itemName).toLocaleLowerCase('ko');
      if (target.dataset.input === 'organize-destination') {
        if (target.value === 'auto') {
          delete state.organizeOverrides[charId][decision.itemId];
          delete state.organizeRules[charId][key];
        } else {
          state.organizeOverrides[charId][decision.itemId] = target.value;
        }
      } else {
        const value = decision.target || 'skip';
        if (target.checked) state.organizeRules[charId][key] = value;
        else {
          delete state.organizeRules[charId][key];
          state.organizeOverrides[charId][decision.itemId] = value;
        }
      }
      persistSettings();
      planOrganize();
      return;
    }

    if (
      target.dataset.input
      === 'filter-character'
    ) {
      state.filters.characterId =
        target.value;

      state.filters.folderId =
        'all';
    } else if (
      target.dataset.input === 'nui-compact-mode'
    ) {
      state.nuiCompactMode = Boolean(target.checked);
      persistSettings();

      if (state.preview) {
        makeNuiImage();
      } else if (state.nuiWantedPreview) {
        makeNuiWantedImage();
      } else {
        renderApp();
      }
      return;
    } else if (
      target.dataset.input === 'nui-auto-paginate'
    ) {
      state.nuiAutoPaginate = Boolean(target.checked);
      persistSettings();

      if (state.preview) {
        makeNuiImage();
      } else if (state.nuiWantedPreview) {
        makeNuiWantedImage();
      } else {
        renderApp();
      }
      return;
    } else if (
      target.dataset.input === 'nui-page-save-mode'
    ) {
      state.nuiPageSaveEnabled = Boolean(target.checked);
      persistSettings();
      renderApp();
      return;
    } else if (
      target.dataset.input === 'nui-download-mode'
    ) {
      state.nuiDownloadMode = normalizeNuiDownloadMode(target.value);
      persistSettings();
      renderApp();
      return;
    } else if (
      target.dataset.input
      === 'filter-folder'
    ) {
      state.filters.folderId =
        target.value;
    } else if (
      target.dataset.input
      === 'filter-type'
    ) {
      state.filters.type =
        target.value;
    } else if (
      target.dataset.input
      === 'filter-grade'
    ) {
      state.filters.grade =
        target.value;
    } else if (
      target.dataset.input
      === 'sort'
    ) {
      state.sort =
        target.value;
    } else if (
      target.dataset.input
      === 'nui-filter'
    ) {
      state.nuiFilter =
        target.value;
    } else if (
      target.dataset.input
      === 'nui-wanted-category'
    ) {
      state.nuiWantedCategory =
        target.value;
    } else {
      return;
    }

    renderApp();
  }

  let dragNode = null;

  function handleDragStart(event) {
    const row =
      event.target.closest(
        '[data-folder-id],[data-item-id]',
      );

    if (!row) return;

    dragNode = row;

    row.classList.add(
      'is-dragging',
    );

    event.dataTransfer.effectAllowed =
      'move';
  }

  function handleDragEnd() {
    if (dragNode) {
      dragNode.classList.remove(
        'is-dragging',
      );
    }

    dragNode = null;
  }

  function handleDragOver(event) {
    const container =
      event.target.closest(
        '[data-folder-order],[data-item-order]',
      );

    if (
      !container
      || !dragNode
      || !container.contains(dragNode)
    ) {
      return;
    }

    event.preventDefault();

    const target =
      event.target.closest(
        '[data-folder-id],[data-item-id]',
      );

    if (
      target
      && target !== dragNode
      && target.parentElement === container
    ) {
      const rect =
        target.getBoundingClientRect();

      container.insertBefore(
        dragNode,
        event.clientY
          < rect.top + rect.height / 2
          ? target
          : target.nextSibling,
      );
    }
  }

  const LAUNCH_GAP = 22;
  const LAUNCH_MAX_LIFT = 200;

  function setLauncherLift(px) {
    launch.style.setProperty(
      '--im2-launch-lift',
      `${Math.round(px)}px`,
    );
  }

  function launcherCovered() {
    const rect =
      launch.getBoundingClientRect();

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    if (
      !rect.width
      || !rect.height
      || x < 0
      || y < 0
      || x > win.innerWidth
      || y > win.innerHeight
    ) {
      return false;
    }

    let hit = null;

    try {
      hit = doc.elementFromPoint(x, y);
    } catch (_) {
      return false;
    }

    return Boolean(
      hit
      && hit !== launch
      && !launch.contains(hit),
    );
  }

  // iOS Safari anchors fixed elements to the layout viewport, which
  // keeps reaching underneath the bottom toolbar, so a plain
  // "bottom:22px" button ends up buried under Safari's own UI.
  // Measure where the launcher really landed and lift it back into
  // the part of the page the user can see and tap.
  function syncLauncherLift() {
    const vv = win.visualViewport;

    if (!launch.isConnected || !vv) {
      return;
    }

    const visibleBottom =
      vv.offsetTop + vv.height;

    let lift = 0;

    setLauncherLift(lift);

    for (let pass = 0; pass < 3; pass += 1) {
      const overflow =
        launch.getBoundingClientRect().bottom
        - (visibleBottom - LAUNCH_GAP);

      if (overflow <= 0) break;

      lift = Math.min(
        LAUNCH_MAX_LIFT,
        lift + overflow,
      );

      setLauncherLift(lift);
    }

    if (state.open) return;

    // Some pages park their own fixed bars right where the
    // launcher sits, so keep stepping up until it is tappable.
    let guard = 0;

    while (
      guard < 6
      && lift < LAUNCH_MAX_LIFT
      && launcherCovered()
    ) {
      lift = Math.min(
        LAUNCH_MAX_LIFT,
        lift + 16,
      );

      setLauncherLift(lift);
      guard += 1;
    }
  }

  let launcherViewportKey = '';

  function syncLauncherLiftSoon() {
    const vv = win.visualViewport;

    const key = vv
      ? [
          Math.round(vv.width),
          Math.round(vv.height),
          Math.round(vv.offsetTop),
          Math.round(vv.scale * 100),
        ].join(':')
      : [
          win.innerWidth,
          win.innerHeight,
        ].join(':');

    if (key === launcherViewportKey) return;

    launcherViewportKey = key;
    syncLauncherLift();
  }

  syncLauncherLift();

  win.addEventListener(
    'resize',
    syncLauncherLiftSoon,
  );

  win.addEventListener(
    'orientationchange',
    syncLauncherLiftSoon,
  );

  win.addEventListener(
    'scroll',
    syncLauncherLiftSoon,
    { passive: true },
  );

  if (win.visualViewport) {
    win.visualViewport.addEventListener(
      'resize',
      syncLauncherLiftSoon,
    );

    win.visualViewport.addEventListener(
      'scroll',
      syncLauncherLiftSoon,
    );
  }

  launch.addEventListener(
    'click',
    openApp,
  );

  overlay.addEventListener(
    'click',
    (event) => {
      if (event.target === overlay) {
        closeApp();
      } else {
        handleClick(event);
      }
    },
  );

  overlay.addEventListener(
    'input',
    handleInput,
  );

  overlay.addEventListener(
    'compositionstart',
    (event) => {
      const target =
        event.target;

      if (
        target
        && (
          target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
        )
      ) {
        composingField = target;
      }
    },
    true,
  );

  overlay.addEventListener(
    'compositionend',
    (event) => {
      const target =
        event.target;

      if (target === composingField) {
        composingField = null;
      }

      if (applyInputValue(target)) {
        refreshInputRegion(target);
      }

      if (composingRenderPending) {
        composingRenderPending = false;
        scheduleComposingSettle();
      }
    },
    true,
  );

  overlay.addEventListener(
    'focusout',
    (event) => {
      if (event.target !== composingField) return;

      composingField = null;

      if (composingRenderPending) {
        composingRenderPending = false;
        scheduleComposingSettle();
      }
    },
    true,
  );

  overlay.addEventListener(
    'change',
    handleChange,
  );

  overlay.addEventListener(
    'dragstart',
    handleDragStart,
  );

  overlay.addEventListener(
    'dragend',
    handleDragEnd,
  );

  overlay.addEventListener(
    'dragover',
    handleDragOver,
  );

  win.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape'
        && state.open
      ) {
        if (state.dialog) {
          state.dialog = null;
          renderApp();
        } else {
          closeApp();
        }
      }
    },
  );
})();
