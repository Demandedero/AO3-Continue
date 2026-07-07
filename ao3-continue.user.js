// ==UserScript==
// @name         AO3 Continue
// @namespace    https://github.com/Demandedero/AO3-Continue
// @version      2.4.1
// @description  AO3 自动记录阅读章节；作品页继续到下一章；搜索/列表页显示已读进度；单浮窗；长按导入导出；浮窗可拖动并记住位置。
// @match        https://archiveofourown.org/*
// @match        https://www.archiveofourown.org/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Demandedero/AO3-Continue/main/ao3-continue.user.js
// @downloadURL  https://raw.githubusercontent.com/Demandedero/AO3-Continue/main/ao3-continue.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PREFIX = 'ao3_continue_progress_';
    const AUTO_JUMP = false; // 想自动跳转就改成 true
  const LONG_PRESS_MS = 550;
  const DRAG_THRESHOLD = 8;

  addStyle();

  const workId = getWorkId(location.href);

  if (workId && location.pathname.includes('/works/')) {
    handleWorkPage(workId);
  }

  markListProgress();

  function handleWorkPage(workId) {
    const chapters = getChapters(workId);
    if (!chapters.length) return;

    const current = getCurrentChapter(chapters);
    let saved = load(workId);

    if (current && (!saved || current.index > saved.lastIndex)) {
      saved = {
        workId,
        title: document.querySelector('h2.title')?.textContent.trim() || document.title,
        lastIndex: current.index,
        lastChapterId: current.id,
        total: chapters.length,
        updatedAt: new Date().toISOString()
      };
      save(workId, saved);
    }

    saved = load(workId);
    makeMiniPanel(workId, chapters, saved, current);

    if (saved) {
      const next = chapters[saved.lastIndex];

      if (next) {
        const shouldOffer =
          !current ||
          current.index < saved.lastIndex ||
          current.index > saved.lastIndex + 1 ||
          /^\/works\/\d+\/?$/.test(location.pathname);

        if (shouldOffer) {
          showContinueNotice(saved, next, chapters.length);
        }
      }
    }
  }

  function getChapters(workId) {
    const select =
      document.querySelector('select#selected_id') ||
      document.querySelector('select[name="selected_id"]');

    if (!select) return [];

    return [...select.options].map((opt, i) => {
      const id = String(opt.value).match(/\d+/)?.[0];
      if (!id) return null;
      return {
        index: i + 1,
        id,
        title: opt.textContent.trim(),
        url: `/works/${workId}/chapters/${id}`
      };
    }).filter(Boolean);
  }

  function getCurrentChapter(chapters) {
    const id = location.pathname.match(/\/chapters\/(\d+)/)?.[1];
    if (!id) return null;
    return chapters.find(c => c.id === id) || null;
  }

  function showContinueNotice(saved, next, total) {
    const box = document.createElement('div');
    box.className = 'ao3ac-notice';
    box.innerHTML = `
      <b>AO3 阅读进度</b><br>
      上次读到第 ${saved.lastIndex} / ${total} 章<br>
      继续到第 ${next.index} 章？
      <div class="ao3ac-row">
        <button id="ao3ac-jump">跳转</button>
        <button id="ao3ac-no">不跳</button>
      </div>
    `;
    document.body.appendChild(box);

    box.querySelector('#ao3ac-jump').onclick = () => location.href = next.url;
    box.querySelector('#ao3ac-no').onclick = () => box.remove();

    if (AUTO_JUMP) {
      setTimeout(() => {
        if (document.body.contains(box)) location.href = next.url;
      }, 1200);
    }
  }

  function makeMiniPanel(workId, chapters, saved, current) {
    if (document.querySelector('.ao3ac-panel')) return;

    const panel = document.createElement('div');
    panel.className = 'ao3ac-panel collapsed';
    document.body.appendChild(panel);

    let longPressTimer = null;
    let longPressed = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;

    function collapsed() {
      panel.className = 'ao3ac-panel collapsed';
      panel.innerHTML = `<button class="ao3ac-fab" title="单击进度，长按导入/导出">🔖</button>`;
      const btn = panel.querySelector('button');

      btn.addEventListener('pointerdown', startPress);
      btn.addEventListener('pointermove', movePress);
      btn.addEventListener('pointerup', endPress);
      btn.addEventListener('pointerleave', endPress);
      btn.addEventListener('pointercancel', endPress);

      btn.onclick = e => {
        e.stopPropagation();
        if (longPressed || isDragging) return;
        progressExpanded();
      };
    }

    function startPress(e) {
      longPressed = false;
      isDragging = false;
      clearTimeout(longPressTimer);

      const rect = panel.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panelStartX = rect.left;
      panelStartY = rect.top;

      longPressTimer = setTimeout(() => {
        if (!isDragging) {
          longPressed = true;
          menuExpanded();
        }
      }, LONG_PRESS_MS);
    }

    function movePress(e) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        isDragging = true;
        clearTimeout(longPressTimer);
      }

      if (isDragging) {
        e.preventDefault();
        setPanelPosition(panel, panelStartX + dx, panelStartY + dy);
      }
    }

    function endPress() {
      clearTimeout(longPressTimer);
      if (isDragging) {
        savePanelPosition(panel);
        setTimeout(() => {
          isDragging = false;
        }, 80);
      }
    }

    function progressExpanded() {
      const fresh = load(workId);
      const total = chapters.length;
      panel.className = 'ao3ac-panel progress-expanded';

      panel.innerHTML = `
        <div class="ao3ac-progress-line">
          <span class="ao3ac-book">📖</span><span>${fresh ? fresh.lastIndex : '-'}</span><span class="ao3ac-slash">/</span><span>${total}</span>
        </div>
        <div class="ao3ac-mini-row">
          <button id="ao3ac-cont" class="ao3ac-mini-btn">▶</button>
          <button id="ao3ac-reset" class="ao3ac-mini-btn">↻</button>
        </div>
      `;

      panel.querySelector('#ao3ac-cont').onclick = e => {
        e.stopPropagation();
        const latest = load(workId);
        if (!latest) return alert('还没有记录。');
        const next = chapters[latest.lastIndex];
        if (next) location.href = next.url;
        else alert('已经读到最新章节了。');
      };

      panel.querySelector('#ao3ac-reset').onclick = e => {
        e.stopPropagation();
        if (confirm('重置这篇作品的阅读进度？')) {
          localStorage.removeItem(PREFIX + workId);
          location.reload();
        }
      };
    }

    function menuExpanded() {
      const count = Object.keys(allData()).length;
      panel.className = 'ao3ac-panel menu-expanded';
      panel.innerHTML = `
        <div><b>AO3 进度菜单</b></div>
        <div class="ao3ac-small">${count} 条记录</div>
        <div class="ao3ac-row">
          <button id="ao3ac-export">导出</button>
          <button id="ao3ac-import">导入</button>
          <button id="ao3ac-pos-reset">位置重置</button>
        </div>
        <input id="ao3ac-file" type="file" accept=".json,application/json" style="display:none">
      `;

      panel.querySelector('#ao3ac-export').onclick = e => {
        e.stopPropagation();
        exportData();
      };

      panel.querySelector('#ao3ac-import').onclick = e => {
        e.stopPropagation();
        panel.querySelector('#ao3ac-file').click();
      };

      panel.querySelector('#ao3ac-file').onchange = importData;

      panel.querySelector('#ao3ac-pos-reset').onclick = e => {
        e.stopPropagation();
        localStorage.removeItem(POSITION_KEY);
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '10px';
        panel.style.bottom = '10px';
        collapsed();
      };
    }

    collapsed();

    document.addEventListener('click', e => {
      if (!panel.contains(e.target)) collapsed();
    }, true);

    window.addEventListener('resize', () => {
      keepPanelInViewport(panel);
      savePanelPosition(panel);
    });
  }

  function setPanelPosition(panel, x, y) {
    const rect = panel.getBoundingClientRect();
    const margin = 6;
    const maxX = window.innerWidth - rect.width - margin;
    const maxY = window.innerHeight - rect.height - margin;
    const left = Math.max(margin, Math.min(x, maxX));
    const top = Math.max(margin, Math.min(y, maxY));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function savePanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    const data = {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    };
    localStorage.setItem(POSITION_KEY, JSON.stringify(data));
  }

  function restorePanelPosition(panel) {
    try {
      const data = JSON.parse(localStorage.getItem(POSITION_KEY));
      if (!data || typeof data.left !== 'number' || typeof data.top !== 'number') return;

      panel.style.left = `${data.left}px`;
      panel.style.top = `${data.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      setTimeout(() => keepPanelInViewport(panel), 0);
    } catch {}
  }

  function keepPanelInViewport(panel) {
    const rect = panel.getBoundingClientRect();
    const margin = 6;
    const maxX = window.innerWidth - rect.width - margin;
    const maxY = window.innerHeight - rect.height - margin;
    const left = Math.max(margin, Math.min(rect.left, maxX));
    const top = Math.max(margin, Math.min(rect.top, maxY));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function markListProgress() {
    const blurbs = document.querySelectorAll('li.work, li.bookmark, .work.blurb');
    blurbs.forEach(blurb => {
      if (blurb.querySelector('.ao3ac-badge')) return;

      const link = blurb.querySelector('a[href*="/works/"]');
      if (!link) return;

      const id = getWorkId(link.href);
      if (!id) return;

      const data = load(id);
      if (!data) return;

      const total = getTotalFromText(blurb.textContent) || data.total || '?';
      const caught = total !== '?' && Number(data.lastIndex) >= Number(total);

      const badge = document.createElement('span');
      badge.className = 'ao3ac-badge';
      badge.textContent = caught
        ? `📖 已追平 ${data.lastIndex}/${total}`
        : `📖 已读到 ${data.lastIndex}/${total}`;

      const heading = blurb.querySelector('h4.heading, h5.heading') || link.parentElement;
      heading.appendChild(document.createTextNode(' '));
      heading.appendChild(badge);
    });
  }

  function exportData() {
    const payload = {
      app: 'AO3 Continue',
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: allData()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'ao3-reading-progress.json';
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        const incoming = json.progress || json;
        let updated = 0;

        Object.entries(incoming).forEach(([id, data]) => {
          if (!/^\d+$/.test(id) || !data.lastIndex) return;

          const old = load(id);
          if (!old || Number(data.lastIndex) > Number(old.lastIndex)) {
            save(id, data);
            updated++;
          }
        });

        alert(`导入完成，更新 ${updated} 条记录。`);
        location.reload();
      } catch {
        alert('导入失败：JSON 文件格式不对。');
      }
    };
    reader.readAsText(file);
  }

  function allData() {
    const obj = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        try {
          obj[key.replace(PREFIX, '')] = JSON.parse(localStorage.getItem(key));
        } catch {}
      }
    }
    return obj;
  }

  function save(id, data) {
    localStorage.setItem(PREFIX + id, JSON.stringify(data));
  }

  function load(id) {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + id));
    } catch {
      return null;
    }
  }

  function getWorkId(url) {
    return String(url).match(/\/works\/(\d+)/)?.[1] || null;
  }

  function getTotalFromText(text) {
    const m = text.match(/Chapters:\s*\d+\s*\/\s*(\d+|\?)/i);
    return m && m[1] !== '?' ? Number(m[1]) : null;
  }

  function addStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .ao3ac-panel {
        position: fixed;
        right: 10px;
        bottom: 10px;
        z-index: 999999;
        font-family: Arial, sans-serif;
        touch-action: none;
        user-select: none;
        transition: opacity 120ms ease, transform 120ms ease;
      }

      .ao3ac-fab {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: none;
        background: rgba(35,35,35,.88);
        color: white;
        font-size: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,.25);
      }

      .ao3ac-panel.menu-expanded {
        background: rgba(153,0,0,.58);
        color: white;
        padding: 8px;
        border-radius: 10px;
        font-size: 12px;
        line-height: 1.4;
        box-shadow: 0 1px 5px rgba(0,0,0,.15);
        min-width: 130px;
        touch-action: auto;
        user-select: auto;
      }

      .ao3ac-panel.progress-expanded {
        background: rgba(153,0,0,.58);
        color: white;
        padding: 6px 7px;
        border-radius: 9px;
        font-size: 10px;
        line-height: 1.2;
        box-shadow: 0 1px 5px rgba(0,0,0,.15);
        min-width: 78px;
        text-align: center;
        touch-action: auto;
        user-select: auto;
      }

      .ao3ac-progress-line {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        font-size: 15px;
        line-height: 1.1;
        margin-bottom: 5px;
        font-weight: 500;
        white-space: nowrap;
      }

      .ao3ac-book {
        font-size: 15px;
      }

      .ao3ac-slash {
        opacity: .9;
      }

      .ao3ac-mini-row {
        display: flex;
        gap: 6px;
        justify-content: center;
        margin-top: 3px;
      }

      .ao3ac-mini-btn {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 8px;
        background: #f3f3f3;
        color: #333;
        font-size: 15px;
        line-height: 1;
        box-shadow: 0 1px 4px rgba(0,0,0,.16);
      }

      .ao3ac-row {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        margin-top: 6px;
      }

      .ao3ac-row button {
        border: none;
        border-radius: 6px;
        padding: 4px 7px;
        font-size: 12px;
      }

      .ao3ac-small {
        font-size: 11px;
        opacity: .85;
      }

      .ao3ac-notice {
        position: fixed;
        left: 10px;
        right: 10px;
        top: 12px;
        z-index: 999999;
        background: #4b2e83;
        color: white;
        padding: 12px;
        border-radius: 10px;
        font-size: 14px;
        line-height: 1.45;
        box-shadow: 0 2px 12px rgba(0,0,0,.35);
      }

      .ao3ac-badge {
        display: inline-block;
        margin-left: 5px;
        padding: 1px 6px;
        border-radius: 999px;
        background: #eee;
        color: #333;
        border: 1px solid #ccc;
        font-size: 11px;
        font-weight: normal;
      }
    `;
    document.head.appendChild(style);
  }
})();
